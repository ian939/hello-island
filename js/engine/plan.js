/* 오늘의 카드 고르기 · 보기 만들기
 *
 * 30/50/100 은 '목표 카드 수'다. 새 단어 수와는 따로 간다 (기본 5/7/10개).
 * 새 단어는 그날 최소 두 번 다른 카드로 만나고, 나머지는 복습할 단어로 채운다.
 * 7·8세 맵에서는 이전 맵 단어를 정해진 비율(70/30, 70/20/10)로 섞는다.
 */
import { daysBetween, shuffle } from './util.js';
import { isMastered } from './progress.js';

export const NEW_LIMIT = { 30: 5, 50: 7, 100: 10 };
const MIN_DISTINCT = 8; // 첫날처럼 아는 단어가 거의 없을 때 한 세션에 최소 이만큼은 섞는다
const GAP = 3; // 같은 단어는 3문제 안에 다시 나오지 않게

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

export function pickNewWords(content, state, { stageId, zoneId = null, limit }) {
  const fresh = (content.byStage[stageId] || []).filter((id) => playable(content, state, id) && !isSeen(state, id));
  if (limit <= 0 || !fresh.length) return [];
  const zoneIndex = (id) => content.zones[content.words[id].zone].index;
  const focus = zoneId ? fresh.filter((id) => content.words[id].zone === zoneId) : [];
  const rest = fresh.filter((id) => !focus.includes(id));

  // 쉬운 단계(tier)부터, 구역을 돌아가며 하나씩 — 하루에 동물만 다섯 개가 되지 않게
  const byZone = new Map();
  rest
    .sort((a, b) => content.words[a].tier - content.words[b].tier || zoneIndex(a) - zoneIndex(b) || content.words[a].no - content.words[b].no)
    .forEach((id) => {
      const key = `${content.words[id].tier}:${content.words[id].zone}`;
      if (!byZone.has(key)) byZone.set(key, []);
      byZone.get(key).push(id);
    });
  const ordered = [];
  const tiers = [...new Set(rest.map((id) => content.words[id].tier))].sort();
  for (const tier of tiers) {
    const lanes = [...byZone.entries()].filter(([k]) => k.startsWith(`${tier}:`)).map(([, v]) => v.slice());
    while (lanes.some((l) => l.length)) for (const l of lanes) if (l.length) ordered.push(l.shift());
  }
  return focus.sort((a, b) => content.words[a].no - content.words[b].no).concat(ordered).slice(0, limit);
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

/** 단어별 출제 횟수 → 카드 순서. 같은 단어는 GAP 문제 안에 다시 놓지 않는다. */
export function arrange(counts, rng) {
  const left = new Map(counts);
  const last = new Map();
  const total = [...left.values()].reduce((a, b) => a + b, 0);
  const out = [];
  for (let pos = 0; pos < total; pos += 1) {
    const live = [...left.entries()].filter(([, n]) => n > 0).map(([id]) => id);
    let pool = live.filter((id) => !last.has(id) || pos - last.get(id) >= GAP);
    if (!pool.length) pool = live.filter((id) => last.get(id) !== pos - 1);
    if (!pool.length) pool = live;
    let best = null;
    let bestW = -1;
    for (const id of pool) {
      const w = left.get(id) + rng() * 0.9;
      if (w > bestW) {
        bestW = w;
        best = id;
      }
    }
    out.push(best);
    left.set(best, left.get(best) - 1);
    last.set(best, pos);
  }
  return out;
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

/**
 * 오늘의 카드 계획.
 * @returns {{sequence:string[], intro:string[]}|null}  null = 출제할 단어가 없음
 */
export function planDaily(content, state, { target, zoneId = null, today, rng, newLimit }) {
  const stageId = state.map.current;
  const limit = newLimit ?? state.settings.newPerDay ?? NEW_LIMIT[target] ?? 5;
  const seenNow = (content.byStage[stageId] || []).filter((id) => playable(content, state, id) && isSeen(state, id));
  let fresh = pickNewWords(content, state, { stageId, zoneId, limit });
  if (seenNow.length + fresh.length < MIN_DISTINCT) {
    fresh = pickNewWords(content, state, { stageId, zoneId, limit: Math.max(limit, MIN_DISTINCT - seenNow.length) });
  }

  const counts = new Map();
  const per = target >= fresh.length * 2 ? 2 : 1;
  for (const id of fresh) counts.set(id, per);
  let remaining = target - [...counts.values()].reduce((a, b) => a + b, 0);

  // 단계 섞기 비율. 후보가 없는 단계 몫은 현재 단계로 넘긴다.
  const mix = content.mix[stageId] || { [stageId]: 100 };
  const buckets = [];
  for (const [sid, pct] of Object.entries(mix)) {
    const cands = (content.byStage[sid] || []).filter(
      (id) => playable(content, state, id) && (isSeen(state, id) || fresh.includes(id)),
    );
    buckets.push({ sid, pct, cands });
  }
  const current = buckets.find((b) => b.sid === stageId);
  for (const b of buckets) {
    if (b !== current && !b.cands.length) {
      current.pct += b.pct;
      b.pct = 0;
    }
  }
  if (!current.cands.length && !buckets.some((b) => b.cands.length)) {
    return fresh.length ? { sequence: arrange(counts, rng), intro: fresh } : null;
  }
  if (!current.cands.length) {
    // 현재 맵에 열린 단어가 없으면(드문 경우) 다른 단계에 몫을 나눈다
    const alive = buckets.filter((b) => b.cands.length);
    alive.forEach((b) => (b.pct += current.pct / alive.length));
    current.pct = 0;
  }

  const live = buckets.filter((b) => b.pct > 0 && b.cands.length);
  const totalPct = live.reduce((a, b) => a + b.pct, 0);
  let given = 0;
  live.forEach((b, i) => {
    b.n = i === live.length - 1 ? remaining - given : Math.round((remaining * b.pct) / totalPct);
    given += b.n;
  });
  for (const b of live) {
    const ranked = b.cands
      .map((id) => ({ id, s: reviewScore(state.words[id], today, rng) }))
      .sort((x, y) => y.s - x.s)
      .map((x) => x.id);
    for (let k = 0; k < b.n; k += 1) {
      const id = ranked[k % ranked.length];
      counts.set(id, (counts.get(id) || 0) + 1);
    }
  }
  remaining = 0;
  return { sequence: arrange(counts, rng), intro: fresh.filter((id) => flagOf(state, id) !== 'known') };
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
