"""Find the show and songs behind a mix's track, from its title.

A mix track's title is its source file's: "Caterpillar-Voices (2023-07-08)", "HAB > Gangster (2009-06-05)",
"Mr. Don → Fire Will Exchange (2024-09-08, Bellvue, CO)", "cater > hero (2019-11-16)". The date picks the show
(BIP's setlists of that year); the words are matched against that show's setlist only, so nicknames
(HAB, AC2B, Spacebird, Humu) resolve without a dictionary of every song.

BIP's year setlists are cached in .cache/bip/year-<year>.json: past years for good, the current year a day.
"""
import json, re, time
from pathlib import Path

import bip

CACHE = Path(__file__).resolve().parent / '.cache' / 'bip'
DATE_RE = re.compile(r'\s*\((\d{4}-\d{2}-\d{2})(?:,[^)]*)?\)\s*$')
# Nicknames that aren't the song's initials, a prefix, or one of its words
NICKNAMES = {'ac2b': 'aceetobee', 'acetobee': 'aceetobee', 'bc': 'bernsteinandchasnoff', 'crix': 'crickets',
             'gig': 'grassisgreen', 'rlh': 'runlikehell', 'tbeam': 'tractorbeam', 'munchin': 'munchkininvasion',
             'caterpiller': 'caterpillar', 'pillar': 'caterpillar', 'humu': 'humuhumunukunukuapuaa',
             'apoa': 'anotherplanofattack', 'attack': 'anotherplanofattack', 'kotw': 'kingoftheworld'}
FILLER = {'jam', 'intro', 'ending', 'only', 'middle', 'partial', '2nd', 'part2', 'part', 'the', 'and', 'a'}


def year_setlists(year):
    path = CACHE / f'year-{year}.json'
    fresh = 86400 if year >= time.gmtime().tm_year else float('inf')
    if path.exists() and time.time() - path.stat().st_mtime < fresh:
        return json.loads(path.read_text())
    shows = bip.year_setlists(year)
    if shows:
        CACHE.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(shows))
    return shows


def key(s):
    return re.sub(r'[^a-z0-9]', '', s.lower())


def aliases(title):
    """The ways a mix title may name a song: its key, without "The", its initials, its words."""
    words = [key(w) for w in re.split(r'[\s\-/]+', title) if key(w)]
    full = key(title)
    out = {full, full.removeprefix('the')}
    if len(words) >= 2:
        out.add(''.join(w[0] for w in words))
    out |= {w for w in words if len(w) >= 3 and w not in FILLER}
    return out


def match_songs(text, setlist):
    """(the setlist songs a title names, in its order: [{title, slug}], whether every word of it was placed).
    Tries the longest run of words first; a run that fits several songs ("Super Mario ... Theme") goes to the
    one sharing the most of the title's words."""
    tokens = [key(t) for t in re.findall(r"[a-z0-9&.']+", text.lower()) if key(t)]   # "I-Man", "7-11": runs are joined below
    songs = []
    for s in setlist:
        if s not in songs:
            songs.append(s)
    table = [(s, key(s['title']), aliases(s['title'])) for s in songs]
    shared = lambda full: sum(1 for t in tokens if len(t) >= 3 and t in full)

    def fits(span, single):
        """(songs the run names, whether it names them outright rather than only starting with one's name)"""
        span = NICKNAMES.get(span, span)
        named = [s for s, full, names in table if span in names or span == full or (len(span) >= 3 and full.startswith(span))]
        if named or not single:
            return named, True
        # one run-together word: "VeryMoonEnding" is The Very Moon's ending, "runningbliss" Running into the Night's
        return [s for s, full, names in table if any(len(n) >= 5 and span.startswith(n) for n in names)], False

    found, whole, i = [], True, 0
    while i < len(tokens):
        for j in range(min(len(tokens), i + 7), i, -1):
            hits, outright = fits(''.join(tokens[i:j]), j == i + 1)
            if hits:
                whole &= outright
                hit = max(hits, key=lambda s: shared(key(s['title'])))
                if not found or found[-1] is not hit:
                    found.append(hit)
                i = j
                break
        else:
            whole &= tokens[i] in FILLER
            i += 1
    return found, whole


def setlist_of(show):
    return [t['song'] for st in show.get('sets') or [] for t in st.get('tracks') or [] if t.get('song')]


def resolve(title, by_date):
    """{show, date, venue, city, songs: [{title, slug}], whole, text} for a dated mix title, or None.
    whole: every word of the title was placed, so the setlist's titles can stand in for it."""
    m = DATE_RE.search(title)
    if not m:
        return None
    date, text = m[1], title[:m.start()]
    best = None
    for show in by_date.get(date, []):
        songs, whole = match_songs(text, setlist_of(show))
        if best is None or len(songs) > len(best[1]):
            best = (show, songs, whole)
    if not best:
        return None
    show, songs, whole = best
    venue = show.get('venue') or {}
    return {'show': show['show']['slug'], 'date': date, 'venue': venue.get('name') or 'Unknown venue',
            'city': bip.place(venue), 'songs': songs, 'whole': whole and bool(songs), 'text': text.strip()}


def shows_by_date(years):
    by_date = {}
    for y in sorted(years):
        for s in year_setlists(y):
            by_date.setdefault(s['show']['date'][:10], []).append(s)
    return by_date
