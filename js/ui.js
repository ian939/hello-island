/* 화면 도구: DOM 만들기, 겹쳐 뜨는 창, 알림 */

export const $ = (sel, root = document) => root.querySelector(sel);

export function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text !== undefined && text !== null) n.textContent = text;
  return n;
}

export function button(cls, text, onClick) {
  const b = el('button', cls, text);
  b.type = 'button';
  if (onClick) b.addEventListener('click', onClick);
  return b;
}

/** 타입 색 위 글자색 — 밝은 색이면 잉크, 어두우면 종이 */
export function inkOn(hex) {
  const h = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return lum > 0.55 ? '#211d16' : '#fffcf2';
}

export function tint(node, hex) {
  node.style.setProperty('--c', hex);
  node.style.setProperty('--c-ink', inkOn(hex));
  return node;
}

/* 귀(소리) 아이콘 — 스피커 + 두 줄 소리 물결 */
export function earIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 32 32');
  s.setAttribute('aria-hidden', 'true');
  s.classList.add('wave');
  s.innerHTML =
    '<path d="M4 12h5l7-6v20l-7-6H4z" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>' +
    '<path class="w1" d="M20 11.5c2 2.4 2 6.6 0 9" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>' +
    '<path class="w2" d="M24 8c3.6 4.4 3.6 11.6 0 16" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/>';
  return s;
}

export function checkIcon() {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 24 24');
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = '<path d="M4 12.5l5 5L20 6.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/>';
  return s;
}

/* ---------- 겹쳐 뜨는 창 ---------- */
let onClose = null;

export function openSheet(build, { wide = false, dismissable = true, close } = {}) {
  const overlay = $('#overlay');
  const sheet = $('#sheet');
  sheet.className = wide ? 'sheet sheet--wide' : 'sheet';
  sheet.replaceChildren();
  build(sheet);
  overlay.classList.add('is-on');
  onClose = close || null;
  overlay.onclick = dismissable
    ? (e) => {
        if (e.target === overlay) closeSheet();
      }
    : null;
}

export function closeSheet() {
  $('#overlay').classList.remove('is-on');
  $('#sheet').dispatchEvent(new Event('sheet-close'));
  $('#sheet').replaceChildren();
  const fn = onClose;
  onClose = null;
  if (fn) fn();
}

export const sheetOpen = () => $('#overlay').classList.contains('is-on');

/* ---------- 알림 ---------- */
let toastTimer = null;
export function toast(text, ms = 1800) {
  let t = $('.toast');
  if (!t) {
    t = el('div', 'toast');
    $('#screens').appendChild(t);
  }
  t.textContent = text;
  t.style.opacity = '1';
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    t.style.opacity = '0';
  }, ms);
}
