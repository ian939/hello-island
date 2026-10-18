"""Fluent 3D 에 맞는 그림이 없는 단어(curation.ART 의 'G:')를 Codex 이미지 생성으로 그린다.

한 장에 1~5분이 걸리므로 9개 단어를 3×3 판 하나에 그리게 한 뒤 칸별로 잘라 쓴다.
흰 배경은 가장자리에서부터 지워 투명하게 만든다 (Fluent PNG 처럼 배경 없는 그림).

  python tools/gen_art.py --plan            # 몇 판이 필요한지
  python tools/gen_art.py --sheet 0         # 0번 판 그리기 (여러 판은 동시에 따로 실행)
  python tools/gen_art.py --slice 0         # 이미 그린 0번 판을 다시 자르기
"""
import argparse
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageFilter
from scipy import ndimage

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from curation import ART  # noqa: E402

GEN = Path.home() / '.claude' / 'skills' / 'codex-imagegen' / 'scripts' / 'gen_image.py'
SHEETS = ROOT / 'tools' / 'sheets'
OUT = ROOT / 'assets' / 'art'
REF = SHEETS / 'style-ref.png'
PER = 9

STYLE = (
    "A 3x3 grid sheet of nine separate icons in the exact style of Microsoft Fluent 3D emoji "
    "(see the reference image): glossy soft 3D clay render, smooth rounded shapes, soft studio lighting, "
    "gentle gradients, cute and friendly, consistent scale. Each icon sits centered in its own equal square cell "
    "with generous empty space around it, nothing crosses into another cell, no borders or grid lines drawn. "
    "Plain pure white background everywhere. Absolutely no text, no letters, no numbers, no labels anywhere. "
    "People are cute cartoon figures with simple friendly faces. "
    "Cells in reading order (left to right, top to bottom):\n"
)


def art_key(word):
    return f"{word['en']}/{word['world']}" if word['en'] == 'orange' else word['en']


def todo():
    words = json.loads((ROOT / 'tools' / 'seed' / 'vocabulary.seed.json').read_text(encoding='utf-8'))['words']
    items = [(w['id'], ART[art_key(w)][2:]) for w in words if ART[art_key(w)].startswith('G:')]
    return [items[i:i + PER] for i in range(0, len(items), PER)]


def make_ref():
    """Fluent 그림 몇 장을 이어 붙여 화풍 참고판을 만든다."""
    picks = ['animals-cat', 'age7-school-school', 'actions-run', 'age7-home-bathtub', 'age8-jobs-farmer', 'food-cake']
    tiles = [Image.open(OUT / f'{p}.webp').convert('RGBA').resize((256, 256)) for p in picks]
    sheet = Image.new('RGB', (256 * 3, 256 * 2), 'white')
    for i, t in enumerate(tiles):
        sheet.paste(t, ((i % 3) * 256, (i // 3) * 256), t)
    SHEETS.mkdir(parents=True, exist_ok=True)
    sheet.save(REF)


def knock_out_white(img):
    """가장자리와 이어진 흰 영역만 투명하게 (그림 속 흰 부분은 남긴다)."""
    rgb = np.asarray(img.convert('RGB'))
    # 순백에 아주 가까운 것만 배경으로 본다 — 흰 베개·종이·분필의 밝은 면까지 지우지 않게
    white = (rgb >= 250).all(axis=2)
    lab, _ = ndimage.label(white)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    bg = np.isin(lab, edge[edge > 0])
    fg = ~bg
    # 옆 칸에서 넘어온 조각은 버린다: 자른 칸 가장자리에 닿아 있고 작은 것만.
    # (빗방울·눈송이·궤도 점선·음표처럼 떨어져 있는 그림 조각은 가장자리에 닿지 않으니 남는다)
    parts, n = ndimage.label(fg)
    if n > 1:
        sizes = ndimage.sum(fg, parts, range(1, n + 1))
        border = set(np.unique(np.concatenate([parts[0], parts[-1], parts[:, 0], parts[:, -1]]))) - {0}
        drop = [k for k in border if sizes[k - 1] < sizes.max() * 0.05]
        if drop:
            fg &= ~np.isin(parts, drop)
    alpha = Image.fromarray((fg * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.8))
    out = img.convert('RGBA')
    out.putalpha(alpha)
    return out


def slice_sheet(n, items):
    sheet = Image.open(SHEETS / f'sheet-{n:02d}.png').convert('RGB')
    W, H = sheet.size
    cw, ch = W / 3, H / 3
    for k, (wid, _) in enumerate(items):
        cx, cy = k % 3, k // 3
        # 칸 경계에서 살짝 안쪽으로 잘라 옆 칸 그림자가 섞이지 않게
        m = 0.03
        box = (int((cx + m) * cw), int((cy + m) * ch), int((cx + 1 - m) * cw), int((cy + 1 - m) * ch))
        cell = knock_out_white(sheet.crop(box))
        bbox = cell.getchannel('A').point(lambda a: 255 if a > 24 else 0).getbbox()
        if bbox:
            cell = cell.crop(bbox)
        side = int(max(cell.size) * 1.12)
        canvas = Image.new('RGBA', (side, side), (255, 255, 255, 0))
        canvas.paste(cell, ((side - cell.size[0]) // 2, (side - cell.size[1]) // 2), cell)
        canvas = canvas.resize((384, 384), Image.LANCZOS)
        canvas.save(OUT / f'{wid}.webp', 'WEBP', quality=90, method=6)
        print('saved', wid)


def draw_sheet(n, items):
    if not REF.exists():
        make_ref()
    lines = '\n'.join(f'{k + 1}. {desc}' for k, (_, desc) in enumerate(items))
    blanks = PER - len(items)
    if blanks:
        lines += f'\nThe remaining {blanks} cell(s) stay completely empty white.'
    out = SHEETS / f'sheet-{n:02d}.png'
    cmd = [sys.executable, str(GEN), '--prompt', STYLE + lines, '--out', str(out), '--ref', str(REF)]
    r = subprocess.run(cmd, capture_output=True, text=True, encoding='utf-8', errors='replace')
    print(r.stdout[-400:], r.stderr[-400:])
    if out.exists():
        slice_sheet(n, items)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--plan', action='store_true')
    ap.add_argument('--sheet', type=int)
    ap.add_argument('--slice', type=int)
    a = ap.parse_args()
    sheets = todo()
    if a.plan:
        for i, s in enumerate(sheets):
            print(i, ', '.join(w for w, _ in s))
        print(len(sheets), 'sheets /', sum(map(len, sheets)), 'words')
    elif a.sheet is not None:
        draw_sheet(a.sheet, sheets[a.sheet])
    elif a.slice is not None:
        slice_sheet(a.slice, sheets[a.slice])


if __name__ == '__main__':
    main()
