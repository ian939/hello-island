/* 헬로 아일랜드 — 앱 진입점: 데이터 불러오기, 화면 전환, 홈 · 지도 · 도감 */
import { buildContent } from './engine/content.js';
import { localDate, makeRng } from './engine/util.js';
import { refreshUnlocks, stageTotals, zoneTotals, isZoneOpen, isStageOpen } from './engine/map.js';
import { level } from './engine/progress.js';
import { loadState, saveState } from './store.js';
import * as audio from './audio.js';
import { artEl } from './art.js';
import { $, el, button, tint, openSheet, closeSheet, toast, earIcon } from './ui.js';
import { startDaily, startGate, resumeSession } from './quiz.js';
import { openParent } from './parent.js';

const EMBLEM = { age6: 'assets/ui/island.webp', age7: 'assets/ui/town.webp', age8: 'assets/ui/space.webp' };
const STAGE_LABEL = { age6: '6세 맵', age7: '7세 맵', age8: '8세 맵' };

export const app = {
  content: null,
  state: null,
  rng: makeRng(),
  pending: [], // 홈에서 차례로 보여 줄 소식 (구역 열림, 최종 미션 준비, 새 지도)
  today: () => localDate(),
  save() {
    saveState(app.state);
  },
  show,
  home: renderHome,
  map: renderMap,
  dex: renderDex,
  emblem: (stageId) => EMBLEM[stageId],
  stageLabel: (stageId) => STAGE_LABEL[stageId],
  sayWord(id, { slow = app.state.settings.slow } = {}) {
    const p = app.state.words[id];
    if (p) p.listens = (p.listens || 0) + 1;
    return audio.play(audio.wordSrc(id, slow));
  },
  queueEvents(events) {
    for (const e of events) if (e.type !== 'stageDone') app.pending.push(e);
  },
};

/* ---------- 화면 전환 ---------- */
function show(id, { title = '헬로 아일랜드', mode = 'home' } = {}) {
  document.querySelectorAll('.screen').forEach((s) => s.classList.toggle('is-on', s.id === id));
  $('#mast-title').textContent = title;
  // 머리띠 버튼: 홈 = 소리·보호자 / 퀴즈 = 소리·잠시 쉬기 / 그 밖 = 처음으로
  $('#btn-parent').classList.toggle('is-hidden', mode !== 'home');
  $('#btn-pause').classList.toggle('is-hidden', mode !== 'play');
  $('#btn-home').classList.toggle('is-hidden', mode !== 'page');
}

function syncSoundButton() {
  const m = app.state.settings.muted;
  $('#btn-sound').textContent = m ? '소리 켜기' : '소리 끄기';
  audio.setMuted(m);
}

/* ---------- 홈 ---------- */
function renderHome() {
  audio.stop();
  const { content, state } = app;
  app.queueEvents(refreshUnlocks(content, state));
  app.save();
  const stage = content.stages.find((s) => s.id === state.map.current);
  const ids = content.byStage[stage.id];
  const t = stageTotals(content, state, stage.id);
  const root = $('#home-body');
  root.replaceChildren();

  // 히어로: 지도 엠블럼 + 이름 + 모은 수 + 모자이크
  const hero = el('div', 'hero');
  const top = el('div', 'hero-top');
  const emblem = button('emblem', null, () => renderMap());
  emblem.style.setProperty('--stage', stage.color);
  emblem.setAttribute('aria-label', '탐험 지도 보기');
  const img = el('img');
  img.src = EMBLEM[stage.id];
  img.alt = '';
  emblem.append(img, el('span', 'emblem-tag', STAGE_LABEL[stage.id]));
  const text = el('div', 'hero-text');
  const first = content.words[ids[0]].no;
  const last = content.words[ids[ids.length - 1]].no;
  text.append(el('p', 'eyebrow', `단어 도감 No. ${pad(first)} — ${pad(last)}`), el('h2', 'hero-title', stage.short));
  const bar = el('div', 'bar');
  const fill = el('i');
  fill.style.width = `${(t.found / t.total) * 100}%`;
  bar.appendChild(fill);
  const note = el('p', 'hero-note');
  note.append(el('span', null, `친구 ${t.found} / ${t.total}`));
  const stars = el('span', 'stars');
  const sImg = el('img');
  sImg.src = 'assets/ui/star.webp';
  sImg.alt = '';
  stars.append(sImg, document.createTextNode(`별 조각 ${state.stars}`));
  note.appendChild(stars);
  text.append(bar, note);
  top.append(emblem, text);

  const mosaicWrap = el('div');
  const mosaic = el('div', 'mosaic');
  mosaic.setAttribute('aria-label', `도감 ${t.total}칸 중 ${t.found}칸`);
  for (const id of ids) {
    const w = content.words[id];
    const cell = el('i');
    cell.style.setProperty('--c', content.zones[w.zone].color);
    const lv = level(state.words[id]);
    if (lv >= 1) cell.classList.add('is-found');
    if (lv === 2) cell.classList.add('is-star');
    if (lv === 3) cell.classList.add('is-shine');
    mosaic.appendChild(cell);
  }
  mosaicWrap.append(mosaic, el('p', 'mosaic-cap', `${t.total}칸 중 ${t.found}칸 채움 · ${Math.round((t.found / t.total) * 100)}%`));
  hero.append(top, mosaicWrap);
  root.appendChild(hero);

  // 시작 / 이어하기
  const s = state.session;
  if (s && s.status !== 'completed') {
    const yesterday = s.date !== app.today();
    const cta = button('cta', s.kind === 'gate' ? '최종 미션 이어하기' : '이어서 탐험하기', () => {
      audio.unlock();
      resumeSession();
    });
    cta.appendChild(el('small', null, `${yesterday ? '전에 하던 탐험 · ' : ''}${s.done} / ${s.target}장`));
    root.appendChild(cta);
  } else {
    const cta = button('cta', '탐험 시작', () => openGoalSheet(null));
    cta.appendChild(el('small', null, `오늘 목표 고르기`));
    root.appendChild(cta);
  }

  const gate = state.map.gate[stage.id];
  if (gate === 'ready') {
    const g = button('cta cta--gate', '최종 미션 · 새 지도 문 열기', () => {
      if (state.session && state.session.status !== 'completed') {
        toast('하던 탐험을 먼저 끝내면 열 수 있어');
        return;
      }
      audio.unlock();
      startGate(stage.id);
    });
    g.appendChild(el('small', null, `${t.total}명 모두 모았어! 20장 복습`));
    root.appendChild(g);
  } else if (t.found === t.total && t.ready < t.total) {
    root.appendChild(el('p', 'hint', '그림이나 소리가 아직 준비되지 않은 친구가 있어 최종 미션은 조금 뒤에 열려요.'));
  }

  // 구역 타일
  root.appendChild(el('p', 'rule', '구역 골라 탐험'));
  const grid = el('div', 'zone-grid');
  stage.zones.forEach((z, i) => {
    const open = isZoneOpen(state, z.id);
    const zt = zoneTotals(content, state, z.id);
    const tile = button(`zone${open ? '' : ' is-locked'}`);
    tint(tile, z.color);
    const head = el('div', 'zone-head');
    head.append(el('span', 'zone-name', z.title), el('span', 'zone-count', `${zt.found}/${zt.total}`));
    const body = el('div', 'zone-body');
    if (open) {
      const faces = el('div', 'zone-faces');
      for (const id of content.byZone[z.id].slice(0, 5)) {
        const face = el('span', level(state.words[id]) ? '' : 'is-shadow');
        face.appendChild(artEl(content.words[id]));
        faces.appendChild(face);
      }
      const zb = el('div', 'zone-bar');
      const zf = el('i');
      zf.style.width = `${(zt.found / zt.total) * 100}%`;
      zb.appendChild(zf);
      body.append(faces, zb);
      tile.addEventListener('click', () => openGoalSheet(z.id));
    } else {
      const prev = stage.zones[i - 1];
      const need = Math.ceil(zoneTotals(content, state, prev.id).total * (z.unlock.threshold || 0.8));
      body.appendChild(el('p', 'zone-lock', `${prev.title}에서 친구 ${need}명을 모으면 열려요`));
      tile.addEventListener('click', () => toast(`${prev.title} 친구를 ${need}명 모으면 열려요`));
    }
    tile.append(head, body);
    grid.appendChild(tile);
  });
  root.appendChild(grid);

  root.appendChild(el('p', 'rule', '더 보기'));
  const menu = el('div', 'menu');
  const all = content.list.filter((w) => state.words[w.id] && state.words[w.id].discoveredAt).length;
  menu.append(
    menuRow('내 도감', `${all} / ${content.list.length}`, () => renderDex(stage.id)),
    menuRow('탐험 지도', state.map.unlockedStages.map((x) => STAGE_LABEL[x].replace(' 맵', '')).join(' · '), () => renderMap()),
  );
  root.appendChild(menu);
  root.appendChild(
    el(
      'p',
      'colophon',
      '그림 Microsoft Fluent Emoji 3D (MIT) · 일부 그림 Codex 이미지 생성 · 영어 발음 Microsoft Edge 음성 (en-US Ana) · 6·7·8세는 게임 단계 이름이며 공인 연령별 어휘표가 아닙니다.',
    ),
  );

  show('screen-home', { title: '헬로 아일랜드', mode: 'home' });
  showPending();
}

function menuRow(label, meta, onClick) {
  const b = button('menu-row', null, onClick);
  b.append(el('span', 'menu-label', label), el('span', 'menu-meta', meta));
  return b;
}

const pad = (n) => String(n).padStart(3, '0');
app.pad = pad;

/* 오늘 몇 장? — 30/50/100. 같은 축하를 받는다 (100이 더 좋은 아이가 아니다). */
function openGoalSheet(zoneId) {
  const { state, content } = app;
  if (state.session && state.session.status !== 'completed') {
    openSheet((sh) => {
      sh.append(el('h2', 'sheet-title', '하던 탐험이 있어'), el('p', 'sheet-text', `${state.session.done} / ${state.session.target}장까지 했어.\n이어서 할까?`));
      const b = el('div', 'sheet-buttons');
      b.append(
        button('btn btn--go', '이어서 하기', () => {
          audio.unlock();
          closeSheet();
          resumeSession();
        }),
        button('btn', '닫기', closeSheet),
      );
      sh.appendChild(b);
    });
    return;
  }
  const zone = zoneId ? content.zones[zoneId] : null;
  openSheet((sh) => {
    sh.append(el('p', 'sheet-eyebrow', zone ? zone.title : content.stages.find((s) => s.id === state.map.current).short), el('h2', 'sheet-title', '오늘은 몇 장 할까?'));
    const goals = el('div', 'goals');
    for (const n of [30, 50, 100]) {
      const g = button('goal', null, () => {
        audio.unlock();
        audio.sfx('tap');
        closeSheet();
        startDaily(n, zoneId);
      });
      g.append(el('b', null, String(n)), el('span', null, `장`));
      if (n === state.settings.goal) g.appendChild(el('em', null, n === 30 ? '추천' : '늘 하던 것'));
      goals.appendChild(g);
    }
    sh.append(goals, el('p', 'hint', '많이 고르면 중간에 쉬었다가 나중에 이어 해도 돼요.'), button('btn', '닫기', closeSheet));
  });
}
app.openGoalSheet = openGoalSheet;

/* 홈에 돌아왔을 때 소식 띄우기 */
function showPending() {
  const e = app.pending.shift();
  if (!e) return;
  const { content } = app;
  if (e.type === 'zone') {
    const z = content.zones[e.zoneId];
    // 큰 맵이 막 열렸을 때의 첫 구역은 지도 소식으로 대신한다
    if (z.index === 0) return showPending();
    openSheet(
      (sh) => {
        const art = el('div', 'sheet-art');
        const im = el('img', 'art');
        im.src = 'assets/ui/door.webp';
        art.appendChild(im);
        sh.append(el('p', 'sheet-eyebrow', '새 구역'), el('h2', 'sheet-title', `${z.title}\n문이 열렸어!`), art, button('btn btn--go', '좋아!', closeSheet));
      },
      { close: showPending },
    );
    audio.sfx('star');
  } else if (e.type === 'gate') {
    const s = content.stages.find((x) => x.id === e.stageId);
    openSheet(
      (sh) => {
        const art = el('div', 'sheet-art');
        const im = el('img', 'art');
        im.src = 'assets/ui/sparkles.webp';
        art.appendChild(im);
        sh.append(
          el('p', 'sheet-eyebrow', s.short),
          el('h2', 'sheet-title', `친구 ${s.count}명을\n모두 모았어!`),
          art,
          el('p', 'sheet-text', '마지막 복습 20장을 다 맞히면\n새 지도로 가는 문이 열려.'),
          button('btn btn--go', '알았어!', closeSheet),
        );
      },
      { close: showPending },
    );
    audio.play(audio.uiSrc('wow'));
  } else if (e.type === 'stage') {
    const s = content.stages.find((x) => x.id === e.stageId);
    openSheet(
      (sh) => {
        const art = el('div', 'sheet-art');
        const im = el('img', 'art mv-float');
        im.src = EMBLEM[s.id];
        art.appendChild(im);
        sh.append(el('p', 'sheet-eyebrow', STAGE_LABEL[s.id]), el('h2', 'sheet-title', `새 지도\n${s.short}!`), art, el('p', 'sheet-text', s.subtitle), button('btn btn--go', '떠나자!', closeSheet));
      },
      { close: () => {
        renderHome();
      } },
    );
    audio.play(audio.uiSrc('portal'));
  } else showPending();
}

/* ---------- 탐험 지도 (큰 맵 3개) ---------- */
function renderMap() {
  audio.stop();
  const { content, state } = app;
  const root = $('#map-body');
  root.replaceChildren();
  const maps = el('div', 'maps');
  content.stages.forEach((s, i) => {
    const open = isStageOpen(state, s.id);
    const done = state.map.completedStages.includes(s.id);
    const t = stageTotals(content, state, s.id);
    const card = button(`mapcard${open ? '' : ' is-locked'}`);
    card.style.setProperty('--stage', s.color);
    const em = el('span', 'emblem');
    em.style.setProperty('--stage', s.color);
    const im = el('img');
    im.src = EMBLEM[s.id];
    im.alt = '';
    em.append(im, el('span', 'emblem-tag', STAGE_LABEL[s.id]));
    const info = el('div');
    info.append(el('h3', null, s.short), el('p', null, s.subtitle));
    const bar = el('div', 'bar');
    const f = el('i');
    f.style.width = `${(t.found / t.total) * 100}%`;
    bar.appendChild(f);
    info.append(bar, el('p', null, `친구 ${t.found} / ${t.total}`));
    const dots = el('div', 'zone-dots');
    for (const z of s.zones) {
      const d = el('span', isZoneOpen(state, z.id) ? '' : 'is-locked', z.title);
      tint(d, z.color);
      dots.appendChild(d);
    }
    info.appendChild(dots);
    if (!open) {
      const prev = content.stages[i - 1];
      info.appendChild(el('p', null, `${prev.short} 친구 ${prev.count}명을 다 모으고 최종 미션을 마치면 열려요.`));
    }
    card.append(em, info);
    if (state.map.current === s.id) card.appendChild(el('span', 'mapcard-flag', '지금 여기'));
    else if (done) card.appendChild(el('span', 'mapcard-flag mapcard-flag--done', '졸업'));
    card.addEventListener('click', () => {
      if (!open) {
        toast('아직 잠겨 있어');
        return;
      }
      if (state.map.current !== s.id) {
        if (state.session && state.session.status !== 'completed') {
          toast('하던 탐험을 먼저 끝내면 지도를 옮길 수 있어');
          return;
        }
        state.map.current = s.id;
        app.save();
      }
      renderHome();
    });
    maps.appendChild(card);
  });
  root.append(el('p', 'rule', '탐험 지도'), maps);
  show('screen-map', { title: '탐험 지도', mode: 'page' });
}

/* ---------- 도감 ---------- */
function renderDex(stageId = app.state.map.current) {
  audio.stop();
  const { content, state } = app;
  const screen = $('#screen-dex');
  screen.replaceChildren();
  const tabs = el('div', 'tabs');
  for (const s of content.stages) {
    const t = stageTotals(content, state, s.id);
    const tab = button(`tab${s.id === stageId ? ' is-on' : ''}${isStageOpen(state, s.id) ? '' : ' is-locked'}`, s.short, () => renderDex(s.id));
    tab.style.setProperty('--c', s.color);
    tab.appendChild(el('span', 'tab-count', `${t.found}/${t.total}`));
    tabs.appendChild(tab);
  }
  const scroll = el('div', 'scroll');
  const stage = content.stages.find((s) => s.id === stageId);
  for (const z of stage.zones) {
    const zt = zoneTotals(content, state, z.id);
    const head = el('div', 'dex-zone');
    tint(head, z.color);
    head.append(el('b', null, z.title), el('span', null, `${zt.found} / ${zt.total}`));
    const grid = el('div', 'dex-grid');
    for (const id of content.byZone[z.id]) {
      const w = content.words[id];
      const lv = level(state.words[id]);
      const cell = button(`cell${lv ? ' is-known' : ''}${lv === 3 ? ' is-shine' : ''}`);
      const box = el('div', 'art-box');
      box.appendChild(artEl(w));
      cell.append(box, el('span', 'cell-no', `No. ${pad(w.no)}`), el('span', 'cell-name', lv ? w.en : '???'));
      if (lv >= 2) cell.appendChild(el('span', 'cell-badge', lv === 3 ? '✦' : '★'));
      cell.addEventListener('click', () => (lv ? openDetail(id) : toast('아직 못 만난 친구야')));
      grid.appendChild(cell);
    }
    scroll.append(head, grid);
  }
  screen.append(tabs, scroll);
  show('screen-dex', { title: '내 도감', mode: 'page' });
}

const LEVEL_TEXT = ['', '처음 만난 친구', '친해진 친구 · 다른 날에도 맞혔어', '반짝 친구 · 여러 날 혼자 맞혔어'];

function openDetail(id) {
  const { content, state } = app;
  const w = content.words[id];
  const lv = level(state.words[id]);
  audio.unlock();
  openSheet((sh) => {
    const art = el('div', 'detail-art');
    art.appendChild(artEl(w, { motion: !state.settings.calm }));
    const zone = content.zones[w.zone];
    sh.append(art, el('h2', 'detail-word', w.en), el('p', 'detail-meta', `No. ${pad(w.no)} · ${zone.title}`), el('span', 'detail-level', LEVEL_TEXT[lv]));
    const row = el('div', 'detail-buttons');
    const listen = button('helper', null, () => app.sayWord(id, { slow: false }));
    listen.append(earIcon(), document.createTextNode('듣기'));
    const slow = button('helper', null, () => app.sayWord(id, { slow: true }));
    slow.append(earIcon(), document.createTextNode('천천히'));
    const sent = button('helper', null, () => audio.play([audio.wordSrc(id), audio.sentenceSrc(id)]));
    sent.append(earIcon(), document.createTextNode('문장'));
    row.append(listen, slow, sent);
    sh.append(row, button('btn', '닫기', closeSheet));
  }, { close: () => audio.stop() });
  app.sayWord(id, { slow: false });
  app.save();
}

/* ---------- 시작 ---------- */
async function boot() {
  try {
    const [wj, sj] = await Promise.all([fetch('data/words.json').then((r) => r.json()), fetch('data/stages.json').then((r) => r.json())]);
    app.content = buildContent(wj, sj);
  } catch (err) {
    $('#booting').textContent = '단어 자료를 불러오지 못했어요. 인터넷을 확인하고 다시 열어 주세요.';
    throw err;
  }
  app.state = loadState();
  // 처음 시작한 아이는 이미 열린 구역에서 출발
  app.queueEvents(refreshUnlocks(app.content, app.state).filter((e) => e.type !== 'zone'));
  app.save();

  syncSoundButton();
  document.body.classList.toggle('is-calm', app.state.settings.calm);
  audio.audioState.onSpeaking = (on) => document.body.classList.toggle('is-speaking', on);
  audio.audioState.onBlocked = () => $('#sound-gate').classList.remove('is-hidden');
  $('#sound-gate').addEventListener('click', () => {
    audio.unlock();
    $('#sound-gate').classList.add('is-hidden');
  });
  // 어디든 처음 누를 때 소리를 깨워 둔다
  window.addEventListener('pointerdown', () => audio.unlock(), { once: true, capture: true });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) audio.stop();
  });

  $('#btn-sound').addEventListener('click', () => {
    app.state.settings.muted = !app.state.settings.muted;
    app.save();
    syncSoundButton();
  });
  $('#btn-parent').addEventListener('click', () => openParent());
  $('#btn-home').addEventListener('click', () => renderHome());
  $('#btn-pause').addEventListener('click', () => {
    closeSheet();
    renderHome();
    toast('여기까지 저장했어. 언제든 이어서 해!');
  });

  renderHome();
  $('#booting').remove();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW', e));
  }
}

boot();
