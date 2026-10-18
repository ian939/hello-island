/* 소리 — 학습의 중심.
 *
 * iPad 사파리는 사용자가 누르기 전에는 소리를 못 낸다. 첫 터치(탐험 시작 등)에서 unlock() 으로
 * AudioContext 를 깨우고, 그 뒤로는 Web Audio 로 미리 녹음한 mp3 를 재생한다.
 * - 새 소리를 틀면 앞 소리는 바로 끈다 (빠르게 연타해도 겹치지 않게).
 * - 재생이 막히면 조용히 넘어가지 않고 '눌러서 소리 켜기' 버튼을 띄운다 (onBlocked).
 * - 효과음은 파일 없이 만들고, 말소리보다 작게.
 */

let ctx = null;
let voiceGain = null;
let sfxGain = null;
let current = null;
let token = 0;
let muted = false;
const buffers = new Map();

export const audioState = { onBlocked: null, onSpeaking: null };

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  voiceGain = ctx.createGain();
  voiceGain.gain.value = 1;
  voiceGain.connect(ctx.destination);
  sfxGain = ctx.createGain();
  sfxGain.gain.value = 0.18;
  sfxGain.connect(ctx.destination);
  return ctx;
}

/** 반드시 터치 이벤트 안에서 부른다 */
export function unlock() {
  const c = ensure();
  if (!c) return;
  // iPadOS 17+: 처음부터 '재생' 세션으로 (녹음 뒤 작아진 소리도 여기서 되돌아온다)
  try {
    if (navigator.audioSession && navigator.audioSession.type !== 'play-and-record') navigator.audioSession.type = 'playback';
  } catch (e) {
    /* 지원하지 않는 브라우저 */
  }
  if (c.state !== 'running') c.resume().catch(() => {});
  // iOS: 무음 한 조각을 재생해 출력 경로를 연다
  const b = c.createBuffer(1, 1, 22050);
  const s = c.createBufferSource();
  s.buffer = b;
  s.connect(c.destination);
  s.start(0);
}

export const isRunning = () => Boolean(ctx && ctx.state === 'running');
export const setMuted = (m) => {
  muted = m;
  if (m) stop();
};

function load(src) {
  if (buffers.has(src)) return buffers.get(src);
  const p = fetch(src)
    .then((r) => {
      if (!r.ok) throw new Error(`${r.status} ${src}`);
      return r.arrayBuffer();
    })
    .then((ab) => new Promise((res, rej) => ensure().decodeAudioData(ab, res, rej)));
  buffers.set(src, p);
  p.catch(() => buffers.delete(src));
  // 너무 많이 쌓이지 않게 오래된 것부터 지운다
  if (buffers.size > 160) buffers.delete(buffers.keys().next().value);
  return p;
}

export function preload(srcs) {
  if (!ensure()) return;
  for (const s of srcs) load(s).catch(() => {});
}

export function stop() {
  token += 1;
  if (current) {
    try {
      current.stop();
    } catch (e) {
      /* 이미 멈춤 */
    }
    current = null;
  }
  speaking(false);
}

function speaking(on) {
  if (audioState.onSpeaking) audioState.onSpeaking(on);
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 여러 소리를 차례로 재생한다. 중간에 다른 소리가 오면 그만둔다.
 * @returns {Promise<boolean>} 끝까지 재생했으면 true
 */
export async function play(srcs, { gap = 220 } = {}) {
  stop();
  const my = token;
  if (muted) return false;
  const c = ensure();
  if (!c) return false;
  if (c.state !== 'running') {
    try {
      await Promise.race([c.resume(), wait(400)]);
    } catch (e) {
      /* 아래에서 처리 */
    }
    if (c.state !== 'running') {
      if (audioState.onBlocked) audioState.onBlocked();
      return false;
    }
  }
  const list = Array.isArray(srcs) ? srcs : [srcs];
  for (let i = 0; i < list.length; i += 1) {
    let buf;
    try {
      buf = await load(list[i]);
    } catch (err) {
      console.warn('소리를 불러오지 못함', list[i], err);
      continue;
    }
    if (my !== token) return false;
    const node = c.createBufferSource();
    node.buffer = buf;
    node.connect(voiceGain);
    current = node;
    speaking(true);
    await new Promise((res) => {
      node.onended = res;
      node.start(0);
    });
    if (my !== token) return false;
    current = null;
    speaking(false);
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
/** slow = 80% 속도로 녹음한 문장 (문장 듣기 버튼) */
export const sentenceSrc = (id, slow = false) => `assets/audio/${slow ? "xs" : "x"}/${id}.mp3`;
export const uiSrc = (key) => `assets/audio/ui/${key}.mp3`;
