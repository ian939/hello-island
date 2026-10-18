"""seed + curation → 앱이 읽는 data/words.json, data/stages.json 을 만든다.

- 단어 ID 는 seed 그대로 유지한다 (기존 학습 기록 보존).
- 그림·음성 파일이 실제로 있는지 확인해 ready 를 정한다. ready=false 인 단어는 출제하지 않고,
  그 단어가 속한 큰 맵은 졸업(최종 복습 미션)이 열리지 않는다.
"""
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'tools'))
from curation import ART, CONFUSE, NUMBER_GAP  # noqa: E402
from sentences import SENTENCES  # noqa: E402
from words_source import all_words  # noqa: E402

SEED = ROOT / 'tools' / 'seed'

# 구역마다 '타입 색' — 도감 칸, 구역 타일, 퀴즈 상단 칩에 쓴다.
ZONE_COLOR = {
    'age6-animals': '#6DB54A', 'age6-food': '#EE8A3A', 'age6-things': '#4F86E8', 'age6-body': '#E4789F',
    'age6-colors': '#B05FD0', 'age6-numbers': '#C9A227', 'age6-nature': '#2E9C8A', 'age6-home': '#8E7BE0',
    'age6-actions': '#E2533F', 'age6-feelings': '#F0A21B',
    'age7-school': '#3E7FD6', 'age7-home': '#B9845A', 'age7-market': '#5FAE3E', 'age7-wildlife': '#1F9BB5',
    'age7-town': '#D9573B', 'age7-shape_numbers': '#9C6AD6',
    'age8-jobs': '#2F6FB0', 'age8-places': '#7A6CD9', 'age8-weather': '#38A3C9', 'age8-routines': '#E46A4A',
    'age8-sports_music': '#E0A021', 'age8-space': '#34306E',
}
STAGE_COLOR = {'age6': '#0F6B5F', 'age7': '#D5372A', 'age8': '#34306E'}
STAGE_SHORT = {'age6': '첫 탐험섬', 'age7': '신나는 모험 마을', 'age8': '별빛 대탐험'}

# 도감에서 눌렀을 때의 움직임 (단어 그 자체가 움직인다)
MOTION_BY_ZONE = {
    'animals': 'hop', 'wildlife': 'hop', 'food': 'bounce', 'market': 'bounce', 'things': 'tilt',
    'town': 'pulse', 'body': 'pulse', 'colors': 'shine', 'numbers': 'count', 'shape_numbers': 'spin',
    'nature': 'float', 'weather': 'float', 'space': 'float', 'home': 'tilt', 'school': 'tilt',
    'actions': 'hop', 'routines': 'hop', 'feelings': 'pulse', 'jobs': 'hop', 'places': 'pulse',
    'sports_music': 'bounce',
}
SWIMMERS = {'fish', 'dolphin', 'shark', 'whale', 'octopus', 'jellyfish', 'shrimp', 'crab', 'turtle', 'swim'}
FLYERS = {'bird', 'butterfly', 'bee', 'owl', 'plane', 'helicopter', 'rocket', 'kite', 'spaceship', 'comet', 'meteor'}
DRIVERS = {'car', 'train', 'bike', 'bus', 'taxi', 'truck', 'scooter', 'subway', 'ambulance', 'fire truck',
           'police car', 'tractor', 'moon rover', 'skateboard', 'boat', 'fast'}


def art_key(w):
    return f"{w['en']}/{w['world']}" if w['en'] == 'orange' else w['en']


def sentence(w):
    """정답 팝업 문장 (영어, 한글). 그 단어가 문장 안에 들어 있어야 한다."""
    en, ko = SENTENCES[art_key(w)]
    if w['en'].lower() not in en.lower():
        raise SystemExit(f"문장에 단어가 없음: {w['en']} → {en}")
    return en, ko


def art(w):
    spec = ART[art_key(w)]
    kind, val = spec[:1], spec[2:]
    if kind in ('F', 'G'):
        return {'kind': 'img', 'src': f"assets/art/{w['id']}.webp", 'by': 'fluent' if kind == 'F' else 'codex'}
    if kind == 'C':
        return {'kind': 'color', 'hex': val}
    if kind == 'N':
        return {'kind': 'count', 'n': int(val), 'src': 'assets/art/food-apple.webp'}
    if kind == 'S':
        return {'kind': 'shape', 'shape': val}
    raise ValueError(spec)


def motion(w):
    if w['en'] in SWIMMERS:
        return 'swim'
    if w['en'] in FLYERS:
        return 'fly'
    if w['en'] in DRIVERS:
        return 'drive'
    return MOTION_BY_ZONE.get(w['world'], 'bounce')


def main():
    seed = json.loads((SEED / 'vocabulary.seed.json').read_text(encoding='utf-8'))
    stages_seed = json.loads((SEED / 'stages.seed.json').read_text(encoding='utf-8'))
    # 6세 추가 단어는 자기 구역 끝에 오도록 정렬한다 (도감 번호가 구역별로 이어지게).
    zone_order = [z['id'] for st in stages_seed['stages'] for z in st['zones']]
    words = sorted(enumerate(all_words()), key=lambda t: (zone_order.index(t[1]['zone_id']), t[0]))
    words = [w for _, w in words]

    keys = {art_key(w) for w in words}
    missing = (keys - set(ART)) | (keys - set(SENTENCES))
    if missing:
        raise SystemExit(f'그림이나 문장이 정해지지 않은 단어: {sorted(missing)}')

    # 헷갈림 묶음: 단어 키 → 묶음 번호들
    groups = {}
    for gi, g in enumerate(CONFUSE):
        for k in g:
            groups.setdefault(k, []).append(gi)
    unknown = {k for g in CONFUSE for k in g} - keys - {'racing'}
    if unknown:
        raise SystemExit(f'CONFUSE 에 없는 단어: {sorted(unknown)}')

    out = []
    for no, w in enumerate(words, start=1):
        a = art(w)
        audio_ok = all((ROOT / 'assets' / 'audio' / d / f"{w['id']}.mp3").exists() for d in ('w', 's', 'x'))
        art_ok = a['kind'] != 'img' or (ROOT / a['src']).exists()
        out.append({
            'id': w['id'],
            'no': no,
            'en': w['en'],
            'ko': w['ko_parent_only'],
            'stage': w['stage_id'],
            'zone': w['zone_id'],
            'tier': w['tier'],
            'pos': w['part_of_speech'],
            'art': a,
            'motion': motion(w),
            'sentence': sentence(w)[0],
            'sentenceKo': sentence(w)[1],
            'confuse': groups.get(art_key(w), []),
            'numberGap': NUMBER_GAP.get(w['stage_id'], 0) if ART[art_key(w)].startswith('N:') else 0,
            'value': int(ART[art_key(w)][2:]) if ART[art_key(w)].startswith('N:') else None,
            'ready': bool(audio_ok and art_ok),
        })

    stages = []
    for st in stages_seed['stages']:
        zones = []
        for order, z in enumerate(st['zones'], start=1):
            zones.append({
                'id': z['id'],
                'title': z['title_ko'],
                'color': ZONE_COLOR[z['id']],
                'order': z.get('order', order),
                'unlock': z['unlock'],
                'count': sum(1 for w in out if w['zone'] == z['id']),
            })
        stages.append({
            'id': st['id'],
            'title': st['title_ko'],
            'short': STAGE_SHORT[st['id']],
            'subtitle': st['subtitle_ko'],
            'color': STAGE_COLOR[st['id']],
            'count': sum(1 for w in out if w['stage'] == st['id']),
            'zones': zones,
        })

    data_dir = ROOT / 'data'
    data_dir.mkdir(exist_ok=True)
    (data_dir / 'words.json').write_text(json.dumps({'version': seed['version'], 'words': out}, ensure_ascii=False, separators=(',', ':')), encoding='utf-8')
    (data_dir / 'stages.json').write_text(json.dumps({
        'version': stages_seed['version'],
        'unlock': stages_seed['stage_unlock_policy'],
        'mix': stages_seed['quiz_mixture_by_stage'],
        'stages': stages,
    }, ensure_ascii=False, indent=1), encoding='utf-8')

    ready = sum(1 for w in out if w['ready'])
    print(f'words.json: {len(out)}개 (출제 가능 {ready}개)')
    not_ready = [w['id'] for w in out if not w['ready']]
    if not_ready:
        print('준비 안 됨:', len(not_ready), not_ready[:12], '…' if len(not_ready) > 12 else '')


if __name__ == '__main__':
    main()
