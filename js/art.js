/* 단어 그림 — 문제의 왼쪽 큰 그림과 도감 캐릭터가 같은 그림을 쓴다.
 *   img   : Fluent 3D / Codex 로 그린 그림
 *   color : 글자 없는 물감 방울
 *   count : 사과 n개 (숫자 글씨 대신 셀 수 있는 물건, 다섯 개씩 한 줄)
 *   shape : 도형 (SVG)
 */
const NS = 'http://www.w3.org/2000/svg';

function svg(viewBox, inner) {
  const s = document.createElementNS(NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  s.setAttribute('aria-hidden', 'true');
  s.innerHTML = inner;
  return s;
}

let gid = 0;

function paint(hex) {
  gid += 1;
  const id = `g${gid}`;
  const gold = hex === 'gold';
  const fill = gold ? `url(#${id})` : hex;
  const stroke = hex === '#ffffff' || gold ? '#211d16' : 'rgba(33,29,22,.35)';
  const defs = gold
    ? `<defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#fff1a8"/><stop offset=".35" stop-color="#e9b730"/><stop offset=".6" stop-color="#b8860b"/><stop offset=".85" stop-color="#f4d264"/><stop offset="1" stop-color="#a87807"/></linearGradient></defs>`
    : '';
  const node = svg(
    '0 0 100 100',
    `${defs}<path d="M50 10 C70 8 88 22 88 42 C90 60 80 76 62 82 C60 92 54 96 50 88 C40 88 30 86 22 78 C12 68 10 54 13 42 C16 22 32 11 50 10 Z" fill="${fill}" stroke="${stroke}" stroke-width="2.5"/>
     <circle cx="20" cy="88" r="5" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
     <circle cx="84" cy="80" r="3.5" fill="${fill}" stroke="${stroke}" stroke-width="2"/>
     <ellipse cx="36" cy="30" rx="12" ry="7" fill="#fff" opacity=".42" transform="rotate(-25 36 30)"/>`,
  );
  node.classList.add('paint');
  return node;
}

const SHAPES = {
  circle: '<circle cx="50" cy="50" r="38"/>',
  square: '<rect x="15" y="15" width="70" height="70" rx="2"/>',
  triangle: '<polygon points="50,12 90,84 10,84"/>',
  rectangle: '<rect x="5" y="27" width="90" height="46" rx="2"/>',
  oval: '<ellipse cx="50" cy="50" rx="43" ry="27"/>',
  heart: '<path d="M50 86 C20 64 7 46 17 29 C27 13 45 17 50 31 C55 17 73 13 83 29 C93 46 80 64 50 86 Z"/>',
  diamond: '<polygon points="50,6 84,50 50,94 16,50"/>',
  pentagon: '<polygon points="50,9 91,39 75,87 25,87 9,39"/>',
  hexagon: '<polygon points="28,13 72,13 94,50 72,87 28,87 6,50"/>',
};

function shape(name) {
  let node;
  if (name === 'cube') {
    node = svg(
      '0 0 100 100',
      `<g stroke="#211d16" stroke-width="3" stroke-linejoin="round">
        <polygon points="50,12 86,30 50,48 14,30" fill="#5fd0bd"/>
        <polygon points="14,30 50,48 50,90 14,72" fill="#2e9c8a"/>
        <polygon points="50,48 86,30 86,72 50,90" fill="#1f7466"/></g>`,
    );
  } else {
    node = svg(
      '0 0 100 100',
      `<g fill="#2e9c8a" stroke="#211d16" stroke-width="3" stroke-linejoin="round">${SHAPES[name]}</g>
       <g fill="#fff" opacity=".28">${SHAPES[name].replace(/\/>$/, ' transform="translate(50 50) scale(.55) translate(-56 -60)"/>')}</g>`,
    );
  }
  node.classList.add('shape');
  return node;
}

function count(n, src) {
  const box = document.createElement('div');
  box.className = 'count';
  box.style.setProperty('--s', n <= 3 ? '30%' : '17%');
  // 다섯 개씩 한 줄 — 세기 쉽게 (10 칸 판처럼)
  for (let i = 0; i < n; i += 5) {
    const row = document.createElement('div');
    row.className = 'count-row';
    for (let k = i; k < Math.min(n, i + 5); k += 1) {
      const im = document.createElement('img');
      im.src = src;
      im.alt = '';
      im.draggable = false;
      row.appendChild(im);
    }
    box.appendChild(row);
  }
  // 가로 폭을 맞추려고 줄 너비를 첫 줄 기준으로 고정
  box.style.width = '100%';
  return box;
}

/** @param {object} word  @param {{motion?:boolean}} opt */
export function artEl(word, opt = {}) {
  const a = word.art;
  let node;
  if (a.kind === 'img') {
    node = document.createElement('img');
    node.className = 'art';
    node.src = a.src;
    node.alt = '';
    node.draggable = false;
    node.decoding = 'async';
  } else if (a.kind === 'color') node = paint(a.hex);
  else if (a.kind === 'count') node = count(a.n, a.src);
  else node = shape(a.shape);
  if (opt.motion && word.motion) node.classList.add(`mv-${word.motion}`);
  return node;
}

/** 미리 받아 둘 그림 경로 */
export function artSrcs(word) {
  if (word.art.kind === 'img' || word.art.kind === 'count') return [word.art.src];
  return [];
}
