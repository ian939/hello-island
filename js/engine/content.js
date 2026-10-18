/* words.json + stages.json → 엔진이 찾기 쉬운 색인 */

/** 색·숫자·도형은 닫힌 묶음: 보기는 같은 묶음끼리만 섞는다 (고양이 그림에 'red' 보기를 내지 않는다) */
export function wordClass(w) {
  if (w.art.kind === 'color') return 'color';
  if (w.art.kind === 'count') return 'number';
  if (w.art.kind === 'shape') return 'shape';
  return 'thing';
}

export function buildContent(wordsJson, stagesJson) {
  const list = wordsJson.words.map((w) => ({ ...w, cls: wordClass(w) }));
  const words = {};
  const byZone = {};
  const byStage = {};
  for (const w of list) {
    words[w.id] = w;
    (byZone[w.zone] = byZone[w.zone] || []).push(w.id);
    (byStage[w.stage] = byStage[w.stage] || []).push(w.id);
  }
  const zones = {};
  for (const s of stagesJson.stages) {
    s.zones.forEach((z, i) => {
      zones[z.id] = { ...z, stageId: s.id, index: i };
    });
  }
  return {
    version: wordsJson.version,
    list,
    words,
    byZone,
    byStage,
    stages: stagesJson.stages,
    zones,
    mix: stagesJson.mix,
  };
}
