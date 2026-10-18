"""Fluent Emoji 3D 그림을 내려받아 assets/art/<word id>.webp 로 저장한다.

curation.ART 에서 'F:' 로 지정한 단어만 처리한다. 이미 있는 파일은 건너뛴다.
Fluent Emoji 는 MIT 라이선스 (https://github.com/microsoft/fluentui-emoji).
"""
import io
import json
import sys
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from curation import ART  # noqa: E402

OUT = ROOT / 'assets' / 'art'
RAW = 'https://raw.githubusercontent.com/microsoft/fluentui-emoji/main/'


def art_key(word):
    return f"{word['en']}/{word['world']}" if word['en'] == 'orange' else word['en']


def fluent_index():
    paths = (ROOT / 'tools' / 'fluent-3d.txt').read_text(encoding='utf-8').split('\n')
    index = {}
    for p in paths:
        folder = p.split('/')[1].lower()
        # 피부색이 나뉜 그림은 Default 를 쓴다
        if '/3D/' in p and (p.count('/') == 3 or '/Default/3D/' in p):
            index[folder] = p
    return index


def main():
    words = json.loads((ROOT / 'tools' / 'seed' / 'vocabulary.seed.json').read_text(encoding='utf-8'))['words']
    index = fluent_index()
    OUT.mkdir(parents=True, exist_ok=True)
    jobs = []
    for w in words:
        spec = ART[art_key(w)]
        if not spec.startswith('F:'):
            continue
        path = index.get(spec[2:].lower())
        if not path:
            raise SystemExit(f'Fluent 폴더 없음: {w["en"]} -> {spec}')
        jobs.append((w['id'], path))

    def fetch(job):
        wid, path = job
        dest = OUT / f'{wid}.webp'
        if dest.exists():
            return wid, 'skip'
        url = RAW + urllib.parse.quote(path)
        data = urllib.request.urlopen(url, timeout=30).read()
        img = Image.open(io.BytesIO(data)).convert('RGBA')
        img.save(dest, 'WEBP', quality=90, method=6)
        return wid, 'ok'

    with ThreadPoolExecutor(8) as ex:
        for wid, status in ex.map(fetch, jobs):
            if status == 'ok':
                print('ok', wid)
    print(f'Fluent {len(jobs)}개 확인 완료')


if __name__ == '__main__':
    main()
