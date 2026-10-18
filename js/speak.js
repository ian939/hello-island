/* 따라 말하기 — 정답 문장을 아이가 소리 내어 말하고, 자기 목소리를 한 번 들어 본다.
 *
 * - 녹음: MediaRecorder (자기 목소리 다시 듣기용)
 * - 판정: 브라우저 음성 인식(SpeechRecognition). 아이패드 Safari 는 Apple 서버에서 인식하므로 인터넷이 필요하다.
 * - 점수: 문장 낱말 중 순서대로 맞게 말한 비율. 70% 이상이면 통과.
 * 인식이 안 되는 기기·오프라인·마이크 거부일 때는 isAvailable() 이 false → 따라 말하기를 건너뛴다.
 */

export const PASS = 0.7;
export const MAX_TRIES = 3;
const MAX_MS = 8000;

const Recognition = () => window.SpeechRecognition || window.webkitSpeechRecognition || null;

let blocked = false; // 마이크 거부·인식 서비스 오류가 나면 이번 실행 동안은 건너뛴다

export function isAvailable() {
  return Boolean(!blocked && Recognition() && navigator.onLine !== false && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
}

export function markBlocked() {
  blocked = true;
}

const NUM = {
  0: 'zero', 1: 'one', 2: 'two', 3: 'three', 4: 'four', 5: 'five', 6: 'six', 7: 'seven', 8: 'eight', 9: 'nine', 10: 'ten',
  11: 'eleven', 12: 'twelve', 13: 'thirteen', 14: 'fourteen', 15: 'fifteen', 16: 'sixteen', 17: 'seventeen', 18: 'eighteen',
  19: 'nineteen', 20: 'twenty',
};

/* iPadOS 17+ Safari: 오디오 세션 종류를 직접 정한다.
 * 녹음하는 동안만 'play-and-record', 끝나면 'playback' 으로 돌려 놓아야 이후 소리가 작아지지 않는다. */
export function setSession(type) {
  try {
    if (navigator.audioSession && navigator.audioSession.type !== type) navigator.audioSession.type = type;
  } catch (e) {
    /* 지원하지 않는 브라우저 */
  }
}

/** 비교용 낱말: 소문자, 문장부호·따옴표 제거, 숫자는 영어 낱말로 */
export function words(text) {
  return String(text)
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/-/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (NUM[w] ? NUM[w] : w));
}

/** 목표 문장 낱말 중 순서대로 맞힌 것(최장 공통 부분열). 어떤 낱말을 맞혔는지도 돌려준다. */
export function score(target, heard) {
  const t = words(target);
  const h = words(heard);
  const dp = Array.from({ length: t.length + 1 }, () => new Array(h.length + 1).fill(0));
  for (let i = t.length - 1; i >= 0; i -= 1) {
    for (let j = h.length - 1; j >= 0; j -= 1) {
      dp[i][j] = same(t[i], h[j]) ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hit = new Array(t.length).fill(false);
  let i = 0;
  let j = 0;
  while (i < t.length && j < h.length) {
    if (same(t[i], h[j])) {
      hit[i] = true;
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) i += 1;
    else j += 1;
  }
  return { ratio: t.length ? dp[0][0] / t.length : 0, hit, targetWords: t };
}

/* 인식기가 복수형·과거형 끝을 조금 다르게 적어도 같은 낱말로 본다 (cats ↔ cat, colour 같은 변형은 무시) */
function same(a, b) {
  if (a === b) return true;
  const stem = (w) => w.replace(/(es|s)$/, '');
  return a.length > 3 && b.length > 3 && stem(a) === stem(b);
}

/** 여러 인식 후보 중 가장 잘 맞는 것 */
export function bestOf(target, transcripts) {
  let best = { ratio: 0, hit: words(target).map(() => false), heard: '' };
  for (const tr of transcripts) {
    const s = score(target, tr);
    if (s.ratio > best.ratio) best = { ...s, heard: tr };
  }
  return best;
}

/**
 * 한 번 녹음하며 인식한다.
 * @returns {{stop:Function, done:Promise<{url:string|null, transcripts:string[], error?:string}>}}
 */
export function listenOnce() {
  const SR = Recognition();
  let stopRec = () => {};
  const done = new Promise((resolve) => {
    const transcripts = [];
    let stream = null;
    let recorder = null;
    const chunks = [];
    let finished = false;
    let recDone = Promise.resolve(null);
    let timer = null;

    const finish = async (error) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try {
        rec.stop();
      } catch (e) {
        /* 이미 멈춤 */
      }
      if (recorder && recorder.state !== 'inactive') recorder.stop();
      const url = await recDone;
      if (stream) stream.getTracks().forEach((t) => t.stop()); // 마이크를 꺼야 스피커 소리가 정상으로 돌아온다
      setSession('playback');
      resolve({ url, transcripts, error });
    };
    stopRec = () => {
      try {
        rec.stop();
      } catch (e) {
        finish();
      }
    };

    setSession('play-and-record');
    const rec = new SR();
    rec.lang = 'en-US';
    rec.interimResults = false;
    rec.continuous = false;
    rec.maxAlternatives = 5;
    rec.onresult = (e) => {
      for (const r of e.results) for (const alt of r) if (alt.transcript) transcripts.push(alt.transcript);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'network' || e.error === 'audio-capture') {
        finish(e.error);
      }
      // no-speech 등은 onend 에서 빈 결과로 끝난다
    };
    rec.onend = () => finish();

    const startRecognition = () => {
      try {
        rec.start();
        timer = setTimeout(() => stopRec(), MAX_MS);
      } catch (e) {
        finish('start-failed');
      }
    };

    // 자기 목소리 다시 듣기용 녹음. 안 되면 인식만 한다.
    if (window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia) {
      navigator.mediaDevices
        // 에코 제거를 켜면 iPad 가 '통화 모드'로 바뀌어 스피커 소리가 작아지고, 마이크를 끈 뒤에도 남는다 → 끈다
        .getUserMedia({ audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false } })
        .then((s) => {
          stream = s;
          try {
            recorder = new MediaRecorder(s);
            recDone = new Promise((res) => {
              recorder.ondataavailable = (e) => e.data && e.data.size && chunks.push(e.data);
              recorder.onstop = () => res(chunks.length ? URL.createObjectURL(new Blob(chunks, { type: recorder.mimeType || 'audio/mp4' })) : null);
            });
            recorder.start();
          } catch (e) {
            recorder = null;
          }
          startRecognition();
        })
        .catch((err) => finish(err && err.name === 'NotAllowedError' ? 'not-allowed' : 'audio-capture'));
    } else startRecognition();
  });
  return { stop: () => stopRec(), done };
}
