/* 단어별 학습 기록 — 처음 수집(discovered)과 숙련(mastered)을 따로 센다.
 *
 * 숙련은 그날의 마지막 정답이 아니라 '다른 날에도 스스로 다시 맞히는지'로 본다:
 *   - 첫 시도에, 도움 없이 맞힌 날짜만 dates 에 쌓는다 (같은 날 여러 번은 한 번).
 *   - dates 2일 이상 → 친해짐, 3일 이상 + 최근 3번 중 2번 이상 첫 시도 정답 → 반짝 숙련.
 * 숙련 뒤에 틀려도 도감 스티커는 회수하지 않는다 (복습 간격만 줄인다).
 */
import { addDays } from './util.js';

const INTERVALS = [1, 3, 7, 14, 30];

export function blankProgress() {
  return {
    introducedAt: null,
    discoveredAt: null,
    seen: 0,
    firstTry: 0,
    wrong: 0,
    hints: 0,
    listens: 0,
    dates: [],
    recent: [],
    due: null,
    lastSeen: null,
  };
}

export function getProgress(state, wordId) {
  if (!state.words[wordId]) state.words[wordId] = blankProgress();
  return state.words[wordId];
}

/** 처음 만난 단어 표시 (새 단어 소개 화면, 또는 보호자가 '이미 앎' 표시) */
export function markIntroduced(state, wordId, today) {
  const p = getProgress(state, wordId);
  if (!p.introducedAt) p.introducedAt = today;
}

/** 오답 1번 — 그 카드의 다음 시도가 남아 있으므로 기록만 한다 */
export function recordWrong(state, wordId, today) {
  const p = getProgress(state, wordId);
  p.wrong += 1;
  p.due = addDays(today, 1);
  p.lastSeen = today;
}

/**
 * 카드 하나를 결국 맞혔을 때.
 * @returns {{discovered:boolean}} 이번에 처음 수집했는지
 */
export function recordCorrect(state, wordId, card, today) {
  const p = getProgress(state, wordId);
  const clean = card.attempts === 1 && card.hints === 0;
  p.seen += 1;
  p.lastSeen = today;
  if (!p.introducedAt) p.introducedAt = today;
  if (card.hints > 0) p.hints += card.hints;
  if (clean) p.firstTry += 1;

  p.recent.push({ d: today, ok: card.attempts === 1, h: card.hints > 0 });
  if (p.recent.length > 6) p.recent.shift();

  if (clean) {
    if (!p.dates.includes(today)) p.dates.push(today);
    // 오늘 이미 틀리거나 도움을 받은 적이 있으면 간격을 늘리지 않는다
    const shakyToday = p.recent.slice(0, -1).some((r) => r.d === today && (!r.ok || r.h));
    if (!shakyToday) {
      const step = Math.min(p.dates.length - 1, INTERVALS.length - 1);
      p.due = addDays(today, INTERVALS[step]);
    }
  } else {
    p.due = addDays(today, 1);
  }

  let discovered = false;
  if (!p.discoveredAt) {
    p.discoveredAt = today;
    discovered = true;
  }
  return { discovered };
}

/** 도감 단계: 0 미발견 · 1 수집 · 2 친해짐 · 3 반짝 숙련 */
export function level(p) {
  if (!p || !p.discoveredAt) return 0;
  if (isMastered(p)) return 3;
  if (p.dates.length >= 2) return 2;
  return 1;
}

export function isMastered(p) {
  if (!p || p.dates.length < 3) return false;
  const last = p.recent.slice(-3);
  return last.filter((r) => r.ok && !r.h).length >= 2;
}

export function status(p) {
  if (!p || (!p.introducedAt && !p.discoveredAt)) return 'unseen';
  if (isMastered(p)) return 'mastered';
  if (p.discoveredAt && p.dates.length >= 1) return 'reviewing';
  return 'learning';
}
