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
import { planSession, planGate } from './engine/plan.js';
import { createSession, currentCard, present, submit, useHint, advanceIntro, summarize } from './engine/session.js';
import { refreshUnlocks, completeStage } from './engine/map.js';
import * as speak from './speak.js';

const RIGHT_SAY = ['딩동! 맞았어', '잘 들었어!', '바로 그거야!', '멋져!'];
const NEW_SAY = '새 친구를 만났어!';
const WRONG_SAY = '괜찮아! 이 친구는 이따 다시 만나자';

/** 섬 전체(서로 다른 단어 30개) 또는 고른 구역(그 구역 단어 전부)으로 한 판 시작 */
export function startSession(zoneId = null) {
  const { content, state } = app;
  const today = app.today();
  const plan = planSession(content, state, { zoneId, today, rng: app.rng });
  if (!plan) {
    toast('지금 열린 구역에 준비된 단어가 없어요');
    return;
  }
  state.session = createSession(content, state, { sequence: plan.sequence, intro: plan.intro, zoneId, today, rng: app.rng });
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
      // 단어를 한 번 듣고 → 그 단어가 들어간 쉬운 문장 팝업
      const next = res.finished ? finish : res.breakNow ? showBreak : renderQuiz;
      const started = Date.now();
      audio.play(audio.wordSrc(card.word)).then(() => {
        const wait = Math.max(0, 900 - (Date.now() - started));
        setTimeout(() => {
          if (app.state.session === s) showSentence(w, next);
        }, wait);
      });
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

/* ---------- 정답 뒤 문장 팝업 ----------
 * 그 단어가 들어간 아주 쉬운 문장 + 한글 해석 + 문장 소리.
 * '다음'은 3초 동안 잠겨 있다 (막대가 차오르면 눌러서 넘어간다). */
const SENTENCE_LOCK_MS = 3000;

/* 문장을 낱말 칸으로 — 단어는 노랑, 따라 말하기 뒤에는 맞힌 낱말 초록 / 놓친 낱말 점선 */
function sentenceLine(w) {
  const p = el('p', 'line-en');
  const keys = speak.words(w.en);
  const tokens = w.sentence.split(' ');
  const map = []; // 비교용 낱말 번호 → 칸
  tokens.forEach((tok, i) => {
    // 영어 낱말 위, 한글 읽기 아래 — 아이가 소리 내어 따라 할 수 있게
    const span = el('span', 'tok');
    span.append(el('span', 'tok-en', tok), el('span', 'tok-ko', (w.sentenceRead || [])[i] || ''));
    const norm = speak.words(tok);
    if (norm.some((n) => keys.some((k) => n.startsWith(k)))) span.classList.add('is-key');
    norm.forEach(() => map.push(span));
    p.append(span);
    if (i < tokens.length - 1) p.append(document.createTextNode(' '));
  });
  p.paint = (hit) => {
    map.forEach((span) => span.classList.remove('is-hit', 'is-miss'));
    hit.forEach((ok, k) => {
      const span = map[k];
      if (!span) return;
      // 낱말 하나가 둘로 나뉜 경우(yo-yo 등) 하나라도 놓치면 놓친 것으로
      if (!ok) {
        span.classList.remove('is-hit');
        span.classList.add('is-miss');
      } else if (!span.classList.contains('is-miss')) span.classList.add('is-hit');
    });
  };
  return p;
}

function micIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML =
    '<rect x="8" y="2.5" width="8" height="12" rx="4" fill="currentColor"/>' +
    '<path d="M5 11a7 7 0 0 0 14 0M12 18v3.5M8.5 21.5h7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>';
  return s;
}

/* 정답 뒤 문장 팝업
 * 따라 말하기를 쓸 수 있으면: 말하기 → 내 목소리 한 번 듣기 → 70% 넘으면 '다음' (3번 안 되면 격려하고 '다음')
 * 못 쓰면(마이크·인식·인터넷 없음, 보호자가 끔): 3초 뒤에 '다음' */
function showSentence(w, next) {
  const st = app.state;
  const sess = st.session;
  const practice = st.settings.speak !== false && speak.isAvailable();
  openSheet(
    (sh) => {
      sh.classList.add('sheet--line');
      const art = el('div', 'sheet-art');
      art.appendChild(artEl(w, { motion: !st.settings.calm }));
      const line = sentenceLine(w);
      const again = button('helper', null, () => playWith(again, audio.sentenceSrc(w.id, true))); // 80% 속도
      again.append(earIcon(), document.createTextNode('문장 듣기'));
      const go = button('cta line-go', '다음 ▶');
      go.disabled = true;
      go.addEventListener('click', () => {
        if (go.disabled) return;
        audio.stop();
        closeSheet();
        next();
      });
      const ready = () => {
        go.disabled = false;
        go.classList.add('is-ready');
      };
      sh.append(art, line, el('p', 'line-ko', w.sentenceKo));

      if (!practice) {
        const fill = el('b');
        const bar = el('i', 'line-bar');
        bar.appendChild(fill);
        go.appendChild(bar);
        sh.append(again, go);
        fill.style.transitionDuration = `${SENTENCE_LOCK_MS}ms`;
        setTimeout(() => {
          fill.getBoundingClientRect(); // 0% 상태를 한 번 그린 뒤에 늘려야 차오르는 게 보인다
          fill.style.width = '100%';
        }, 30);
        setTimeout(ready, SENTENCE_LOCK_MS);
        return;
      }

      // ----- 따라 말하기 -----
      let tries = 0;
      let listening = null;
      let mineUrl = null;
      let passed = false;

      const box = el('div', 'speak');
      const mic = button('mic');
      const micLabel = el('span', null, '따라 말하기');
      mic.append(micIcon(), micLabel);
      const meter = el('div', 'speak-meter');
      const meterFill = el('i');
      const meterText = el('span', null, `${Math.round(speak.PASS * 100)}% 넘으면 통과`);
      meter.append(meterFill, meterText);
      const sayLine = el('p', 'speak-say', '문장을 듣고 똑같이 말해 봐!');
      const mine = button('helper is-hidden', null, () => mineUrl && playWith(mine, mineUrl));
      mine.append(earIcon(), document.createTextNode('내 목소리'));
      const tools = el('div', 'helper-row');
      tools.append(again, mine);
      box.append(mic, sayLine, meter);
      sh.append(tools, box, go);
      sh.addEventListener('sheet-close', () => {
        if (listening) listening.stop();
        if (mineUrl) URL.revokeObjectURL(mineUrl);
      }, { once: true });

      mic.addEventListener('click', async () => {
        if (listening) {
          listening.stop();
          return;
        }
        audio.stop();
        audio.unlock();
        tries += 1;
        mic.classList.add('is-on');
        micLabel.textContent = '다 말했어';
        sayLine.textContent = '말해 봐! 다 말하면 버튼을 눌러';
        listening = speak.listenOnce();
        const res = await listening.done;
        listening = null;
        mic.classList.remove('is-on');
        if (!document.body.contains(mic)) return; // 그새 창이 닫혔다
        if (res.error) {
          speak.markBlocked();
          sayLine.textContent = '마이크를 쓸 수 없어서 이번엔 건너뛸게';
          micLabel.textContent = '따라 말하기';
          mic.disabled = true;
          ready();
          return;
        }
        const r = speak.bestOf(w.sentence, res.transcripts);
        line.paint(r.hit);
        const pct = Math.round(r.ratio * 100);
        meterFill.style.width = `${pct}%`;
        meterText.textContent = `${pct}%`;
        meter.classList.toggle('is-pass', r.ratio >= speak.PASS);
        if (mineUrl) URL.revokeObjectURL(mineUrl);
        mineUrl = res.url;
        if (mineUrl) mine.classList.remove('is-hidden');
        recordSpeak(w.id, r.ratio, tries);

        // 내 목소리를 한 번 들어 본 뒤에 결과
        mic.disabled = true;
        if (mineUrl) {
          sayLine.textContent = '내 목소리를 들어 보자';
          await playWith(mine, mineUrl);
        }
        mic.disabled = false;
        if (r.ratio >= speak.PASS) {
          audio.sfx('star');
          sayLine.textContent = `잘했어! ${pct}% 따라 말했어`;
          micLabel.textContent = '한 번 더 말하기';
          if (!passed && sess) sess.speakPass = (sess.speakPass || 0) + 1;
          passed = true;
          ready();
        } else if (tries < speak.MAX_TRIES && !passed) {
          sayLine.textContent = `조금만 더! 문장을 다시 듣고 말해 봐 (${tries}/${speak.MAX_TRIES})`;
          micLabel.textContent = '다시 말하기';
        } else {
          if (!passed) sayLine.textContent = '잘했어! 다음에 또 해 보자';
          micLabel.textContent = '한 번 더 말하기';
          ready();
        }
        app.save();
      });
    },
    { dismissable: false },
  );
  audio.play(audio.sentenceSrc(w.id));
}

/* 따라 말하기 기록 (보호자 화면용) */
function recordSpeak(id, ratio, tries) {
  const st = app.state;
  const p = st.words[id];
  if (p) p.speakBest = Math.max(p.speakBest || 0, Math.round(ratio * 100));
  const s = st.session;
  if (s) {
    s.speakTries = (s.speakTries || 0) + 1;
    if (tries === 1) s.speakCards = (s.speakCards || 0) + 1;
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
