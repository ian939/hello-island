/* 보호자 화면 — 아이 화면에는 한국어 뜻을 보이지 않는다. 뜻은 여기서만.
 * 들어올 때 간단한 덧셈을 직접 입력하게 해서 아이가 우연히 들어오지 않게 한다. */
import { app } from './app.js';
import * as audio from './audio.js';
import { artEl } from './art.js';
import { $, el, button, openSheet, closeSheet, toast } from './ui.js';
import { level, isMastered } from './engine/progress.js';
import { stageTotals, parentUnlockStage, isStageOpen } from './engine/map.js';
import { planDaily } from './engine/plan.js';
import { extendSession, summarize } from './engine/session.js';
import { daysBetween } from './engine/util.js';
import { exportBlob, importText, clearState } from './store.js';
import { blankState } from './engine/state.js';
import { refreshUnlocks } from './engine/map.js';

export function openParent() {
  const a = 12 + Math.floor(Math.random() * 30);
  const b = 11 + Math.floor(Math.random() * 30);
  openSheet((sh) => {
    sh.append(el('p', 'sheet-eyebrow', '보호자 확인'), el('h2', 'sheet-title', `${a} + ${b} = ?`));
    const input = el('input', 'input');
    input.type = 'text';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', '답');
    const go = button('btn btn--go', '들어가기', () => {
      if (Number(input.value.trim()) === a + b) {
        closeSheet();
        renderParent();
      } else {
        input.value = '';
        toast('답이 달라요');
      }
    });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go.click();
    });
    sh.append(input, el('p', 'hint', '보호자 설정 · 학습 기록 · 단어 관리'), el('div', 'sheet-buttons'));
    sh.lastChild.append(go, button('btn', '닫기', closeSheet));
    setTimeout(() => input.focus(), 50);
  });
}

function seg(options, value, onPick) {
  const box = el('div', 'seg');
  for (const [v, label] of options) {
    const b = button(v === value ? 'is-on' : '', label, () => {
      box.querySelectorAll('button').forEach((x) => x.classList.remove('is-on'));
      b.classList.add('is-on');
      onPick(v);
    });
    box.appendChild(b);
  }
  return box;
}

function setting(label, sub, control) {
  const row = el('div', 'setting');
  const l = el('div', 'setting-label', label);
  if (sub) l.appendChild(el('small', null, sub));
  row.append(l, control);
  return row;
}

function stat(value, key) {
  const s = el('div', 'stat');
  s.append(el('div', 'stat-value', value), el('div', 'stat-key', key));
  return s;
}

let wordZone = null;

function renderParent() {
  const { content, state } = app;
  const today = app.today();
  const root = $('#parent-body');
  root.replaceChildren();
  const wrap = el('div', 'parent');

  /* 기록 */
  wrap.appendChild(el('h2', null, '학습 기록'));
  wrap.appendChild(el('p', 'p-note', '모든 카드는 결국 맞혀야 끝나므로 "완료율 100%"는 성취 지표가 아닙니다. 첫 시도 정답률과 다른 날 혼자 맞힌 기록(숙련)을 함께 보세요.'));
  const week = state.history.filter((h) => daysBetween(h.date, today) <= 6);
  const ft = week.reduce((a, h) => a + h.firstTotal, 0);
  const fr = week.reduce((a, h) => a + h.firstRight, 0);
  const ids = content.list.map((w) => w.id);
  const found = ids.filter((id) => state.words[id] && state.words[id].discoveredAt).length;
  const friends = ids.filter((id) => level(state.words[id]) >= 2).length;
  const mastered = ids.filter((id) => isMastered(state.words[id])).length;
  const stats = el('div', 'stats');
  stats.append(
    stat(ft ? `${Math.round((fr / ft) * 100)}%` : '–', `최근 7일 첫 시도 정답률 (${fr}/${ft})`),
    stat(String(week.reduce((a, h) => a + h.retries, 0)), '최근 7일 재도전 횟수'),
    stat(String(week.reduce((a, h) => a + h.hints, 0)), '최근 7일 도움 듣기'),
    stat(String(week.length), '최근 7일 마친 탐험'),
    stat(`${found}`, '발견한 단어 (395개 중)'),
    stat(`${friends}`, '친해진 단어 (다른 날 2회+)'),
    stat(`${mastered}`, '숙련 단어 (다른 날 3회+)'),
  );
  wrap.appendChild(stats);
  const maps = el('div', 'stats');
  maps.style.marginTop = '8px';
  for (const s of content.stages) {
    const t = stageTotals(content, state, s.id);
    const g = state.map.gate[s.id];
    const gateText = { locked: '최종 미션 잠김', ready: '최종 미션 준비', in_progress: '최종 미션 진행 중', completed: '졸업' }[g];
    maps.appendChild(stat(`${t.found}/${t.total}`, `${s.title} · ${isStageOpen(state, s.id) ? gateText : '맵 잠김'}${t.ready < t.total ? ` · 준비 안 된 단어 ${t.total - t.ready}` : ''}`));
  }
  wrap.appendChild(maps);

  // 7일간 자주 틀린 단어
  const misses = [];
  for (const id of ids) {
    const p = state.words[id];
    if (!p) continue;
    const n = p.recent.filter((r) => daysBetween(r.d, today) <= 6 && (!r.ok || r.h)).length;
    if (n) misses.push([id, n]);
  }
  misses.sort((x, y) => y[1] - x[1]);
  wrap.appendChild(el('h2', null, '7일간 자주 헷갈린 단어'));
  if (!misses.length) wrap.appendChild(el('p', 'p-note', '아직 없어요.'));
  else {
    const list = el('div', 'wlist');
    for (const [id, n] of misses.slice(0, 10)) list.appendChild(wordRow(id, `${n}번 틀리거나 도움`));
    wrap.appendChild(list);
  }

  /* 설정 */
  wrap.appendChild(el('h2', null, '설정'));
  wrap.append(
    setting('보기 개수', '익숙해지면 4개로', seg([[3, '3개'], [4, '4개']], state.settings.choices, (v) => save((st) => (st.settings.choices = v)))),
    setting(
      '하루 새 단어',
      '자동 = 목표 30/50/100에 5/7/10개',
      seg([[null, '자동'], [3, '3'], [5, '5'], [7, '7'], [10, '10']], state.settings.newPerDay, (v) => save((st) => (st.settings.newPerDay = v))),
    ),
    setting('보기를 누를 때 발음', '느리게 = 0.65배 속도', seg([[false, '보통'], [true, '느리게']], state.settings.slow, (v) => save((st) => (st.settings.slow = v)))),
    setting('움직임 줄이기', '그림이 계속 움직이지 않게', seg([[false, '끔'], [true, '켬']], state.settings.calm, (v) => {
      save((st) => (st.settings.calm = v));
      document.body.classList.toggle('is-calm', v);
    })),
  );

  /* 진행 중인 탐험 */
  const s = state.session;
  wrap.appendChild(el('h2', null, '진행 중인 탐험'));
  if (!s || s.status === 'completed') wrap.appendChild(el('p', 'p-note', '지금 하던 탐험이 없어요.'));
  else {
    wrap.appendChild(el('p', 'p-note', `${s.date} 시작 · ${s.kind === 'gate' ? '최종 미션' : '오늘의 탐험'} · ${s.done}/${s.target}장 · 남은 카드 ${s.order.length}장`));
    const btns = el('div', 'p-buttons');
    if (s.kind === 'daily') {
      for (const n of [50, 100]) {
        if (s.target < n) {
          btns.appendChild(
            button('btn', `목표를 ${n}장으로 늘리기`, () => {
              const plan = planDaily(content, state, { target: n - s.target, today, rng: app.rng, newLimit: 0 });
              if (!plan) return toast('더할 단어가 없어요');
              extendSession(content, state, s, plan.sequence, app.rng);
              app.save();
              toast(`맞힌 ${s.done}장은 그대로, ${plan.sequence.length}장을 더했어요`);
              renderParent();
            }),
          );
        }
      }
    }
    btns.appendChild(
      button('btn btn--warn', '이 탐험 그만두고 새로 시작', () => {
        const sum = summarize(s);
        sum.incomplete = true;
        state.history.push(sum);
        if (s.kind === 'gate') state.map.gate[s.stage] = 'ready';
        state.session = null;
        app.save();
        toast('하던 탐험을 미완료로 보관했어요');
        renderParent();
      }),
    );
    wrap.appendChild(btns);
  }

  /* 지도 */
  wrap.appendChild(el('h2', null, '지도 열기'));
  wrap.appendChild(el('p', 'p-note', '보통은 앞 지도의 단어를 모두 모으고 최종 미션 20장을 마치면 열립니다. 아이가 이미 그 난이도를 소화한다면 여기서 직접 열 수 있어요.'));
  const mb = el('div', 'p-buttons');
  for (const st of content.stages) {
    if (!isStageOpen(state, st.id)) {
      mb.appendChild(
        button('btn', `${st.title} 열기`, () => {
          app.queueEvents(parentUnlockStage(content, state, st.id));
          app.save();
          toast(`${st.short} 지도를 열었어요`);
          renderParent();
        }),
      );
    }
  }
  const cur = content.stages.find((x) => x.id === state.map.current);
  if (cur.zones.some((z) => !state.map.unlockedZones.includes(z.id))) {
    mb.appendChild(
      button('btn', `${cur.short}의 모든 구역 열기`, () => {
        parentUnlockStage(content, state, cur.id, true);
        app.save();
        toast('모든 구역을 열었어요');
        renderParent();
      }),
    );
  }
  if (!mb.children.length) wrap.appendChild(el('p', 'p-note', '열 수 있는 지도가 모두 열려 있어요.'));
  else wrap.appendChild(mb);

  /* 단어 관리 */
  wrap.appendChild(el('h2', null, '단어 관리'));
  wrap.appendChild(el('p', 'p-note', '이미 앎 = 새 단어 소개를 건너뛰고 바로 퀴즈에 섞어요 (도감은 맞혀야 모여요). 제외 = 당분간 문제·보기에 나오지 않아요.'));
  const select = el('select', 'select');
  for (const st of content.stages) {
    const og = el('optgroup');
    og.label = st.title;
    for (const z of st.zones) {
      const o = el('option', null, `${z.title} (${content.byZone[z.id].length})`);
      o.value = z.id;
      og.appendChild(o);
    }
    select.appendChild(og);
  }
  wordZone = wordZone || content.stages.find((x) => x.id === state.map.current).zones[0].id;
  select.value = wordZone;
  const list = el('div', 'wlist');
  list.style.marginTop = '10px';
  const fill = () => {
    list.replaceChildren();
    for (const id of content.byZone[wordZone]) {
      const flag = state.flags[id] || null;
      const control = seg(
        [[null, '소개'], ['known', '이미 앎'], ['exclude', '제외']],
        flag,
        (v) =>
          save((st) => {
            if (v) st.flags[id] = v;
            else delete st.flags[id];
          }),
      );
      list.appendChild(wordRow(id, statusText(id), control));
    }
  };
  select.addEventListener('change', () => {
    wordZone = select.value;
    fill();
  });
  fill();
  wrap.append(select, list);

  /* 오프라인 */
  wrap.appendChild(el('h2', null, '오프라인 준비'));
  wrap.appendChild(el('p', 'p-note', '모든 그림과 영어 소리(약 25MB)를 기기에 받아 두면 인터넷 없이도 탐험할 수 있어요. 아이패드에서는 Safari 공유 → "홈 화면에 추가"로 앱처럼 쓰세요.'));
  const off = button('btn', '그림·소리 모두 내려받기', () => cacheAll(off));
  wrap.appendChild(off);

  /* 백업 */
  wrap.appendChild(el('h2', null, '백업 · 복원'));
  const bb = el('div', 'p-buttons');
  bb.appendChild(
    button('btn', '기록 파일로 저장', () => {
      const a = el('a');
      a.href = URL.createObjectURL(exportBlob(state));
      a.download = `hello-island-${today}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }),
  );
  const file = el('input');
  file.type = 'file';
  file.accept = 'application/json,.json';
  file.style.display = 'none';
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const next = importText(await f.text());
      Object.assign(app.state, next);
      app.save();
      toast('기록을 불러왔어요');
      renderParent();
    } catch (err) {
      toast(err.message || '불러오지 못했어요');
    }
  });
  bb.append(button('btn', '기록 파일 불러오기', () => file.click()), file);
  wrap.appendChild(bb);

  /* 초기화 — '초기화'를 직접 써야 버튼이 켜진다 */
  wrap.appendChild(el('h2', null, '처음부터 다시'));
  wrap.appendChild(el('p', 'p-note', '모은 친구·기록·설정이 모두 지워지고 되돌릴 수 없어요. 아래 칸에 초기화 라고 써야 버튼이 켜져요.'));
  const ri = el('input', 'input');
  ri.type = 'text';
  ri.placeholder = '초기화';
  ri.autocomplete = 'off';
  const rb = button('btn btn--warn', '모든 기록 지우기', () => {
    if (ri.value.trim() !== '초기화') return;
    clearState();
    const fresh = blankState();
    for (const k of Object.keys(app.state)) delete app.state[k];
    Object.assign(app.state, fresh);
    refreshUnlocks(content, app.state);
    app.pending = [];
    app.save();
    toast('처음 상태로 돌렸어요');
    app.home();
  });
  rb.disabled = true;
  rb.style.marginTop = '8px';
  ri.addEventListener('input', () => (rb.disabled = ri.value.trim() !== '초기화'));
  wrap.append(ri, rb);
  wrap.appendChild(el('div')).style.height = '30px';

  root.appendChild(wrap);
  app.show('screen-parent', { title: '보호자', mode: 'page' });
}

function save(fn) {
  fn(app.state);
  app.save();
}

const STATUS = { unseen: '아직 안 만남', learning: '배우는 중', reviewing: '수집 · 복습 중', mastered: '숙련' };

function statusText(id) {
  const p = app.state.words[id];
  if (!p || (!p.introducedAt && !p.discoveredAt)) return STATUS.unseen;
  if (isMastered(p)) return STATUS.mastered;
  if (p.discoveredAt) return `${STATUS.reviewing} · ${p.dates.length}일 혼자 맞힘`;
  return STATUS.learning;
}

function wordRow(id, sub, control) {
  const w = app.content.words[id];
  const row = el('div', 'wrow');
  const box = el('div', 'art-box');
  box.appendChild(artEl(w));
  const info = el('div');
  const name = el('b', null, w.en);
  name.addEventListener('click', () => {
    audio.unlock();
    audio.play(audio.wordSrc(id));
  });
  info.append(name, el('span', null, `${w.ko} · ${sub}`));
  row.append(box, info, control || el('span'));
  return row;
}

async function cacheAll(btn) {
  if (!('caches' in window)) return toast('이 브라우저는 오프라인 저장을 지원하지 않아요');
  const { content } = app;
  const urls = new Set(['./', 'index.html', 'css/style.css', 'data/words.json', 'data/stages.json']);
  for (const w of content.list) {
    if (w.art.src) urls.add(w.art.src);
    for (const d of ['w', 's', 'x']) urls.add(`assets/audio/${d}/${w.id}.mp3`);
  }
  for (const k of ['welcome', 'whats_this', 'listen_choose', 'meet', 'great', 'yes', 'nice', 'wow', 'new_friend', 'again', 'break', 'done', 'gate', 'portal']) urls.add(`assets/audio/ui/${k}.mp3`);
  const list = [...urls];
  const cache = await caches.open('hello-island-assets-v1');
  btn.disabled = true;
  let done = 0;
  const step = 12;
  for (let i = 0; i < list.length; i += step) {
    await Promise.all(
      list.slice(i, i + step).map(async (u) => {
        if (!(await cache.match(u))) {
          try {
            await cache.add(u);
          } catch (e) {
            console.warn('cache', u, e);
          }
        }
        done += 1;
      }),
    );
    btn.textContent = `내려받는 중 ${Math.round((done / list.length) * 100)}%`;
  }
  btn.textContent = '오프라인 준비 완료';
}
