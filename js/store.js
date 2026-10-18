/* 진행 상황 저장 (localStorage).
 * 정답·오답 하나마다 바로 저장한다 — 앱을 닫았다 열어도 그 직전 상태로 돌아오게. */
import { blankState, migrate } from './engine/state.js';

const KEY = 'hello-island.save.v1';

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    return migrate(raw ? JSON.parse(raw) : null);
  } catch (err) {
    console.warn('저장 데이터를 읽지 못했습니다. 새로 시작합니다.', err);
    return blankState();
  }
}

export function saveState(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch (err) {
    console.warn('저장 실패', err);
    return false;
  }
}

export function clearState() {
  try {
    localStorage.removeItem(KEY);
  } catch (err) {
    /* 무시 */
  }
}

/** 보호자 백업 파일 */
export function exportBlob(state) {
  const data = { app: 'hello-island', exportedAt: new Date().toISOString(), state };
  return new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
}

export function importText(text) {
  const data = JSON.parse(text);
  if (!data || data.app !== 'hello-island' || !data.state) throw new Error('헬로 아일랜드 백업 파일이 아닙니다.');
  return migrate(data.state);
}
