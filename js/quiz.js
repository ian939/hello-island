/* 새 단어 미리 만나기 · 퀴즈 · 10장 쉼 · 완료
 *
 * 기본 모드 '듣고 고르기': 보기를 처음 누르면 그 단어 소리가 나오고 선택된다.
 * '이거야!' 또는 같은 보기를 한 번 더 누르면 답을 낸다.
 * 정답 단어를 처음부터 틀어 주지 않는다 — 그러면 그림 뜻을 몰라도 소리만 맞춰 고를 수 있다.
 */
import { app } from './app.js';
import * as audio from './audio.js';
import { artEl, artSrcs } from './art.js';
import { $, el, button, tint, openSheet, closeSheet, toast, earIcon, checkIcon } from './ui.js';
import { planDaily, planGate } from './engine/plan.js';
import { createSession, currentCard, present, submit, useHint, advanceIntro, summarize } from './engine/session.js';
import { refreshUnlocks, completeStage } from './engine/map.js';

const RIGHT_SAY = ['딩동! 맞았어', '잘 들었어!', '바로 그거야!', '멋져!'];
const NEW_SAY = '새 친구를 만났어!';
const WRONG_SAY = '괜찮아! 이 친구는 이따 다시 만나자';

export function startDaily(target, zoneId = null) {
  const { content, state } = app;
  const today = app.today();
  state.settings.goal = target;
  const plan = planDaily(content, state, { target, zoneId, today, rng: app.rng });
  if (!plan) {
    toast('지금 열린 구역에 준비된 단어가 없어요');
    return;
  }
  state.session = createSession(content, state, { sequence: plan.sequence, intro: plan.intro, target, zoneId, today, rng: app.rng });
  app.save();
  resumeSession(true);
}

export function startGate(stageId) {
  const { content, state } = app;
  const words = planGate(content, state, stageId, app.rng);
  state.session = createSession(content, state, { kind: 'gate', sequence: words, stageId, today: app.today(), rng: app.rng });
  state.map.gate[stageId] = 'in_progress';
  app.save();
  audio.play(audio.uiSrc('gate'));
  renderQuiz();
}

export function resumeSession(fresh = false) {
  const s = app.state.session;
  if (!s) return app.home();
  if (s.status === 'intro') {
    if (fresh) audio.play(audio.uiSrc('meet'));
    renderIntro();
  } else {
    if (fresh) audio.play(audio.uiSrc('listen_choose'));
    renderQuiz();
  }
}

/* ---------- 새 단어 미리 만나기 ---------- */
function renderIntro() {
  const { content, state } = app;
  const s = state.session;
  const id = s.intro[s.introAt];
  if (!id) {
    s.status = 'playing';
    app.save();
    renderQuiz();
    return;
  }
  const w = content.words[id];
  const zone = content.zones[w.zone];
  const screen = $('#screen-intro');
  screen.replaceChildren();

  const bar = el('div', 'quiz-bar');
  bar.append(tint(el('span', 'chip-zone', '새 친구 미리 만나기'), zone.color), el('span', 'chip-count', `${s.introAt + 1} / ${s.intro.length}`));
  const body = el('div', 'intro-body');
  const plate = el('div', 'plate');
  plate.style.setProperty('--zone', zone.color);
  const art = el('div', 'plate-art');
  art.appendChild(artEl(w, { motion: !state.settings.calm }));
  plate.append(el('span', 'plate-no', `No. ${app.pad(w.no)}`), art, el('div', 'plate-name', w.en));

  const word = el('p', 'intro-word', w.en);
  const btns = el('div', 'intro-buttons');
  const normal = button('helper', null, () => playWith(normal, audio.wordSrc(id)));
  normal.append(earIcon(), document.createTextNode('듣기'));
  const slow = button('helper', null, () => playWith(slow, audio.wordSrc(id, true)));
  slow.append(earIcon(), document.createTextNode('천천히'));
  btns.append(normal, slow);
  const next = button('cta intro-next', s.introAt + 1 < s.intro.length ? '다음 친구' : '퀴즈 시작!', () => {
    audio.sfx('tap');
    advanceIntro(state, s, app.today());
    app.save();
    if (s.status === 'playing') {
      audio.play(audio.uiSrc('listen_choose'));
      renderQuiz();
    } else renderIntro();
  });
  body.append(plate, word, btns, next);
  screen.append(bar, body);
  app.show('screen-intro', { title: '새 친구', mode: 'play' });

  // 그림과 함께 단어를 두 번 (보통 → 천천히)
  const wait = s.introAt === 0 ? 1500 : 250;
  setTimeout(() => {
    if (app.state.session === s && s.intro[s.introAt] === id) audio.play([audio.wordSrc(id), audio.wordSrc(id, true)], { gap: 500 });
  }, wait);
  const nextId = s.intro[s.introAt + 1];
  if (nextId) audio.preload([audio.wordSrc(nextId), audio.wordSrc(nextId, true)]);
}

async function playWith(node, src) {
  node.classList.add('is-playing');
  await audio.play(src);
  node.classList.remove('is-playing');
}

/* ---------- 퀴즈 ---------- */
let busy = false; // 답을 낸 뒤 다음 카드까지 입력을 막는다
let advanceTimer = null;

function renderQuiz() {
  clearTimeout(advanceTimer);
  busy = false;
  const { content, state } = app;
  const s = state.session;
  if (!s) return app.home();
  if (s.status === 'completed' || !s.order.length) return finish();
  const card = present(s, app.rng);
  app.save();
  const w = content.words[card.word];
  const zone = content.zones[w.zone];
  const gate = s.kind === 'gate';

  const screen = $('#screen-quiz');
  screen.replaceChildren();
  // 상단 줄: 구역 · 진행 · 쉬는 곳까지 남은 칸
  const bar = el('div', 'quiz-bar');
  const countChip = el('span', 'chip-count', `${s.done} / ${s.target}`);
  bar.append(tint(el('span', 'chip-zone', gate ? '최종 미션' : zone.title), gate ? '#d5372a' : zone.color), countChip);
  const pips = el('div', 'pips');
  pips.setAttribute('aria-label', '쉬는 곳까지');
  const inTen = s.done % 10;
  for (let i = 0; i < 10; i += 1) pips.appendChild(el('i', i < inTen ? 'is-on' : ''));
  bar.appendChild(pips);

  const body = el('div', 'quiz-body');
  const left = el('div', 'quiz-left');
  const plate = el('div', 'plate');
  plate.style.setProperty('--zone', zone.color);
  const art = el('div', 'plate-art');
  art.appendChild(artEl(w));
  const name = el('div', 'plate-name is-hidden-word', '???');
  plate.append(el('span', 'plate-no', `No. ${app.pad(w.no)}`), art, name);
  const helperRow = el('div', 'helper-row');
  const help = button('helper', null, () => {
    if (busy) return;
    useHint(s);
    app.save();
    playWith(help, audio.wordSrc(card.word, state.settings.slow));
  });
  help.append(earIcon(), document.createTextNode('도움 듣기'));
  helperRow.appendChild(help);
  left.append(plate, helperRow);

  const right = el('div', 'quiz-right');
  const ask = el('p', 'ask');
  ask.append(document.createTextNode('듣고 골라 봐'), el('span', 'ask-en', 'Listen and choose!'));
  const opts = el('div', 'options');
  const say = el('p', 'say');
  const go = button('cta go', '이거야!');
  go.disabled = true;
  let picked = null;
  const rows = new Map();

  for (const oid of card.options) {
    const ow = content.words[oid];
    const row = button('option');
    const ear = el('span', 'option-ear');
    ear.appendChild(earIcon());
    row.append(ear, el('span', 'option-word', ow.en));
    row.setAttribute('aria-label', ow.en);
    row.addEventListener('click', async () => {
      if (busy) return;
      audio.unlock();
      if (picked === oid) {
        answer(oid);
        return;
      }
      picked = oid;
      rows.forEach((r) => r.classList.remove('is-picked', 'is-glow'));
      row.classList.add('is-picked');
      go.disabled = false;
      audio.sfx('tap');
      row.classList.add('is-playing');
      const p = state.words[oid];
      if (p) p.listens = (p.listens || 0) + 1;
      await audio.play(audio.wordSrc(oid, state.settings.slow));
      row.classList.remove('is-playing');
    });
    rows.set(oid, row);
    opts.appendChild(row);
  }
  go.addEventListener('click', () => {
    if (!busy && picked) answer(picked);
  });
  right.append(ask, opts, say, go);
  body.append(left, right);
  screen.append(bar, body);
  app.show('screen-quiz', { title: '무엇일까?', mode: 'play' });

  // 세 번째로 틀린 뒤에는 정답 칸을 빛내고 소리를 들려준다 (고르는 건 아이가 직접)
  if (card.attempts >= 3) {
    rows.get(card.word).classList.add('is-glow');
    useHint(s);
    app.save();
    setTimeout(() => {
      if (currentCard(s) === card && !busy) audio.play(audio.wordSrc(card.word));
    }, 700);
  }

  // 다음 카드 소리·그림 미리 받기
  const nextCard = s.cards[s.order[1]];
  if (nextCard) {
    audio.preload(nextCard.options.map((o) => audio.wordSrc(o)).concat(audio.sentenceSrc(nextCard.word)));
    for (const src of artSrcs(content.words[nextCard.word])) new Image().src = src;
  }
  audio.preload(card.options.map((o) => audio.wordSrc(o, state.settings.slow)).concat(audio.sentenceSrc(card.word)));

  function answer(choice) {
    busy = true;
    go.disabled = true;
    const res = submit(state, s, choice, app.today(), app.rng);
    app.save();
    if (res.correct) {
      audio.sfx('right');
      countChip.textContent = `${s.done} / ${s.target}`;
      pips.querySelectorAll('i').forEach((p, i) => p.classList.toggle('is-on', s.done % 10 === 0 || i < s.done % 10));
      rows.forEach((r, k) => r.classList.add(k === choice ? 'is-right' : 'is-dim'));
      plate.classList.add('is-right');
      name.classList.remove('is-hidden-word');
      name.textContent = w.en;
      const stamp = el('span', `stamp${res.discovered ? ' stamp--new' : ''}`);
      if (res.discovered) stamp.textContent = '새 친구!';
      else stamp.appendChild(checkIcon());
      plate.appendChild(stamp);
      setTimeout(() => audio.sfx('stamp'), 120);
      say.className = 'say';
      say.textContent = res.discovered ? NEW_SAY : RIGHT_SAY[s.done % RIGHT_SAY.length];
      if (!state.settings.calm) art.firstChild.classList.add(`mv-${w.motion}`);
      const seq = [audio.wordSrc(card.word), audio.sentenceSrc(card.word)];
      if (res.discovered) seq.push(audio.uiSrc('new_friend'));
      after(audio.play(seq), res.finished ? finish : res.breakNow ? showBreak : renderQuiz, 700);
    } else {
      audio.sfx('wrong');
      rows.get(choice).classList.remove('is-picked');
      rows.get(choice).classList.add('is-wrong');
      rows.get(card.word).classList.add('is-answer');
      say.className = 'say is-soft';
      say.textContent = WRONG_SAY;
      // 정답 그림과 소리를 한 번 더 — 몇 장 뒤에 다시 만난다
      after(new Promise((r) => setTimeout(r, 450)).then(() => audio.play(audio.wordSrc(card.word))), renderQuiz, 1100);
    }
  }

  /* 소리가 끝나면 조금 있다 다음으로. 아이가 '다음'을 누르면 바로. */
  function after(promise, next, pause) {
    go.disabled = false;
    go.textContent = '다음 ▶';
    let moved = false;
    const move = () => {
      if (moved) return;
      moved = true;
      clearTimeout(advanceTimer);
      audio.stop();
      next();
    };
    go.onclick = move;
    promise.then(() => {
      if (!moved && app.state.session === s) advanceTimer = setTimeout(move, pause);
    });
  }
}

/* ---------- 10장마다 쉬어 가기 ---------- */
function showBreak() {
  const s = app.state.session;
  audio.play(audio.uiSrc('break'));
  audio.sfx('star');
  openSheet(
    (sh) => {
      const row = el('div', 'stars-row');
      for (let i = 0; i < s.stars; i += 1) {
        const im = el('img', i === s.stars - 1 ? 'is-new' : '');
        im.src = 'assets/ui/star.webp';
        im.alt = '';
        row.appendChild(im);
      }
      sh.append(
        el('p', 'sheet-eyebrow', `${s.done} / ${s.target}`),
        el('h2', 'sheet-title', `${s.done}장 완료!`),
        row,
        el('p', 'sheet-text', '별 조각을 하나 모았어.\n조금 쉬었다 할까?'),
      );
      const b = el('div', 'sheet-buttons');
      b.append(
        button('btn btn--go', '계속 탐험하기', () => {
          closeSheet();
          renderQuiz();
        }),
        button('btn', '여기까지 하고 쉬기', () => {
          closeSheet();
          app.home();
          toast('여기까지 저장했어. 언제든 이어서 해!');
        }),
      );
      sh.appendChild(b);
    },
    { dismissable: false },
  );
}

/* ---------- 완료 ---------- */
function finish() {
  const { content, state } = app;
  const s = state.session;
  if (!s) return app.home();
  state.history.push(summarize(s));
  if (state.history.length > 120) state.history.shift();
  state.session = null;
  let events = [];
  if (s.kind === 'gate') events = completeStage(content, state, s.stage);
  events = events.concat(refreshUnlocks(content, state));
  app.queueEvents(events);
  app.save();

  audio.play(audio.uiSrc('done'));
  audio.sfx('star');
  openSheet(
    (sh) => {
      const art = el('div', 'sheet-art');
      const im = el('img', 'art mv-bounce');
      im.src = 'assets/ui/party.webp';
      art.appendChild(im);
      sh.append(el('p', 'sheet-eyebrow', `${s.target}장 모두 맞혔어`), el('h2', 'sheet-title', s.kind === 'gate' ? '최종 미션 성공!' : '오늘 탐험 끝!'), art);
      if (s.found.length) {
        sh.appendChild(el('p', 'sheet-text', `오늘 새로 만난 친구 ${s.found.length}명`));
        const fr = el('div', 'friends');
        for (const id of s.found.slice(0, 12)) {
          const w = content.words[id];
          const f = button('friend', null, () => app.sayWord(id, { slow: false }));
          const box = el('div', 'art-box');
          box.appendChild(artEl(w));
          f.append(box, el('b', null, w.en));
          f.style.background = 'none';
          f.style.border = '0';
          fr.appendChild(f);
        }
        sh.appendChild(fr);
      } else sh.appendChild(el('p', 'sheet-text', '오늘은 아는 친구들과 다시 만났어.\n자꾸 만나면 반짝 친구가 돼!'));
      const b = el('div', 'sheet-buttons');
      b.append(
        button('btn btn--go', '도감 보러 가기', () => {
          closeSheet();
          app.dex();
        }),
        button('btn', '처음으로', () => {
          closeSheet();
          app.home();
        }),
      );
      sh.appendChild(b);
    },
    { dismissable: false, wide: true },
  );
}
