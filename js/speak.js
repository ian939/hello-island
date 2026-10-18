/* 따라 녹음하기 — 정답 문장을 아이가 소리 내어 말하고, 자기 목소리를 들어 본다.
 *
 * 점수는 매기지 않는다. 녹음(MediaRecorder)과 다시 듣기만.
 * 마이크를 못 쓰는 기기·마이크 거부일 때는 isAvailable() 이 false → 따라 녹음하기를 건너뛴다.
 */

export const TIMES = 2; // 한 문장에 두 번 따라 녹음하면 '다음'
const MAX_MS = 7000; // 버튼을 안 눌러도 7초가 지나면 녹음을 멈춘다

let blocked = false; // 마이크 거부·오류가 나면 이번 실행 동안은 건너뛴다

export function isAvailable() {
  return Boolean(!blocked && window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export function markBlocked() {
  blocked = true;
}

/**
 * 녹음 한 번.
 * @returns {{stop:Function, done:Promise<{url:string|null, error?:string}>}}
 */
export function recordOnce() {
  let stopNow = () => {};
  const done = new Promise((resolve) => {
    let stream = null;
    let recorder = null;
    let timer = null;
    const chunks = [];
    let finished = false;
    const finish = (url, error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      if (stream) stream.getTracks().forEach((t) => t.stop()); // 마이크를 바로 끈다
      resolve({ url, error });
    };
    stopNow = () => {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else finish(null);
    };
    navigator.mediaDevices
      // 에코 제거·자동 음량을 켜면 iPad 가 통화 모드로 바뀌어 스피커 소리가 작아질 수 있어 끈다
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((s) => {
        stream = s;
        recorder = new MediaRecorder(s);
        recorder.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
        recorder.onstop = () =>
          finish(chunks.length ? URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || 'audio/mp4' })) : null);
        recorder.start();
        timer = setTimeout(stopNow, MAX_MS);
      })
      .catch((err) => finish(null, err && err.name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture'));
  });
  return { stop: () => stopNow(), done };
}
