"""도구들이 함께 쓰는 단어 목록: 기획 seed 155+120+120 + 6세 추가 단어(extra_words.py)."""
import json
from pathlib import Path

from extra_words import extra_seed_words

ROOT = Path(__file__).resolve().parent.parent


def seed():
    return json.loads((ROOT / 'tools' / 'seed' / 'vocabulary.seed.json').read_text(encoding='utf-8'))


def all_words():
    """seed 단어 뒤에 추가 단어를 붙인다 (그림 판 번호가 바뀌지 않게 순서는 이대로 둔다)."""
    words = seed()['words'] + extra_seed_words()
    ids = [w['id'] for w in words]
    if len(ids) != len(set(ids)):
        raise SystemExit('단어 ID 중복')
    ens = [w['en'].lower() for w in words if w['en'] != 'orange']
    dup = {e for e in ens if ens.count(e) > 1}
    if dup:
        raise SystemExit(f'영어 단어 중복: {sorted(dup)}')
    return words
