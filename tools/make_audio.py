"""Edge TTS(en-US-AnaNeural, 아이 목소리)로 단어·문장·안내 음성을 미리 녹음한다.

  assets/audio/w/<id>.mp3   단어 (보통 빠르기)
  assets/audio/s/<id>.mp3   단어 (느리게)
  assets/audio/x/<id>.mp3   정답 뒤에 듣는 짧은 문장
  assets/audio/ui/<key>.mp3 안내·칭찬 문구

이미 있는 파일은 건너뛴다. 문장을 고쳤다면 해당 파일을 지우고 다시 돌린다.
data/words.json 을 먼저 만들어야 한다 (tools/build_data.py).
"""
import asyncio
import json
from pathlib import Path

import edge_tts

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / 'assets' / 'audio'
VOICE = 'en-US-AnaNeural'
SLOW = '-35%'

UI = {
    'welcome': 'Welcome to Hello Island!',
    'whats_this': "What's this?",
    'listen_choose': 'Listen and choose!',
    'meet': "Let's meet new words!",
    'great': 'Great job!',
    'yes': 'You got it!',
    'nice': 'Nice!',
    'wow': 'Wow!',
    'new_friend': 'A new friend!',
    'again': "Good try! We'll see it again soon.",
    'break': 'Great work! Time for a little break.',
    'done': 'You did it! Mission complete!',
    'gate': "Final mission! Let's go!",
    'portal': 'A new map is open!',
}


async def say(text, dest, rate='+0%', sem=None):
    if dest.exists() and dest.stat().st_size > 0:
        return False
    dest.parent.mkdir(parents=True, exist_ok=True)
    async with sem:
        for attempt in range(4):
            try:
                await edge_tts.Communicate(text, VOICE, rate=rate).save(str(dest))
                return True
            except Exception as err:  # 네트워크가 잠깐 끊기면 다시
                if attempt == 3:
                    raise
                await asyncio.sleep(1.5 * (attempt + 1))
                print('retry', dest.name, err)


def spoken(word):
    """단어만 읽을 때: 첫 글자를 대문자로, 마침표로 끝내 억양을 자연스럽게 내린다."""
    en = word['en']
    return en[0].upper() + en[1:] + '.'


async def main():
    words = json.loads((ROOT / 'data' / 'words.json').read_text(encoding='utf-8'))['words']
    sem = asyncio.Semaphore(8)
    jobs = []
    for w in words:
        jobs.append(say(spoken(w), OUT / 'w' / f"{w['id']}.mp3", sem=sem))
        jobs.append(say(spoken(w), OUT / 's' / f"{w['id']}.mp3", rate=SLOW, sem=sem))
        jobs.append(say(w['sentence'], OUT / 'x' / f"{w['id']}.mp3", sem=sem))
    for key, text in UI.items():
        jobs.append(say(text, OUT / 'ui' / f'{key}.mp3', sem=sem))
    made = await asyncio.gather(*jobs)
    print(f'녹음 {sum(1 for m in made if m)}개 새로 만듦 / 전체 {len(jobs)}개')


if __name__ == '__main__':
    asyncio.run(main())
