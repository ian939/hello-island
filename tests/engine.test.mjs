/* plan.md §14 완료 조건 · §21 자동 검사를 엔진 단위로 확인한다.  node --test tests/ */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { buildContent } from '../js/engine/content.js';
import { blankState, migrate } from '../js/engine/state.js';
import { makeRng, addDays } from '../js/engine/util.js';
import { planDaily, planGate, canPair, pickOptions } from '../js/engine/plan.js';
import { createSession, currentCard, present, submit, advanceIntro, extendSession } from '../js/engine/session.js';
import { refreshUnlocks, completeStage, stageTotals } from '../js/engine/map.js';
import { recordCorrect, level, isMastered, getProgress } from '../js/engine/progress.js';

const wordsJson = JSON.parse(readFileSync(new URL('../data/words.json', import.meta.url)));
const stagesJson = JSON.parse(readFileSync(new URL('../data/stages.json', import.meta.url)));

/** 콘텐츠가 모두 준비됐다고 가정한 색인 (그림 생성 진행과 상관없이 규칙만 검사) */
function allReady() {
  return buildContent({ ...wordsJson, words: wordsJson.words.map((w) => ({ ...w, ready: true })) }, stagesJson);
}

function fresh(content) {
  const st = blankState();
  refreshUnlocks(content, st);
  return st;
}

function newDaily(content, st, target, seed = 1, today = '2026-10-18') {
  const rng = makeRng(seed);
  const plan = planDaily(content, st, { target, today, rng });
  const s = createSession(content, st, { sequence: plan.sequence, intro: plan.intro, target, today, rng });
  while (s.status === 'intro') advanceIntro(st, s, today);
  return { s, rng };
}

const T = '2026-10-18';

test('데이터: 395단어 · 155/120/120 · 7/8세 구역마다 20개', () => {
  const c = allReady();
  assert.equal(c.list.length, 395);
  assert.deepEqual([c.byStage.age6.length, c.byStage.age7.length, c.byStage.age8.length], [155, 120, 120]);
  for (const s of c.stages.filter((s) => s.id !== 'age6')) for (const z of s.zones) assert.equal(c.byZone[z.id].length, 20, z.id);
  assert.equal(Object.keys(c.zones).length, 22);
  assert.equal(new Set(c.list.map((w) => w.id)).size, 395);
});

test('목표 30/50/100 → 시작할 때 정확히 그 수의 카드', () => {
  const c = allReady();
  for (const target of [30, 50, 100]) {
    const st = fresh(c);
    const { s } = newDaily(c, st, target);
    assert.equal(s.order.length, target);
    assert.equal(s.target, target);
  }
});

test('같은 단어는 3문제 안에 다시 나오지 않는다 (가능할 때)', () => {
  const c = allReady();
  const st = fresh(c);
  const { s } = newDaily(c, st, 30, 7);
  const seq = s.order.map((id) => s.cards[id].word);
  for (let i = 0; i < seq.length; i += 1) {
    assert.notEqual(seq[i], seq[i + 1], `pos ${i}`);
    assert.notEqual(seq[i], seq[i + 2], `pos ${i}`);
  }
});

test('30문제에서 3번 틀려도 30장을 모두 맞혀야 끝난다 (답 33번)', () => {
  const c = allReady();
  const st = fresh(c);
  const { s, rng } = newDaily(c, st, 30, 3);
  let wrongs = 0;
  let guard = 0;
  while (s.order.length && guard < 500) {
    guard += 1;
    const card = present(s, rng);
    const wrongOpt = card.options.find((o) => o !== card.word);
    const res = wrongs < 3 && s.done % 9 === 4 ? submit(st, s, wrongOpt, T, rng) : submit(st, s, card.word, T, rng);
    if (!res.correct) wrongs += 1;
    if (!res.finished) assert.notEqual(s.status, 'completed');
  }
  assert.equal(wrongs, 3);
  assert.equal(s.done, 30);
  assert.equal(s.answers, 33);
  assert.equal(s.status, 'completed');
  assert.equal(s.firstTotal, 30);
});

test('틀린 카드는 4~7장 뒤로, 남은 카드가 적으면 가장 뒤로, 마지막 한 장이면 바로 다시', () => {
  const c = allReady();
  const st = fresh(c);
  const { s, rng } = newDaily(c, st, 30, 11);
  const card = present(s, rng);
  const r = submit(st, s, card.options.find((o) => o !== card.word), T, rng);
  assert.ok(r.requeuedAt >= 3 && r.requeuedAt <= 8, `at ${r.requeuedAt}`);
  assert.ok(s.order.includes(card.id));
  // 끝까지 맞히고 마지막 카드 하나만 남겼을 때
  while (s.order.length > 1) {
    const k = present(s, rng);
    submit(st, s, k.word, T, rng);
  }
  const last = present(s, rng);
  const r2 = submit(st, s, last.options.find((o) => o !== last.word), T, rng);
  assert.equal(r2.requeuedAt, 0);
  assert.equal(currentCard(s).id, last.id);
});

test('두 번 틀린 카드는 보기가 하나 줄어든다 (최소 2개)', () => {
  const c = allReady();
  const st = fresh(c);
  const { s, rng } = newDaily(c, st, 30, 5);
  const target = present(s, rng);
  const n0 = target.options.length;
  for (let i = 0; i < 2; i += 1) {
    while (currentCard(s).id !== target.id) submit(st, s, present(s, rng).word, T, rng);
    const k = present(s, rng);
    submit(st, s, k.options.find((o) => o !== k.word), T, rng);
  }
  while (currentCard(s).id !== target.id) submit(st, s, present(s, rng).word, T, rng);
  assert.equal(present(s, rng).options.length, n0 - 1);
});

test('보기: 정답 1개 · 중복 없음 · 헷갈리는 짝 없음 · 같은 묶음(색/숫자/도형)끼리만', () => {
  const c = allReady();
  const st = fresh(c);
  st.map.unlockedStages = ['age6', 'age7', 'age8'];
  st.map.unlockedZones = Object.keys(c.zones);
  const rng = makeRng(9);
  for (const w of c.list) {
    for (let k = 0; k < 3; k += 1) {
      const opts = pickOptions(c, st, w.id, 3, rng);
      assert.equal(opts.filter((o) => o === w.id).length, 1);
      assert.equal(new Set(opts).size, opts.length);
      assert.ok(opts.length >= 2, `${w.en} has only ${opts.length}`);
      for (const a of opts) for (const b of opts) if (a !== b) assert.ok(canPair(c.words[a], c.words[b]), `${c.words[a].en} vs ${c.words[b].en}`);
    }
  }
  // 대표 사례
  const id = (en) => c.list.find((w) => w.en === en).id;
  assert.equal(canPair(c.words[id('big')], c.words[id('elephant')]), false);
  assert.equal(canPair(c.words[id('planet')], c.words[id('Saturn')]), false);
  assert.equal(canPair(c.words[id('cat')], c.words[id('red')]), false);
  assert.equal(canPair(c.words[id('five')], c.words[id('six')]), false);
  assert.equal(canPair(c.words[id('twelve')], c.words[id('fourteen')]), false);
  assert.equal(canPair(c.words[id('twelve')], c.words[id('fifteen')]), true);
});

test('정답 위치가 늘 같은 칸에 몰리지 않는다', () => {
  const c = allReady();
  const st = fresh(c);
  const { s, rng } = newDaily(c, st, 100, 21);
  const counts = [0, 0, 0];
  let prev = -1;
  let repeats = 0;
  while (s.order.length) {
    const k = present(s, rng);
    const at = k.options.indexOf(k.word);
    counts[at] += 1;
    if (at === prev) repeats += 1;
    prev = at;
    submit(st, s, k.word, T, rng);
  }
  for (const n of counts) assert.ok(n > 20, counts.join('/'));
  assert.ok(repeats < 10, `repeats ${repeats}`);
});

test('도감 최초 수집은 한 번만, 숙련은 서로 다른 날짜가 쌓여야', () => {
  const st = blankState();
  const card = { attempts: 1, hints: 0 };
  assert.equal(recordCorrect(st, 'animals-cat', card, T).discovered, true);
  assert.equal(recordCorrect(st, 'animals-cat', card, T).discovered, false);
  for (let i = 0; i < 5; i += 1) recordCorrect(st, 'animals-cat', card, T);
  const p = getProgress(st, 'animals-cat');
  assert.equal(p.dates.length, 1);
  assert.equal(level(p), 1);
  recordCorrect(st, 'animals-cat', card, addDays(T, 2));
  assert.equal(level(p), 2);
  recordCorrect(st, 'animals-cat', { attempts: 1, hints: 1 }, addDays(T, 5)); // 도움 받은 날은 세지 않는다
  assert.equal(p.dates.length, 2);
  recordCorrect(st, 'animals-cat', card, addDays(T, 9));
  assert.equal(isMastered(p), true);
  assert.equal(level(p), 3);
});

test('6세 154/155 → 잠김, 155/155 → 최종 미션만 준비, 미션 완료 → 7세 열림', () => {
  const c = allReady();
  const st = fresh(c);
  const ids = c.byStage.age6;
  ids.slice(0, 154).forEach((id) => recordCorrect(st, id, { attempts: 1, hints: 0 }, T));
  refreshUnlocks(c, st);
  assert.equal(st.map.gate.age6, 'locked');
  recordCorrect(st, ids[154], { attempts: 1, hints: 0 }, T);
  refreshUnlocks(c, st);
  assert.equal(st.map.gate.age6, 'ready');
  assert.ok(!st.map.unlockedStages.includes('age7'));
  const gate = planGate(c, st, 'age6', makeRng(2));
  assert.equal(gate.length, 20);
  assert.equal(new Set(gate).size, 20);
  completeStage(c, st, 'age6');
  assert.ok(st.map.unlockedStages.includes('age7'));
  assert.equal(st.map.current, 'age7');
  assert.ok(st.map.unlockedZones.includes('age7-school'));
  assert.ok(!st.map.unlockedZones.includes('age7-home'));
});

test('그림·음성이 빠진 단어가 있으면 다 모아도 최종 미션이 열리지 않는다', () => {
  const c = allReady();
  c.words[c.byStage.age6[3]].ready = false;
  const st = fresh(c);
  c.byStage.age6.forEach((id) => recordCorrect(st, id, { attempts: 1, hints: 0 }, T));
  refreshUnlocks(c, st);
  assert.equal(st.map.gate.age6, 'locked');
  assert.equal(stageTotals(c, st, 'age6').ready, 154);
});

test('7세 구역: 15/20 → 다음 구역 잠김, 16/20 → 열림, 한 번 열리면 다시 잠기지 않음', () => {
  const c = allReady();
  const st = fresh(c);
  completeStage(c, st, 'age6');
  const school = c.byZone['age7-school'];
  school.slice(0, 15).forEach((id) => recordCorrect(st, id, { attempts: 1, hints: 0 }, T));
  refreshUnlocks(c, st);
  assert.ok(!st.map.unlockedZones.includes('age7-home'));
  recordCorrect(st, school[15], { attempts: 1, hints: 0 }, T);
  refreshUnlocks(c, st);
  assert.ok(st.map.unlockedZones.includes('age7-home'));
  delete st.words[school[15]];
  refreshUnlocks(c, st);
  assert.ok(st.map.unlockedZones.includes('age7-home'));
});

test('7세 맵: 6세 복습이 약 30% 섞이고, 복습 정답이 7세 수집 수를 늘리지 않는다', () => {
  const c = allReady();
  const st = fresh(c);
  c.byStage.age6.forEach((id) => recordCorrect(st, id, { attempts: 1, hints: 0 }, '2026-10-01'));
  completeStage(c, st, 'age6');
  const { s, rng } = newDaily(c, st, 50, 4);
  const words = Object.values(s.cards).map((k) => k.word);
  const six = words.filter((id) => c.words[id].stage === 'age6').length;
  assert.ok(six >= 10 && six <= 20, `age6 cards ${six}/50`);
  const before = stageTotals(c, st, 'age7').found;
  while (s.order.length) {
    const k = present(s, rng);
    submit(st, s, k.word, T, rng);
  }
  const after = stageTotals(c, st, 'age7').found;
  assert.equal(after - before, new Set(words.filter((id) => c.words[id].stage === 'age7')).size);
});

test('출제 불가(준비 안 됨·제외) 단어는 카드에도 보기에도 나오지 않는다', () => {
  const c = allReady();
  const off = c.byStage.age6.filter((_, i) => i % 3 === 0);
  off.forEach((id) => (c.words[id].ready = false));
  const st = fresh(c);
  const excluded = c.byStage.age6[1];
  st.flags[excluded] = 'exclude';
  const { s } = newDaily(c, st, 100, 8);
  for (const k of Object.values(s.cards)) {
    for (const o of [k.word, ...k.options]) {
      assert.ok(c.words[o].ready, o);
      assert.notEqual(o, excluded);
    }
  }
});

test('목표를 30→50으로 늘리면 맞힌 30장은 그대로, 20장만 더한다', () => {
  const c = allReady();
  const st = fresh(c);
  const { s, rng } = newDaily(c, st, 30, 6);
  while (s.order.length) submit(st, s, present(s, rng).word, T, rng);
  const plan = planDaily(c, st, { target: 20, today: T, rng, newLimit: 0 });
  extendSession(c, st, s, plan.sequence, rng);
  assert.equal(s.done, 30);
  assert.equal(s.target, 50);
  assert.equal(s.order.length, 20);
});

test('저장 상태: 저장→복원 후 남은 카드·오답 큐·수집 기록이 그대로', () => {
  const c = allReady();
  const st = fresh(c);
  const { s, rng } = newDaily(c, st, 30, 12);
  st.session = s;
  for (let i = 0; i < 5; i += 1) submit(st, s, present(s, rng).word, T, rng);
  const k = present(s, rng);
  submit(st, s, k.options.find((o) => o !== k.word), T, rng);
  const back = migrate(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(back.session.order, s.order);
  assert.equal(back.session.done, 5);
  assert.deepEqual(back.words, st.words);
  // 옛 저장본: stage 가 없는 세션은 age6 으로
  const old = migrate({ session: { order: [], cards: {} }, words: { 'animals-cat': { discoveredAt: T } } });
  assert.equal(old.session.stage, 'age6');
  assert.equal(old.words['animals-cat'].discoveredAt, T);
});
