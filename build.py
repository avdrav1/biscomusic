#!/usr/bin/env python3
"""Build the station from the show folders next to radio/.

Converts any FLAC without an MP3 yet (192k, loudness-normalized to -14 LUFS), then writes:
  schedule.json       local paths (audio/...), used by server.py; each track carries its song's BIP slug
  site/schedule.json  R2 URLs (?v=<content hash>, so re-encoded files bypass caches),
                      deployed to Cloudflare Pages with the pages and site/static/
  site/clips.json     archive.org recordings of every song's debut and latest version (see archive.py),
                      for the song facts on the radio and the /first-played timeline
"""
import base64, hashlib, json, math, os, re, shutil, subprocess, sys, urllib.parse, urllib.request
from array import array
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

import archive, bip

HERE = os.path.dirname(os.path.abspath(__file__))
SHOWS = os.path.dirname(HERE)
AUDIO = os.path.join(HERE, 'audio')
SITE = os.path.join(HERE, 'site')
R2_URL = 'https://audio.biscomusic.com/'
WAVES = os.path.join(HERE, 'waves')
# Deployed pages (Pages serves best.html at /best); index.html first.
PAGES = ('index.html', 'best.html', 'nominate.html', 'install.html', 'first-played.html')
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

def service_worker(versioned):
    """site/sw.js: the source with this build's version and the files to keep offline."""
    pages = ['/' if p == 'index.html' else '/' + p.removesuffix('.html') for p in PAGES]
    fonts = sorted('/static/fonts/' + f for f in os.listdir(os.path.join(HERE, 'static', 'fonts')) if f.endswith('.woff2'))
    files = ['/' + v for v in versioned.values()] + fonts + [
        '/static/favicon.svg', '/static/icon-192.png', '/static/icon-512.png', '/static/apple-touch-icon.png',
        '/static/manifest.webmanifest', '/schedule.json']
    h = hashlib.md5()
    for f in PAGES + ('sw.js', 'static/manifest.webmanifest'):
        h.update(open(os.path.join(HERE, f), 'rb').read())
    h.update(json.dumps(files).encode())
    with open(os.path.join(HERE, 'sw.js')) as f:
        src = f.read()
    src = src.replace("const VERSION = 'dev';", f"const VERSION = '{h.hexdigest()[:10]}';", 1)
    src = src.replace('const PRECACHE = [];', 'const PRECACHE = ' + json.dumps(pages + files, indent=1) + ';', 1)
    with open(os.path.join(SITE, 'sw.js'), 'w') as f:
        f.write(src)

def content_hash(path):
    h = hashlib.md5()
    with open(path, 'rb') as f:
        for chunk in iter(lambda: f.read(1 << 20), b''):
            h.update(chunk)
    return h.hexdigest()[:10]

NUGS_CATALOG = os.path.join(SHOWS, 'nugs', 'catalog.json')   # from nugs/fetch_catalog.py
NOT_A_SONG = re.compile(r'^(crowd|intros?|banter|tuning|encore break|soundcheck|setbreak\b.*)$', re.I)

def song_key(title):
    return re.sub(r'[^a-z0-9]', '', title.lower())

def nominees(tracks):
    """site/nominees.json: every song performance on Nugs, for the nominations page.
    Compact: shows as [nugs id, date, venue, city]; tracks as [nugs track id, show index, title, seconds, on air].
    "on air" = a jam from that performance is already on the station (same date + song)."""
    try:
        with open(NUGS_CATALOG) as f:
            catalog = json.load(f)
    except FileNotFoundError:
        print('  no nugs/catalog.json, skipping nominations')
        return None
    on_air = {(t['date'], song_key(t['song'])) for t in tracks}
    shows, out = [], []
    for s in catalog:
        if s['type'] != 'Show' or not s['date']:
            continue    # studio albums
        songs = [t for t in s['tracks'] if not NOT_A_SONG.match(t['title'].strip())]
        if not songs:
            continue
        place = ', '.join(p for p in (s['city'], s['state']) if p)
        shows.append([s['container_id'], s['date'], s['venue'], place])
        out += [[t['track_id'], len(shows) - 1, t['title'], t['seconds'],
                 int((s['date'], song_key(t['title'])) in on_air)] for t in songs]
    data = {'shows': shows, 'tracks': out}
    with open(os.path.join(SITE, 'nominees.json'), 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print(f'  {len(out)} performances from {len(shows)} shows up for nomination')
    return data

BIP_API = 'https://discobiscuits.net/api/songs'
# Station titles (from the FLAC names) that BIP spells differently, as BIP song slugs.
BIP_ALIASES = {'More U Know': 'more-you-know', 'The Safety Dance': 'safety-dance',
               'Mishawaka Jam': 'mishawaka-improv-jam'}

def bip_catalog():
    """Every song on BIP, with its debut and last show (about 2 MB)."""
    with urllib.request.urlopen(urllib.request.Request(BIP_API, headers=bip.UA), timeout=60) as r:
        return json.load(r)

def link_songs(tracks, catalog):
    """Give each track its song's BIP slug, the key of /api/songs and clips.json."""
    slugs = {s['slug'] for s in catalog}
    by_title = {song_key(s['title']): s['slug'] for s in catalog}
    missing = set()
    for t in tracks:
        slug = BIP_ALIASES.get(t['song']) or by_title.get(song_key(t['song']))
        if slug in slugs:
            t['slug'] = slug
        else:
            missing.add(t['song'])
    if missing:
        print(f'  not on BIP (add to BIP_ALIASES): {", ".join(sorted(missing))}')

def bip_place(venue):
    """"Philadelphia, PA" in the US, "London, United Kingdom" elsewhere (as functions/_songs.js)."""
    venue = venue or {}
    region = venue.get('state') if (venue.get('country') or '') in ('', 'United States') else venue.get('country')
    return ', '.join(p for p in (venue.get('city'), region) if p)

def clips(catalog):
    """site/clips.json: { built, clips: { slug: { debut, latest } } }, recordings found by archive.py.
    A clip: { url, item, track, length, how, date, show, venue, place }; the show is the one it was taped at."""
    songs = [s for s in catalog if s.get('firstPlayedShow')]
    debut, latest, _ = archive.find_audio([
        {'slug': s['slug'], 'id': s['id'], 'title': s['title'], 'date': s['firstPlayedShow']['date'],
         'show_id': s['firstPlayedShow']['id'], 'last_show': (s.get('lastPlayedShow') or s['firstPlayedShow'])['slug'],
         'plays': s.get('timesPlayed') or 0}
        for s in songs])

    def clip(hit, song):
        first = song['firstPlayedShow']
        out = {'url': f"https://archive.org/download/{hit['id']}/{urllib.parse.quote(hit['file'])}",
               'item': hit['id'], 'track': hit['track'], 'length': hit['length'], 'how': hit['how'],
               # "title" and "setlist" clips are from the debut, the others say which show they're from
               'date': first['date'], 'show': first['slug'],
               'venue': (first.get('venue') or {}).get('name') or 'Unknown venue', 'place': bip_place(first.get('venue'))}
        out.update({k: hit[k] for k in ('date', 'show', 'venue', 'place') if k in hit})
        return out

    out = {}
    for s in songs:
        found = {k: clip(v[s['slug']], s) for k, v in (('debut', debut), ('latest', latest)) if s['slug'] in v}
        if found:
            out[s['slug']] = found
    with open(os.path.join(SITE, 'clips.json'), 'w') as f:
        json.dump({'built': datetime.now(timezone.utc).isoformat(timespec='seconds'), 'clips': out}, f, separators=(',', ':'))
    print(f'  archive.org: {len(debut)} of {len(songs)} songs have a debut clip, {len(latest)} a newer latest one')

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

    try:
        catalog = bip_catalog()
        link_songs(tracks, catalog)
    except OSError as e:   # BIP down: the radio still deploys, with the song links of the last build
        catalog = None
        print(f'  BIP unreachable ({e}): keeping song links and clips.json from the last build')
        before = {t['file']: t['slug'] for t in meta.get('tracks', []) if t.get('slug')}
        for t in tracks:
            if t['file'] in before:
                t['slug'] = before[t['file']]

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
    versioned = {f: f'{f}?v={content_hash(os.path.join(HERE, f))}' for f in ('static/app.css', 'static/station.js', 'static/icons.svg', 'static/nominees.js', 'static/pwa.js', 'static/songs.js')}
    nominees(tracks)
    if catalog:
        try:
            clips(catalog)
        except OSError as e:
            print(f'  archive.org unreachable ({e}): keeping clips.json from the last build')
    for page in PAGES:
        with open(os.path.join(HERE, page)) as f:
            html = f.read()
        for f, v in versioned.items():   # "static/x" and "static/icons.svg#name"
            html = re.sub(re.escape(f) + r'(?=["#])', v, html)
        with open(os.path.join(SITE, page), 'w') as f:
            f.write(html)
    shutil.copytree(os.path.join(HERE, 'static'), os.path.join(SITE, 'static'), dirs_exist_ok=True)
    shutil.copytree(WAVES, os.path.join(SITE, 'waves'), dirs_exist_ok=True)
    service_worker(versioned)
    print(f'  {len(tracks)} tracks, {sum(t["duration"] for t in tracks) / 3600:.1f} hours')

if __name__ == '__main__':
    main()
