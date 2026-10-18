/* 저장 상태의 모양과 옛 저장본 보정(마이그레이션) */
import { blankMap } from './map.js';

export const SCHEMA = 1;

export function blankState() {
  return {
    schema: SCHEMA,
    settings: {
      choices: 3, // 3 또는 4
      slow: false, // 느린 발음을 기본으로
      muted: false,
      calm: false, // 움직임 줄이기
      speak: true, // 정답 문장 따라 말하기 (마이크·인터넷이 될 때만)
    },
    map: blankMap(),
    words: {}, // wordId → progress
    flags: {}, // wordId → 'known' | 'exclude'
    session: null,
    history: [], // 지난 판 요약 (최근 120개)
    stars: 0, // 10장마다 받는 별 조각
    seenStageIntro: [],
    createdAt: Date.now(),
  };
}

/** 빠진 필드는 기본값으로 채우되, 수집·숙련 기록은 절대 버리지 않는다 */
export function migrate(raw) {
  const base = blankState();
  if (!raw || typeof raw !== 'object') return base;
  const map = { ...base.map, ...(raw.map || {}) };
  map.gate = { ...base.map.gate, ...((raw.map && raw.map.gate) || {}) };
  for (const k of ['unlockedStages', 'unlockedZones', 'completedStages', 'parentUnlocked']) {
    if (!Array.isArray(map[k])) map[k] = base.map[k].slice();
  }
  if (!map.unlockedStages.includes('age6')) map.unlockedStages.unshift('age6');
  const session = raw.session && raw.session.order ? { stage: 'age6', kind: 'daily', ...raw.session } : null;
  return {
    ...base,
    ...raw,
    schema: SCHEMA,
    settings: { ...base.settings, ...(raw.settings || {}) },
    map,
    words: raw.words || {},
    flags: raw.flags || {},
    session,
    history: Array.isArray(raw.history) ? raw.history.slice(-120) : [],
    stars: Number(raw.stars) || 0,
    seenStageIntro: Array.isArray(raw.seenStageIntro) ? raw.seenStageIntro : [],
  };
}
