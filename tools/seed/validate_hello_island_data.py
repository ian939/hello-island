#!/usr/bin/env python3
"""Validate Hello Island stage/word manifest consistency (Python 3.9+)."""
import collections
import json
from pathlib import Path

ROOT=Path(__file__).resolve().parent
words_file=ROOT/'vocabulary.seed.json'
stage_file=ROOT/'stages.seed.json'
wordlist_file=ROOT/'wordlist-by-age.md'

vocab=json.loads(words_file.read_text(encoding='utf-8'))
config=json.loads(stage_file.read_text(encoding='utf-8'))
words=vocab['words']; stages=config['stages']
expected={'age6':155,'age7':120,'age8':120}
assert len(words)==395, f"Expected 395 words, got {len(words)}"
assert vocab['stage_counts']=={**expected,'total':395}
assert config['word_counts']==vocab['stage_counts']
assert collections.Counter(w['stage_id'] for w in words)==expected
ids=[w['id'] for w in words]
assert len(ids)==len(set(ids)), 'Duplicate word ID'

newwords=[w for w in words if w['stage_id']!='age6']
assert len(newwords)==240
assert len({w['en'].lower() for w in newwords})==len(newwords),'Duplicate new English word'
base_terms={w['en'].lower() for w in words if w['stage_id']=='age6'}
assert not any(w['en'].lower() in base_terms for w in newwords),'New word duplicates 6-year word'

zones={zone['id']:zone for stage in stages for zone in stage['zones']}
assert len(stages)==3 and len(zones)==22
assert sum(z['word_count'] for z in zones.values())==395
for stage in stages:
    assert stage['word_count']==expected[stage['id']]
    expected_zone_count=10 if stage['id']=='age6' else 6
    assert len(stage['zones'])==expected_zone_count
    if stage['id']!='age6':
        assert all(z['word_count']==20 for z in stage['zones'])
        assert stage['zones'][0]['unlock']['kind']=='stage_available'
        assert all(z['unlock'].get('threshold')==0.8 for z in stage['zones'][1:])

for w in words:
    assert w['zone_id'] in zones, f"Unknown zone {w['zone_id']}"
    assert w['zone_id'].startswith(w['stage_id']+'-')
    assert w['collectible']['id']==w['id']
    assert w['collectible']['subject_en']==w['en'], f"Collectible not actual word: {w['id']}"
    assert w['collectible']['art_asset']==w['art_asset']
    assert w['collectible']['kind'] in {'word_subject','word_scene'}
    assert w['content_status']=='seed_only', 'Cannot mark item published without providing assets'
    assert w['audio_word_asset'].startswith('audio/en-US/')
    assert w['art_asset'].startswith('images/')
    assert all(w.get(k) for k in ['id','en','ko_parent_only','stage_id','zone_id'])

for zid,zone in zones.items():
    assert zone['word_count']==sum(w['zone_id']==zid for w in words)

policy=config['stage_unlock_policy']
assert policy['age6']['kind']=='default_unlocked'
for key,prev in [('age7','age6'),('age8','age7')]:
    gate=policy[key]
    assert gate['previous_stage_id']==prev
    assert gate['requires_all_collectibles'] is True
    assert gate['final_review_card_count']==20
    assert gate['final_review_completion_rule']=='all_cards_eventually_correct'
assert policy['never_relock_after_unlock']
assert policy['requires_all_manifest_content_publishable_for_final_review']
assert sum(config['quiz_mixture_by_stage']['age8'].values())==100
assert sum(config['quiz_mixture_by_stage']['age7'].values())==100
assert sum(config['quiz_mixture_by_stage']['age6'].values())==100

# Test representative collectibles and common semantic traps.
by_en={(w['stage_id'],w['en']):w for w in words}
for stage,en in [('age6','cat'),('age6','fish'),('age7','bus'),('age8','rocket')]:
    w=by_en[(stage,en)]
    assert w['collectible']['kind']=='word_subject'
for en in ('wake up','brush your teeth','wash your hands','drive'):
    assert by_en[('age8',en)]['collectible']['kind']=='word_scene'
for en in ('soccer','basketball','baseball','tennis'):
    assert by_en[('age8',en)]['collectible']['kind']=='word_scene'
for en in ('eleven','twelve','twenty'):
    w=by_en[('age7',en)]
    assert w['emoji_prototype'] is None and w['visual_type']=='diagram_required'

wordlist=wordlist_file.read_text(encoding='utf-8')
for word in newwords:
    assert f"`{word['en']}`" in wordlist, 'Word missing from parent-readable list: '+word['en']
print('PASS: 395 unique word IDs, age6 155 unchanged in-stage, age7 120, age8 120')
print('PASS: 3 stages / 22 zones / 6+6 new zones of 20 words')
print('PASS: level gates / 20 final review cards / 80% internal unlock / review ratios')
print('PASS: word-as-character mapping, scene nouns/verbs, numeric image requirements')
print('PASS: parent-readable full new-word list and seed-only assets status')
