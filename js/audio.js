/* 소리 — 학습의 중심.
 *
 * 영어 음성(단어·문장·안내·내 목소리)은 <audio> 요소 하나로 재생한다.
 * iPad 에서 <audio> 는 음악 재생과 같은 경로라 기기 음량 그대로 들린다.
 * (Web Audio 로 음성을 틀면 마이크를 쓴 뒤 등에 소리가 작게 남는 일이 있었다)
 *
 * - iPad 사파리는 사용자가 누르기 전에는 소리를 못 낸다. 첫 터치에서 unlock() 으로
 *   같은 <audio> 요소를 한 번 재생해 두면, 그 뒤로는 터치 밖에서도 재생할 수 있다.
 * - 새 소리를 틀면 앞 소리는 바로 끈다 (빠르게 연타해도 겹치지 않게).
 * - 재생이 막히면 조용히 넘어가지 않고 '눌러서 소리 켜기' 버튼을 띄운다 (onBlocked).
 * - 효과음(딩동 등)만 파일 없이 Web Audio 로 작게 만든다.
 */

/* 0.05초짜리 무음 WAV — 첫 터치에서 <audio> 를 깨우는 데 쓴다 */
function silentWav() {
  const rate = 8000;
  const n = 400;
  const buf = new ArrayBuffer(44 + n);
  const v = new DataView(buf);
  const str = (o, t) => [...t].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + n, true);
  str(8, 'WAVEfmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true); // PCM
  v.setUint16(22, 1, true); // 모노
  v.setUint32(24, rate, true);
  v.setUint32(28, rate, true);
  v.setUint16(32, 1, true);
  v.setUint16(34, 8, true); // 8비트
  str(36, 'data');
  v.setUint32(40, n, true);
  for (let i = 0; i < n; i += 1) v.setUint8(44 + i, 128); // 8비트 무음 = 128
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}
let SILENT = null;

let voice = null; // 음성 전용 <audio> 하나
let unlocked = false;
let token = 0;
let muted = false;
let ctx = null; // 효과음 전용
let sfxGain = null;
const warmed = new Set();

export const audioState = { onBlocked: null, onSpeaking: null };
let beforeUnlock = null;
/** 터치마다 먼저 할 일 (녹음 뒤 통화 모드 풀기) */
export const setBeforeUnlock = (fn) => (beforeUnlock = fn);

function el() {
  if (!voice) {
    voice = new Audio();
    voice.preload = 'auto';
    voice.setAttribute('playsinline', '');
  }
  return voice;
}

/** 터치 이벤트 안에서 부른다 — <audio> 와 효과음을 깨운다 */
export function unlock() {
  if (beforeUnlock) beforeUnlock();
  const v = el();
  if (!unlocked) {
    if (!SILENT) SILENT = silentWav();
    v.src = SILENT;
    const p = v.play();
    if (p && p.then) p.then(() => (unlocked = true)).catch(() => {});
    else unlocked = true;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (AC && !ctx) {
    ctx = new AC();
    sfxGain = ctx.createGain();
    sfxGain.gain.value = 0.18;
    sfxGain.connect(ctx.destination);
  }
  if (ctx && ctx.state !== 'running') ctx.resume().catch(() => {});
}

export const isRunning = () => Boolean(ctx && ctx.state === 'running');
export const setMuted = (m) => {
  muted = m;
  if (m) stop();
};

/** 다음에 틀 파일을 미리 받아 둔다 (브라우저 캐시) */
export function preload(srcs) {
  for (const s of srcs) {
    if (warmed.has(s)) continue;
    warmed.add(s);
    if (warmed.size > 400) warmed.clear();
    fetch(s).catch(() => warmed.delete(s));
  }
}

let pendingEnd = null; // 지금 재생 중인 소리를 기다리는 쪽 — 멈출 때도 반드시 끝을 알려 준다

export function stop() {
  token += 1;
  if (voice) voice.pause();
  if (pendingEnd) pendingEnd(false);
  speaking(false);
}

function speaking(on) {
  if (audioState.onSpeaking) audioState.onSpeaking(on);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

function playOne(src, my) {
  const v = el();
  return new Promise((resolve) => {
    let done = false;
    const end = (ok) => {
      if (done) return;
      done = true;
      if (pendingEnd === end) pendingEnd = null;
      v.onended = null;
      v.onerror = null;
      resolve(ok);
    };
    pendingEnd = end;
    v.onended = () => end(true);
    v.onerror = () => end(false);
    v.src = src;
    v.currentTime = 0;
    const p = v.play();
    if (p && p.catch) {
      p.catch((err) => {
        if (my === token && err && err.name === 'NotAllowedError' && audioState.onBlocked) audioState.onBlocked();
        end(false);
      });
    }
  });
}

/**
 * 여러 소리를 차례로 재생한다. 중간에 다른 소리가 오면 그만둔다.
 * @returns {Promise<boolean>} 끝까지 재생했으면 true
 */
export async function play(srcs, { gap = 220 } = {}) {
  stop();
  const my = token;
  if (muted) return false;
  const list = Array.isArray(srcs) ? srcs : [srcs];
  for (let i = 0; i < list.length; i += 1) {
    speaking(true);
    const ok = await playOne(list[i], my);
    if (my !== token) return false;
    speaking(false);
    if (!ok) return false;
    if (i < list.length - 1) await wait(gap);
    if (my !== token) return false;
  }
  return true;
}

/* ---------- 효과음 (작게) ---------- */
function tone(freq, start, dur, type = 'sine', vol = 1) {
  const c = ctx;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, c.currentTime + start);
  g.gain.setValueAtTime(0.0001, c.currentTime + start);
  g.gain.exponentialRampToValueAtTime(vol, c.currentTime + start + 0.015);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + start + dur);
  o.connect(g);
  g.connect(sfxGain);
  o.start(c.currentTime + start);
  o.stop(c.currentTime + start + dur + 0.02);
}

export function sfx(kind) {
  if (muted || !isRunning()) return;
  if (kind === 'tap') tone(660, 0, 0.07, 'triangle', 0.6);
  else if (kind === 'right') {
    tone(784, 0, 0.12, 'triangle');
    tone(1047, 0.1, 0.22, 'triangle');
  } else if (kind === 'wrong') tone(330, 0, 0.18, 'sine', 0.5);
  else if (kind === 'stamp') {
    tone(140, 0, 0.12, 'square', 0.35);
    tone(880, 0.05, 0.1, 'triangle', 0.6);
  } else if (kind === 'star') [880, 1175, 1568].forEach((f, i) => tone(f, i * 0.09, 0.18, 'triangle', 0.7));
}

/* ---------- 파일 경로 ---------- */
export const wordSrc = (id, slow = false) => `assets/audio/${slow ? 's' : 'w'}/${id}.mp3`;
/** slow = 80% 속도로 녹음한 문장 */
export const sentenceSrc = (id, slow = false) => `assets/audio/${slow ? 'xs' : 'x'}/${id}.mp3`;
export const uiSrc = (key) => `assets/audio/ui/${key}.mp3`;
