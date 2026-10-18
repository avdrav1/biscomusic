#!/usr/bin/env python3
"""Build the station from the show folders next to radio/.

Converts any FLAC without an MP3 yet (192k, loudness-normalized to -14 LUFS), then writes:
  schedule.json       local paths (audio/...), used by server.py
  site/schedule.json  R2 URLs (?v=<content hash>, so re-encoded files bypass caches),
                      deployed to Cloudflare Pages with the pages and site/static/
"""
import base64, hashlib, json, math, os, re, shutil, subprocess, sys
from array import array
from concurrent.futures import ThreadPoolExecutor

HERE = os.path.dirname(os.path.abspath(__file__))
SHOWS = os.path.dirname(HERE)
AUDIO = os.path.join(HERE, 'audio')
SITE = os.path.join(HERE, 'site')
R2_URL = 'https://audio.biscomusic.com/'
WAVES = os.path.join(HERE, 'waves')
WAVE_BARS = 200
WAVE_RANGE_DB = 8           # loudness range the timeline shows, below each track's peak
# Every jam at the same perceived loudness: -14 LUFS integrated, peaks under -1 dBTP.
LOUDNORM = 'I=-14:TP=-1:LRA=11'

SHOW_RE = re.compile(r'^The Disco Biscuits - (\d{4}-\d{2}-\d{2}) (.+?) \[')
TRACK_RE = re.compile(r'^(\d+)\. (.+?)(?: - jam (\d+))?\.flac$', re.I)

def run(*cmd):
    return subprocess.run(cmd, check=True, capture_output=True, text=True).stdout

def duration(path):
    return round(float(run('ffprobe', '-v', 'error', '-show_entries', 'format=duration',
                           '-of', 'csv=p=0', path)), 3)

def convert(flac, mp3):
    """Two-pass loudnorm: measure, then apply one linear gain (keeps the jam's dynamics)."""
    print(f'  converting {os.path.basename(flac)}')
    out = subprocess.run(['ffmpeg', '-hide_banner', '-nostats', '-i', flac, '-af',
                          f'loudnorm={LOUDNORM}:print_format=json', '-f', 'null', '-'],
                         check=True, capture_output=True, text=True).stderr
    m = json.loads(out[out.rindex('{'):out.rindex('}') + 1])
    measured = (f"measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
                f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true")
    rate = run('ffprobe', '-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=sample_rate',
               '-of', 'csv=p=0', flac).strip()
    tmp = mp3 + '.part.mp3'
    run('ffmpeg', '-v', 'error', '-y', '-i', flac, '-vn', '-af', f'loudnorm={LOUDNORM}:{measured}',
        '-ar', rate, '-codec:a', 'libmp3lame', '-b:a', '192k',
        '-map_metadata', '0', '-id3v2_version', '3', tmp)
    os.replace(tmp, mp3)

def waveform(mp3):
    """The player's timeline: WAVE_BARS loudness levels (RMS, 0-255) as base64 in waves/<id>.txt."""
    out = os.path.join(WAVES, os.path.basename(mp3)[:-4] + '.txt')
    if os.path.exists(out) and os.path.getmtime(out) >= os.path.getmtime(mp3):
        return False
    pcm = subprocess.run(['ffmpeg', '-v', 'error', '-i', mp3, '-ac', '1', '-ar', '4000', '-f', 's16le', '-'],
                         check=True, capture_output=True).stdout
    samples = array('h'); samples.frombytes(pcm[:len(pcm) // 2 * 2])
    per = max(1, len(samples) // WAVE_BARS)
    rms = []
    for b in range(WAVE_BARS):
        chunk = samples[b * per:(b + 1) * per]
        rms.append(math.sqrt(sum(x * x for x in chunk) / len(chunk)) if chunk else 0.0)
    # Jams are mixed loud and steady, so a linear scale draws a flat wall. Scale in dB below the
    # track's loudest moment instead: a 3 dB dip reads as a visibly lower bar, a breakdown drops clearly.
    db = [20 * math.log10(max(r, 1.0)) for r in rms]
    top = max(db)
    levels = bytes(round(255 * min(1.0, max(0.06, (d - (top - WAVE_RANGE_DB)) / WAVE_RANGE_DB))) for d in db)
    with open(out + '.part', 'w') as f:
        f.write(base64.b64encode(levels).decode())
    os.replace(out + '.part', out)
    return True

def content_hash(path):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()[:10]

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
            file = 'audio/' + key
            if not os.path.exists(mp3):
                convert(os.path.join(SHOWS, show, name), mp3)
                old.pop(file, None)   # new encode: measure its duration again
            tracks.append({'_order': (date, num, jam or 0), 'file': file, 'song': song, 'jam': jam, 'date': date,
                           'venue': venue, 'city': city,
                           'duration': old.get(file) or duration(mp3)})

    tracks.sort(key=lambda t: t.pop('_order'))
    if not tracks:
        sys.exit('No FLAC tracks found next to radio/')

    local = {'station': meta['station'], 'epoch': meta['epoch'], 'tracks': tracks}
    with open(os.path.join(HERE, 'schedule.json'), 'w') as f:
        json.dump(local, f, indent=1)

    os.makedirs(WAVES, exist_ok=True)
    with ThreadPoolExecutor(6) as pool:
        made = sum(pool.map(waveform, [os.path.join(HERE, t['file']) for t in tracks]))
    if made:
        print(f'  {made} waveform(s) drawn')

    os.makedirs(SITE, exist_ok=True)
    remote = dict(local, tracks=[dict(t, file=R2_URL + t['file'][len('audio/'):] + '?v=' + content_hash(os.path.join(HERE, t['file'])))
                                 for t in tracks])
    with open(os.path.join(SITE, 'schedule.json'), 'w') as f:
        json.dump(remote, f, indent=1)
    # Browsers may keep static/ files for hours, so point the deployed pages at versioned CSS/JS.
    versioned = {f: f'{f}?v={content_hash(os.path.join(HERE, f))}' for f in ('static/app.css', 'static/station.js', 'static/icons.svg')}
    for page in ('index.html', 'best.html'):
        with open(os.path.join(HERE, page)) as f:
            html = f.read()
        for f, v in versioned.items():   # "static/x" and "static/icons.svg#name"
            html = re.sub(re.escape(f) + r'(?=["#])', v, html)
        with open(os.path.join(SITE, page), 'w') as f:
            f.write(html)
    shutil.copytree(os.path.join(HERE, 'static'), os.path.join(SITE, 'static'), dirs_exist_ok=True)
    shutil.copytree(WAVES, os.path.join(SITE, 'waves'), dirs_exist_ok=True)
    print(f'  {len(tracks)} tracks, {sum(t["duration"] for t in tracks) / 3600:.1f} hours')

if __name__ == '__main__':
    main()
