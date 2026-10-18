/* 따라 녹음하기 — 정답 문장을 아이가 소리 내어 말하고, 자기 목소리를 들어 본다.
 *
 * 점수는 매기지 않는다. 녹음(MediaRecorder)과 다시 듣기만.
 * 마이크를 못 쓰는 기기·마이크 거부일 때는 isAvailable() 이 false → 따라 녹음하기를 건너뛴다.
 */

export const TIMES = 1; // 한 문장에 한 번 따라 녹음하면 '다음'
const MAX_MS = 7000; // 버튼을 안 눌러도 7초가 지나면 녹음을 멈춘다

let blocked = false; // 마이크 거부·오류가 나면 이번 실행 동안은 건너뛴다
let recording = false;

/* iPad Safari: 마이크를 쓰면 기기가 '통화 모드'(play-and-record)로 바뀌고, 녹음이 끝나도
 * 그대로 남아 iPad 전체 소리가 작아진다. 녹음하는 동안만 통화 모드로 두고, 끝나면 '재생' 모드로
 * 직접 되돌린다 (navigator.audioSession, iPadOS 17+). */
export function setSession(type) {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type;
  } catch (e) {
    /* 지원하지 않는 브라우저 */
  }
}

/** 녹음 중이 아닐 때는 늘 '재생' 모드로 (터치할 때마다 불러 통화 모드에 걸린 것을 풀어 준다) */
export function restorePlayback() {
  if (!recording) setSession('playback');
}

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
      recording = false;
      setSession('playback'); // 통화 모드에서 재생 모드로 되돌린다
      // 모드가 바뀔 틈을 조금 두고 결과를 넘긴다 (바로 재생하면 작은 소리로 나온다)
      setTimeout(() => resolve({ url, error }), 400);
    };
    stopNow = () => {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      else finish(null);
    };
    recording = true;
    setSession('play-and-record');
    navigator.mediaDevices
      // 에코 제거·자동 음량을 켜면 iPad 가 통화 모드로 바뀌어 스피커 소리가 작아질 수 있어 끈다
      .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
      .then((s) => {
        stream = s;
        recorder = new MediaRecorder(s);
        recorder.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
        recorder.onstop = async () => {
          if (!chunks.length) return finish(null);
          const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/mp4' });
          finish(await louder(blob));
        };
        recorder.start();
        timer = setTimeout(stopNow, MAX_MS);
      })
      .catch((err) => finish(null, err && err.name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture'));
  });
  return { stop: () => stopNow(), done };
}

/* ---------- 녹음한 목소리 키우기 ----------
 * iPad 소리가 작아지지 않게 마이크의 자동 음량(AGC)을 꺼서 원본 녹음은 아주 작다.
 * 녹음이 끝나면 앞뒤 조용한 부분을 잘라 내고, 가장 큰 소리가 꽉 차도록 키워서(최대 20배)
 * WAV 로 다시 만든다. 소리를 내지 않는 계산 전용(OfflineAudioContext)이라 iPad 오디오 모드에 영향이 없다. */
export async function louder(blob) {
  const fallback = () => URL.createObjectURL(blob);
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return fallback();
  try {
    const raw = await blob.arrayBuffer();
    const decoder = new OAC(1, 1, 44100);
    const buf = await new Promise((res, rej) => {
      const p = decoder.decodeAudioData(raw, res, rej);
      if (p && p.then) p.then(res, rej);
    });
    // 여러 채널이면 하나로 섞는다
    const n = buf.length;
    const data = new Float32Array(n);
    for (let c = 0; c < buf.numberOfChannels; c += 1) {
      const ch = buf.getChannelData(c);
      for (let i = 0; i < n; i += 1) data[i] += ch[i] / buf.numberOfChannels;
    }
    // 아주 큰 순간 잡음(톡 소리)에 끌려가지 않게 상위 0.1% 값을 기준 최댓값으로
    const mags = new Float32Array(Math.min(n, 48000));
    const step = Math.max(1, Math.floor(n / mags.length));
    for (let i = 0, k = 0; k < mags.length && i < n; i += step, k += 1) mags[k] = Math.abs(data[i]);
    mags.sort();
    const peak = Math.max(mags[Math.floor(mags.length * 0.999)] || 0, 1e-4);
    const gain = Math.min(0.9 / peak, 20);
    // 앞뒤 조용한 부분 자르기 (기준 최댓값의 8% 아래, 앞뒤로 0.15초 여유)
    const gate = peak * 0.08;
    let a = 0;
    let b = n - 1;
    while (a < n && Math.abs(data[a]) < gate) a += 1;
    while (b > a && Math.abs(data[b]) < gate) b -= 1;
    const pad = Math.floor(buf.sampleRate * 0.15);
    a = Math.max(0, a - pad);
    b = Math.min(n - 1, b + pad);
    if (b - a < buf.sampleRate * 0.3) {
      a = 0;
      b = n - 1;
    }
    const out = new Float32Array(b - a + 1);
    for (let i = 0; i < out.length; i += 1) out[i] = Math.tanh(data[a + i] * gain * 1.1); // 부드럽게 눌러 깨지지 않게
    return URL.createObjectURL(wav(out, buf.sampleRate));
  } catch (e) {
    return fallback();
  }
}

function wav(samples, rate) {
  const len = samples.length;
  const view = new DataView(new ArrayBuffer(44 + len * 2));
  const str = (o, t) => [...t].forEach((c, i) => view.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  view.setUint32(4, 36 + len * 2, true);
  str(8, 'WAVEfmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, rate, true);
  view.setUint32(28, rate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  str(36, 'data');
  view.setUint32(40, len * 2, true);
  for (let i = 0; i < len; i += 1) view.setInt16(44 + i * 2, Math.max(-1, Math.min(1, samples[i])) * 0x7fff, true);
  return new Blob([view], { type: 'audio/wav' });
}
