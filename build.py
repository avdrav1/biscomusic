#!/usr/bin/env python3
"""Build the station from the show folders next to radio/.

Converts any FLAC without an MP3 yet (192k), then writes:
  schedule.json       local paths (audio/...), used by server.py
  site/schedule.json  R2 URLs, deployed to Cloudflare Pages with site/index.html and site/static/
"""
import json, os, re, shutil, subprocess, sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHOWS = os.path.dirname(HERE)
AUDIO = os.path.join(HERE, 'audio')
SITE = os.path.join(HERE, 'site')
R2_URL = 'https://audio.biscomusic.com/'

SHOW_RE = re.compile(r'^The Disco Biscuits - (\d{4}-\d{2}-\d{2}) (.+?) \[')
TRACK_RE = re.compile(r'^(\d+)\. (.+?)(?: - jam (\d+))?\.flac$', re.I)

def run(*cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout

def duration(path):
    return round(float(run('ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                           '-of', 'csv=p=0', path)), 3)

def convert(flac, mp3):
    print(f'  converting {os.path.basename(flac)}')
    tmp = mp3 + '.part.mp3'
    run('ffmpeg', '-v', 'error', '-y', '-i', flac, '-vn', '-codec:a', 'libmp3lame',
        '-b:a', '192k', '-map_metadata', '0', '-id3v2_version', '3', tmp)
    os.replace(tmp, mp3)

def main():
    os.makedirs(AUDIO, exist_ok=True)
    old = {}
    try:
        with open(os.path.join(HERE, 'schedule.json')) as f:
            meta = json.load(f)
        old = {t['file']: t['duration'] for t in meta['tracks']}
    except FileNotFoundError:
        meta = {'station': 'Biscuits Jam Radio', 'epoch': '2026-01-01T00:00:00Z'}

    tracks = []
    for show in sorted(os.listdir(SHOWS)):
        m = SHOW_RE.match(show)
        if not m or not os.path.isdir(os.path.join(SHOWS, show)):
            continue
        date, place = m.groups()
        parts = [p.strip() for p in place.split(',')]
        venue, city = ', '.join(parts[:-2]) or parts[0], ', '.join(parts[-2:])
        for name in os.listdir(os.path.join(SHOWS, show)):
            t = TRACK_RE.match(name)
            if not t:
                continue
            num, song, jam = int(t[1]), t[2], int(t[3]) if t[3] else None
            key = f'{date}-{num:02d}' + (f'-jam{jam}' if jam else '') + '.mp3'
            mp3 = os.path.join(AUDIO, key)
            if not os.path.exists(mp3):
                convert(os.path.join(SHOWS, show, name), mp3)
            file = 'audio/' + key
            tracks.append({'_order': (date, num, jam or 0), 'file': file, 'song': song, 'jam': jam, 'date': date,
                           'venue': venue, 'city': city,
                           'duration': old.get(file) or duration(mp3)})

    tracks.sort(key=lambda t: t.pop('_order'))
    if not tracks:
        sys.exit('No FLAC tracks found next to radio/')

    local = {'station': meta['station'], 'epoch': meta['epoch'], 'tracks': tracks}
    with open(os.path.join(HERE, 'schedule.json'), 'w') as f:
        json.dump(local, f, indent=1)

    os.makedirs(SITE, exist_ok=True)
    remote = dict(local, tracks=[dict(t, file=R2_URL + t['file'][len('audio/'):]) for t in tracks])
    with open(os.path.join(SITE, 'schedule.json'), 'w') as f:
        json.dump(remote, f, indent=1)
    shutil.copy(os.path.join(HERE, 'index.html'), SITE)
    shutil.copytree(os.path.join(HERE, 'static'), os.path.join(SITE, 'static'), dirs_exist_ok=True)
    print(f'  {len(tracks)} tracks, {sum(t["duration"] for t in tracks) / 3600:.1f} hours')

if __name__ == '__main__':
    main()
