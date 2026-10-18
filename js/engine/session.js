/* 탐험 한 판(세션)의 카드 큐.
 *
 * - 시작할 때 서로 다른 단어로 N장(10~30)을 만든다. 오답 재도전은 '추가 출제'라 답한 횟수는 N보다 늘 수 있다.
 * - 맞힌 카드는 완료, 틀린 카드는 4~7장 뒤에 다시 넣는다(남은 카드가 적으면 가능한 가장 뒤).
 * - 모든 카드를 맞혀야 끝난다. 마지막 한 장을 틀리면 바로 다시 나온다 (영원히 막히지 않게 도움을 준다).
 * - 매 답마다 저장해서, 앱을 닫았다 열어도 남은 카드와 오답 큐가 그대로 돌아온다.
 */
import { randInt, shuffle, uid } from './util.js';
import { recordCorrect, recordWrong, markIntroduced } from './progress.js';
import { pickOptions, choicesFor } from './plan.js';

export function makeCard(content, state, wordId, rng) {
  return {
    id: uid('c'),
    word: wordId,
    options: pickOptions(content, state, wordId, choicesFor(state), rng),
    attempts: 0,
    hints: 0,
    first: null,
    trimmed: false,
  };
}

export function createSession(content, state, { kind = 'daily', sequence, intro = [], target, zoneId = null, stageId, today, rng }) {
  const cards = {};
  const order = [];
  for (const wordId of sequence) {
    const card = makeCard(content, state, wordId, rng);
    cards[card.id] = card;
    order.push(card.id);
  }
  return {
    id: uid('s'),
    kind,
    stage: stageId || state.map.current,
    zone: zoneId,
    date: today,
    target: target ?? order.length,
    cards,
    order,
    intro,
    introAt: 0,
    status: intro.length ? 'intro' : 'playing',
    done: 0,
    answers: 0,
    firstRight: 0,
    firstTotal: 0,
    retries: 0,
    hints: 0,
    found: [],
    stars: 0,
    lastAnswerAt: -1,
    startedAt: Date.now(),
  };
}

export const currentCard = (s) => (s.order.length ? s.cards[s.order[0]] : null);
export const isFinished = (s) => s.done >= s.target && s.order.length === 0;

/** 새 단어 소개를 하나 마쳤다 */
export function advanceIntro(state, s, today) {
  const id = s.intro[s.introAt];
  if (id) markIntroduced(state, id, today);
  s.introAt += 1;
  if (s.introAt >= s.intro.length) s.status = 'playing';
}

/**
 * 지금 카드를 화면에 낼 준비.
 * - 두 번 이상 틀린 카드는 보기를 하나 줄인다 (최소 2개).
 * - 정답 자리가 바로 앞 문제와 같은 칸에 오지 않게 섞는다.
 */
export function present(s, rng) {
  const card = currentCard(s);
  if (!card) return null;
  if (card.attempts >= 2 && !card.trimmed && card.options.length > 2) {
    const wrong = card.options.filter((o) => o !== card.word);
    const drop = wrong[Math.floor(rng() * wrong.length)];
    card.options = card.options.filter((o) => o !== drop);
    card.trimmed = true;
  }
  let opts = shuffle(card.options, rng);
  for (let i = 0; i < 6 && opts.indexOf(card.word) === s.lastAnswerAt && opts.length > 1; i += 1) opts = shuffle(card.options, rng);
  card.options = opts;
  s.lastAnswerAt = opts.indexOf(card.word);
  return card;
}

/** '도움 듣기'를 눌렀다 — 이 시도는 숙련 판정에서 빠진다 */
export function useHint(s) {
  const card = currentCard(s);
  if (!card) return;
  card.hints += 1;
  s.hints += 1;
}

/**
 * 답을 냈다.
 * @returns {{correct, discovered, finished, breakNow, card, requeuedAt}}
 */
export function submit(state, s, chosenId, today, rng) {
  const card = currentCard(s);
  if (!card) throw new Error('no current card');
  card.attempts += 1;
  s.answers += 1;
  const correct = chosenId === card.word;
  if (card.attempts === 1) {
    card.first = correct;
    s.firstTotal += 1;
    if (correct) s.firstRight += 1;
  }

  if (correct) {
    s.order.shift();
    delete s.cards[card.id];
    s.done += 1;
    const { discovered } = recordCorrect(state, card.word, card, today);
    if (discovered) s.found.push(card.word);
    let star = false;
    if (s.done % 10 === 0) {
      state.stars = (state.stars || 0) + 1;
      s.stars += 1;
      star = true;
    }
    const finished = isFinished(s);
    if (finished) s.status = 'completed';
    return { correct, discovered, finished, star, breakNow: !finished && s.done % 10 === 0, card };
  }

  recordWrong(state, card.word, today);
  s.retries += 1;
  s.order.shift();
  let at = Math.min(randInt(rng, 4, 7), s.order.length);
  // 바로 앞뒤에 같은 단어가 붙지 않는 자리로 옮긴다
  const sameAround = (k) =>
    (k > 0 && s.cards[s.order[k - 1]].word === card.word) || (k < s.order.length && s.cards[s.order[k]].word === card.word);
  if (sameAround(at)) {
    for (const d of [1, -1, 2, -2, 3, -3]) {
      const k = at + d;
      if (k >= 1 && k <= s.order.length && !sameAround(k)) {
        at = k;
        break;
      }
    }
  }
  s.order.splice(at, 0, card.id);
  return { correct: false, discovered: false, finished: false, breakNow: false, card, requeuedAt: at };
}

/** 지난 판 요약 (보호자 기록용) */
export function summarize(s) {
  return {
    id: s.id,
    kind: s.kind,
    stage: s.stage,
    date: s.date,
    target: s.target,
    answers: s.answers,
    firstRight: s.firstRight,
    firstTotal: s.firstTotal,
    retries: s.retries,
    hints: s.hints,
    found: s.found.length,
    speakDone: s.speakDone || 0, // 따라 녹음한 문장 수
    finishedAt: Date.now(),
  };
}
