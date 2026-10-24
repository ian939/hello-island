/* 한 판의 카드 고르기 · 보기 만들기
 *
 * 한 판 = 서로 다른 단어 10~30개 (같은 단어를 한 판에 두 번 내지 않는다).
 * 구역을 고르면 그 구역 단어 전부(6세 구역은 대부분 30개, 색 12·숫자 10), 섬 전체면 30장.
 * 고르는 순서: 복습할 때가 된·최근 틀린 단어 → 아직 못 만난 단어 → 나머지.
 * 7·8세 맵에서는 이전 맵 단어를 정해진 비율(70/30, 70/20/10)로 섞는다.
 * 틀린 카드만 같은 판에서 4~7장 뒤에 다시 나온다.
 */
import { daysBetween, shuffle } from './util.js';
import { isMastered } from './progress.js';

export const MAX_CARDS = 30;
export const MIN_CARDS = 10;

export const flagOf = (state, id) => (state.flags && state.flags[id]) || null;

export function isSeen(state, id) {
  const p = state.words[id];
  return Boolean((p && (p.introducedAt || p.discoveredAt)) || flagOf(state, id) === 'known');
}

/** 지금 출제할 수 있는 단어: 그림·음성 준비됨 + 제외 아님 + 열린 구역 */
export function playable(content, state, id) {
  const w = content.words[id];
  return Boolean(w && w.ready && flagOf(state, id) !== 'exclude' && state.map.unlockedZones.includes(w.zone));
}

export function reviewScore(p, today, rng) {
  let s = rng() * 0.8;
  if (!p) return s + 2;
  if (!p.discoveredAt) s += 3; // 소개만 받고 아직 못 모은 단어
  if (p.due && p.due <= today) s += 3 + Math.min(daysBetween(p.due, today), 5) * 0.3;
  const last = p.recent[p.recent.length - 1];
  if (last && (!last.ok || last.h)) s += 2;
  if (p.lastSeen && daysBetween(p.lastSeen, today) >= 3) s += 1;
  if (isMastered(p)) s -= 1.5;
  return s;
}

/** 한 단계(맵)의 후보를 우선순위대로: 복습할 때 된 단어 → 못 만난 단어 → 나머지 */
function rankStage(content, state, ids, today, rng) {
  const seen = ids.filter((id) => isSeen(state, id));
  const scored = seen.map((id) => ({ id, s: reviewScore(state.words[id], today, rng) })).sort((a, b) => b.s - a.s);
  const urgent = scored.filter((x) => x.s >= 2.8).map((x) => x.id);
  const rest = scored.filter((x) => x.s < 2.8).map((x) => x.id);
  const fresh = orderFresh(content, ids.filter((id) => !isSeen(state, id)));
  return [...urgent, ...fresh, ...rest];
}

/** 아직 못 만난 단어: 쉬운 단계(tier)부터, 구역을 돌아가며 하나씩 */
function orderFresh(content, ids) {
  const zoneIndex = (id) => content.zones[content.words[id].zone].index;
  const lanes = new Map();
  ids
    .slice()
    .sort((a, b) => content.words[a].tier - content.words[b].tier || zoneIndex(a) - zoneIndex(b) || content.words[a].no - content.words[b].no)
    .forEach((id) => {
      const key = `${content.words[id].tier}:${content.words[id].zone}`;
      if (!lanes.has(key)) lanes.set(key, []);
      lanes.get(key).push(id);
    });
  const out = [];
  const tiers = [...new Set(ids.map((id) => content.words[id].tier))].sort();
  for (const tier of tiers) {
    const ls = [...lanes.entries()].filter(([k]) => k.startsWith(`${tier}:`)).map(([, v]) => v);
    while (ls.some((l) => l.length)) for (const l of ls) if (l.length) out.push(l.shift());
  }
  return out;
}

/**
 * 한 판 계획. 서로 다른 단어 최대 30개.
 * @returns {{sequence:string[], intro:string[]}|null}  null = 출제할 단어가 없음
 */
export function planSession(content, state, { zoneId = null, today, rng, max = MAX_CARDS }) {
  const stageId = state.map.current;
  const open = (sid) => (content.byStage[sid] || []).filter((id) => playable(content, state, id));
  let picked = [];

  if (zoneId) {
    // 고른 구역 단어 전부. 너무 적으면(제외 등) 같은 지도의 열린 구역에서 채운다.
    picked = rankStage(content, state, (content.byZone[zoneId] || []).filter((id) => playable(content, state, id)), today, rng).slice(0, max);
    if (picked.length < MIN_CARDS) {
      const more = rankStage(content, state, open(stageId).filter((id) => !picked.includes(id)), today, rng);
      picked = picked.concat(more.slice(0, MIN_CARDS - picked.length));
    }
  } else {
    const mix = content.mix[stageId] || { [stageId]: 100 };
    const buckets = Object.entries(mix).map(([sid, pct]) => ({ sid, pct, list: rankStage(content, state, open(sid), today, rng) }));
    const total = Math.min(max, buckets.reduce((a, b) => a + b.list.length, 0));
    // 비율대로 나누고, 모자란 몫은 다른 단계에서 채운다
    let given = 0;
    buckets.forEach((b, i) => {
      b.n = Math.min(b.list.length, i === buckets.length - 1 ? total - given : Math.round((total * b.pct) / 100));
      given += b.n;
    });
    let short = total - buckets.reduce((a, b) => a + b.n, 0);
    for (const b of buckets) {
      const extra = Math.min(short, b.list.length - b.n);
      b.n += extra;
      short -= extra;
    }
    for (const b of buckets) picked = picked.concat(b.list.slice(0, b.n));
  }
  if (!picked.length) return null;
  // 이번 판에 처음 나오는 단어는 전부 미리 만난다 (문제에 나올 새 단어를 빠짐없이 먼저 듣고 보게)
  const intro = picked.filter((id) => !isSeen(state, id));
  return { sequence: shuffle(picked, rng), intro };
}

function sharesGroup(a, b) {
  if (!a.confuse.length || !b.confuse.length) return false;
  return a.confuse.some((g) => b.confuse.includes(g));
}

/** 이 둘을 한 문제의 보기로 같이 내도 되는가 */
export function canPair(a, b) {
  if (a.id === b.id) return false;
  if (a.en.toLowerCase() === b.en.toLowerCase()) return false;
  if (a.cls !== b.cls) return false;
  if (sharesGroup(a, b)) return false;
  if (a.cls === 'number') {
    const gap = Math.max(a.numberGap || 1, b.numberGap || 1);
    if (Math.abs(a.value - b.value) <= gap) return false;
  }
  return true;
}

/** 정답 1개 + 오답 (choices-1)개. 오답은 같은 구역에서 하나, 나머지는 열린 맵 전체에서. */
export function pickOptions(content, state, wordId, choices, rng) {
  const w = content.words[wordId];
  const pool = content.list.filter(
    (c) => c.ready && flagOf(state, c.id) !== 'exclude' && state.map.unlockedStages.includes(c.stage) && canPair(w, c),
  );
  const same = shuffle(pool.filter((c) => c.zone === w.zone), rng);
  const sameStage = shuffle(pool.filter((c) => c.zone !== w.zone && c.stage === w.stage), rng);
  const other = shuffle(pool.filter((c) => c.stage !== w.stage), rng);
  const picked = [];
  const take = (c) => {
    if (picked.length < choices - 1 && picked.every((p) => canPair(p, c))) picked.push(c);
  };
  if (same.length) take(same[0]);
  for (const c of [...sameStage, ...same.slice(1), ...other]) take(c);
  return shuffle([wordId, ...picked.map((c) => c.id)], rng);
}

export function choicesFor(state) {
  return state.settings.choices === 4 ? 4 : 3;
}

/** 큰 맵 졸업 전 최종 복습: 그 맵에서 서로 다른 20단어를 구역마다 고르게 */
export function planGate(content, state, stageId, rng, count = 20) {
  const stage = content.stages.find((s) => s.id === stageId);
  const lanes = stage.zones.map((z) =>
    shuffle((content.byZone[z.id] || []).filter((id) => content.words[id].ready && state.words[id] && state.words[id].discoveredAt), rng),
  );
  const picked = [];
  while (picked.length < count && lanes.some((l) => l.length)) {
    for (const l of shuffle(lanes, rng)) if (l.length && picked.length < count) picked.push(l.shift());
  }
  return shuffle(picked, rng);
}
