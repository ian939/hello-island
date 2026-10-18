/* 오프라인 우선 — 앱 뼈대는 설치 때 받아 두고, 그림·소리는 쓰는 대로(또는 보호자 화면에서 한꺼번에) 캐시한다. */
const SHELL = 'hello-island-shell-v4';
const ASSETS = 'hello-island-assets-v2';
const FONTS = 'hello-island-fonts-v1';

const SHELL_FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'css/style.css',
  'js/lock.js',
  'js/app.js',
  'js/quiz.js',
  'js/parent.js',
  'js/ui.js',
  'js/art.js',
  'js/audio.js',
  'js/store.js',
  'js/speak.js',
  'js/engine/content.js',
  'js/engine/map.js',
  'js/engine/plan.js',
  'js/engine/progress.js',
  'js/engine/session.js',
  'js/engine/state.js',
  'js/engine/util.js',
  'data/words.json',
  'data/stages.json',
  'assets/ui/island.webp',
  'assets/ui/town.webp',
  'assets/ui/space.webp',
  'assets/ui/star.webp',
  'assets/ui/door.webp',
  'assets/ui/sparkles.webp',
  'assets/ui/party.webp',
  'assets/ui/icon-192.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => ![SHELL, ASSETS, FONTS].includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 글꼴: 한 번 받으면 그대로
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) {
    e.respondWith(cacheFirst(req, FONTS));
    return;
  }
  if (url.origin !== location.origin) return;

  // 그림·소리: 캐시 먼저 (바뀌지 않는 파일)
  if (url.pathname.includes('/assets/')) {
    e.respondWith(cacheFirst(req, ASSETS));
    return;
  }
  // 앱 뼈대·데이터: 인터넷이 되면 새것, 안 되면 캐시
  e.respondWith(networkFirst(req, SHELL));
});

async function cacheFirst(req, name) {
  const hit = await caches.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') (await caches.open(name)).put(req, res.clone());
  return res;
}

async function networkFirst(req, name) {
  try {
    const res = await fetch(req);
    if (res.ok) (await caches.open(name)).put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    throw err;
  }
}
