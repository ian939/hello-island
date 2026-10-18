/* 큰 맵(6·7·8세)과 구역 해금.
 *
 * - 큰 맵 졸업: 그 맵의 고유 단어를 '전부' 수집(262/120/120) + 최종 복습 20카드 완료.
 *   그림·음성이 준비되지 않은 단어가 하나라도 있으면 최종 미션이 열리지 않는다
 *   (준비된 것만 세어 조기 졸업시키지 않는다).
 * - 7·8세 구역: 앞 구역을 80%(20개 중 16개) 모으면 다음 구역이 열린다.
 * - 한 번 열린 맵·구역은 다시 잠그지 않는다.
 */

export const STAGE_ORDER = ['age6', 'age7', 'age8'];

export function blankMap() {
  return {
    current: 'age6',
    unlockedStages: ['age6'],
    unlockedZones: [],
    completedStages: [],
    gate: { age6: 'locked', age7: 'locked', age8: 'locked' },
    parentUnlocked: [],
  };
}

export const nextStage = (id) => STAGE_ORDER[STAGE_ORDER.indexOf(id) + 1] || null;

export function zoneTotals(content, state, zoneId) {
  const ids = content.byZone[zoneId] || [];
  const found = ids.filter((id) => state.words[id] && state.words[id].discoveredAt).length;
  return { found, total: ids.length };
}

export function stageTotals(content, state, stageId) {
  const ids = content.byStage[stageId] || [];
  const found = ids.filter((id) => state.words[id] && state.words[id].discoveredAt).length;
  const ready = ids.filter((id) => content.words[id].ready).length;
  return { found, total: ids.length, ready };
}

/**
 * 해금 상태를 다시 계산한다. 새로 열린 구역과 최종 미션 준비 여부를 돌려준다.
 * 이미 열린 것은 그대로 둔다.
 */
export function refreshUnlocks(content, state) {
  const map = state.map;
  const events = [];
  for (const stage of content.stages) {
    if (!map.unlockedStages.includes(stage.id)) continue;
    stage.zones.forEach((zone, i) => {
      if (map.unlockedZones.includes(zone.id)) return;
      let open = false;
      if (zone.unlock.kind === 'stage_available') open = true;
      else if (zone.unlock.kind === 'prior_zone_collection_ratio') {
        const prev = stage.zones[i - 1];
        const t = zoneTotals(content, state, prev.id);
        open = map.unlockedZones.includes(prev.id) && t.found >= Math.ceil(t.total * zone.unlock.threshold);
      }
      if (open) {
        map.unlockedZones.push(zone.id);
        events.push({ type: 'zone', zoneId: zone.id, stageId: stage.id });
      }
    });

    if (map.gate[stage.id] === 'locked' && !map.completedStages.includes(stage.id)) {
      const t = stageTotals(content, state, stage.id);
      if (t.total > 0 && t.found === t.total && t.ready === t.total) {
        map.gate[stage.id] = 'ready';
        events.push({ type: 'gate', stageId: stage.id });
      }
    }
  }
  return events;
}

/** 최종 복습 미션을 모두 맞혔을 때: 맵 졸업 + 다음 맵 열기 */
export function completeStage(content, state, stageId) {
  const map = state.map;
  map.gate[stageId] = 'completed';
  if (!map.completedStages.includes(stageId)) map.completedStages.push(stageId);
  const next = nextStage(stageId);
  const events = [{ type: 'stageDone', stageId }];
  if (next && !map.unlockedStages.includes(next)) {
    map.unlockedStages.push(next);
    map.current = next;
    events.push({ type: 'stage', stageId: next });
  }
  return events.concat(refreshUnlocks(content, state));
}

/** 보호자가 다음 맵을 직접 연다 (아이가 이미 그 난이도를 소화할 때) */
export function parentUnlockStage(content, state, stageId, allZones = false) {
  const map = state.map;
  if (!map.unlockedStages.includes(stageId)) map.unlockedStages.push(stageId);
  if (!map.parentUnlocked.includes(stageId)) map.parentUnlocked.push(stageId);
  if (allZones) {
    const stage = content.stages.find((s) => s.id === stageId);
    for (const z of stage.zones) if (!map.unlockedZones.includes(z.id)) map.unlockedZones.push(z.id);
  }
  return refreshUnlocks(content, state);
}

export const isZoneOpen = (state, zoneId) => state.map.unlockedZones.includes(zoneId);
export const isStageOpen = (state, stageId) => state.map.unlockedStages.includes(stageId);
