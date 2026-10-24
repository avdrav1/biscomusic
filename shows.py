#!/usr/bin/env python3
"""Biscuits Show Radio's program: every full soundboard show in archive.org's DiscoBiscuits collection, plus a vault of
full matrix and audience tapes of the shows from VAULT_YEARS that have no soundboard, played only when requested.

A recording counts when
  soundboard  its `source` starts with the board: "SBD", "DSBD", "Soundboard", "Digital Soundboard", "FM SBD"...
              Audience tapes that only name the board as the mic position ("DPA 4022 (DFC behind SBD)") and
              matrices (board + mics, "SBD + Schoeps", "Matrix ...") don't.
  full        it holds the show BIP lists for that date: at least FULL_SHARE of the setlist's songs are tracks
              titled as them (archive.py's matching, plus misspellings). An untitled recording is full when it runs
              at least FULL_SHARE of BIP's show length, or, when BIP has no length, has a track per setlist entry.
  matrix      board + mics: "Matrix ...", or a board source with a "+" ("SBD + AKG C1000").
  audience    anything else (a show from VAULT_YEARS only).
One recording per show: a full soundboard if there is one, else a matrix, else an audience tape, the most downloaded
of its kind. Soundboards are the schedule; matrix and audience shows are the vault (`vault`): the station never
rotates them in (functions/_station.js), but listeners can vote for them. A show's recording shouldn't change once
it's on the air: comments are pinned to "<show>/<track index>" (functions/_moments.js).

Writes shows.json (committed, so a build with archive.org or BIP down keeps the last program), which build.py
copies to site/shows.json for shows/index.html:
  { station, epoch, shows: [{ show, date, venue, place, item, source, kind, vault?, rating, ratings, setlist, tracks }] }
  kind     "sbd", "matrix" or "aud"; vault: true for the request-only shows (every kind but "sbd")
  setlist  [[set name, "Song > Song, Song"], ...] from BIP
  tracks   [{ title, file, duration, segue }]; play https://archive.org/download/<item>/<file>
Shows run oldest first, back to back from `epoch`, so every listener hears the same moment. That needs each track's
exact length: archive.org's `length` is often whole seconds, and a few off, which would make the player jump at every
track change. So each MP3's own header says how long it is (mp3_seconds), cached in .cache/mp3-seconds.json.
"""
import difflib
import json
import re
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import archive
import bip

OUT = Path(__file__).resolve().parent / "shows.json"
STATION = "Biscuits Show Radio"
EPOCH = "2026-10-23T00:00:00Z"
FULL_SHARE = 0.85
VAULT_YEARS = range(1998, 2002)   # matrix and audience tapes of these years' shows join the vault
SECONDS_CACHE = archive.CACHE.parent / "mp3-seconds.json"

_BOARD = re.compile(r"^\W*(source:\s*)?(plan c approved\s*/\s*)?((digital|analog|mono|fm|dat)\s*)*(d|fm)?(sbd|soundboard|sound board)\b", re.I)
_MIXED = re.compile(r"matrix|\+|on ?stage|audience|\baud\b|\bmics?\b|schoeps|akg|neumann|pzm", re.I)
_SETS = {"S1": "Set 1", "S2": "Set 2", "S3": "Set 3", "S4": "Set 4", "E1": "Encore", "E2": "Encore 2", "E3": "Encore 3"}


def is_soundboard(source) -> bool:
    source = " ".join(source) if isinstance(source, list) else (source or "")
    return bool(_BOARD.search(source)) and not _MIXED.search(source)


_MATRIX = re.compile(r"matrix|\b(d?sbd|soundboard)\b.*\+|\+.*\b(d?sbd|soundboard)\b", re.I)


def kind(source) -> str:
    """"sbd", "matrix" or "aud" (audience, or no source given)."""
    text = " ".join(source) if isinstance(source, list) else (source or "")
    return "sbd" if is_soundboard(text) else "matrix" if _MATRIX.search(text) else "aud"


def seconds(length) -> float:
    """archive.org lengths: '06:02', '1:02:03' or '361.23'."""
    length = str(length or "").strip()
    try:
        if ":" in length:
            total = 0.0
            for part in length.split(":"):
                total = total * 60 + float(part)
            return total
        return float(length)
    except ValueError:
        return 0.0


# ---------- exact MP3 lengths ----------

_KBPS = {True: (0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320),   # MPEG-1 Layer III
         False: (0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160)}     # MPEG-2 and 2.5
_RATES = {3: (44100, 48000, 32000), 2: (22050, 24000, 16000), 0: (11025, 12000, 8000)}


def _get_range(url: str, start: int, length: int) -> tuple:
    """(bytes, file size) of `length` bytes from `start`."""
    req = urllib.request.Request(url, headers={**archive.UA, "Range": f"bytes={start}-{start + length - 1}"})
    with urllib.request.urlopen(req, timeout=45) as r:
        size = r.headers.get("Content-Range", "").rpartition("/")[2]
        data = r.read()
        return data, int(size) if size.isdigit() else start + len(data)


def _frame(buf: bytes, i: int):
    """(mpeg1, bitrate, sample rate, frame length, mono) of a Layer III frame header at buf[i], or None."""
    if i + 4 > len(buf) or buf[i] != 0xFF or buf[i + 1] & 0xE0 != 0xE0 or (buf[i + 1] >> 1) & 3 != 1:
        return None
    version, b2 = (buf[i + 1] >> 3) & 3, buf[i + 2]
    if version == 1 or b2 >> 4 in (0, 15) or (b2 >> 2) & 3 == 3:
        return None
    mpeg1 = version == 3
    kbps, rate = _KBPS[mpeg1][b2 >> 4], _RATES[version][(b2 >> 2) & 3]
    return mpeg1, kbps * 1000, rate, (144 if mpeg1 else 72) * kbps * 1000 // rate + ((b2 >> 1) & 1), buf[i + 3] >> 6 == 3


def mp3_seconds(url: str) -> float:
    """Length of an MP3 from its first frames, as a browser works it out: the frame count of a VBR file's Xing/Info
    or VBRI header, else (constant bitrate) its size over its bitrate. Raises OSError or ValueError."""
    buf, size = _get_range(url, 0, 65536)
    base = 0   # file offset of buf[0]
    if buf[:3] == b"ID3":   # skip the ID3v2 tag (syncsafe size), however much cover art it holds
        base = 10 + (buf[6] << 21 | buf[7] << 14 | buf[8] << 7 | buf[9]) + (10 if buf[5] & 0x10 else 0)
        buf, size = _get_range(url, base, 65536)
    for i in range(len(buf) - 4):
        f = _frame(buf, i)
        if not f or not _frame(buf, i + f[3]):   # a real frame is followed by another
            continue
        mpeg1, bitrate, rate, _, mono = f
        per_frame = 1152 if mpeg1 else 576
        x = i + 4 + ((17 if mono else 32) if mpeg1 else (9 if mono else 17))
        if buf[x:x + 4] in (b"Xing", b"Info") and int.from_bytes(buf[x + 4:x + 8], "big") & 1:
            return int.from_bytes(buf[x + 8:x + 12], "big") * per_frame / rate
        if buf[i + 36:i + 40] == b"VBRI":
            return int.from_bytes(buf[i + 50:i + 54], "big") * per_frame / rate
        return (size - base - i) * 8 / bitrate
    raise ValueError(f"no MP3 frames in {url}")


def exact_lengths(listings: dict) -> dict:
    """{(item, file): seconds} for every track of the listings, measured once and then cached (derived MP3s don't
    change). A track that can't be measured now keeps archive.org's length this build."""
    try:
        cache = json.loads(SECONDS_CACHE.read_text())
    except (OSError, ValueError):
        cache = {}
    url = lambda item, file: f"https://archive.org/download/{item}/{urllib.parse.quote(file)}"
    todo = [(item, t["file"]) for item, tracks in listings.items() for t in tracks if url(item, t["file"]) not in cache]

    def measure(key):
        try:
            return url(*key), round(mp3_seconds(url(*key)), 3)
        except (OSError, ValueError) as e:
            print(f"  shows: couldn't measure {key[0]}/{key[1]} ({e}), using archive.org's length")
            return url(*key), None

    if todo:
        with ThreadPoolExecutor(archive.WORKERS) as pool:
            cache.update((u, s) for u, s in pool.map(measure, todo) if s)
        archive._write_json(SECONDS_CACHE, cache)
    return {(item, t["file"]): cache.get(url(item, t["file"])) or seconds(t["length"])
            for item, tracks in listings.items() for t in tracks}


def titled_as(song: str, track: str) -> bool:
    """archive.matches, or close enough for a taper's spelling: 'Pilin' It Higher', 'Little Shimmy', 'Vassilios'."""
    if archive.matches(song, track):
        return True
    want = archive.norm(song)
    for part in archive.track_parts(track):
        bare = archive._strip_suffixes(part)
        if (len(bare.split()) >= 2 and want.startswith(bare + " ")) or bare.startswith(want + " "):
            return True
        if difflib.SequenceMatcher(None, want, bare).ratio() >= 0.8:
            return True
    return False


def entries(setlist: dict) -> list:
    return [t["song"]["title"] for s in setlist["sets"] for t in s["tracks"] if t.get("song")]


def coverage(tracks: list, setlist: dict) -> float:
    """Share of the setlist's songs (each once) the recording has a track titled as."""
    songs = list(dict.fromkeys(entries(setlist)))
    if not songs:
        return 0.0
    return sum(any(titled_as(s, t["title"]) for t in tracks) for s in songs) / len(songs)


def is_full(tracks: list, setlist: dict) -> bool:
    if any(t["title"] for t in tracks):
        return coverage(tracks, setlist) >= FULL_SHARE
    length, expected = sum(seconds(t["length"]) for t in tracks), setlist["show"].get("duration") or 0
    return length >= FULL_SHARE * expected if expected else len(tracks) >= len(entries(setlist))


def setlist_text(setlist: dict) -> list:
    out = []
    for s in setlist["sets"]:
        line = ""
        for t in s["tracks"]:
            if t.get("song"):
                line += t["song"]["title"] + (" > " if t.get("segue") == ">" else ", ")
        if line:
            out.append([_SETS.get(s["label"], s["label"]), line.rstrip(" ,>")])
    return out


def program_tracks(item: str, tracks: list, setlist: dict, lengths: dict) -> list:
    """The recording's tracks for the player. Untitled tracks take the setlist's names when there's one per entry."""
    names = entries(setlist) if not any(t["title"] for t in tracks) and len(tracks) == len(entries(setlist)) else None
    out = []
    for i, t in enumerate(tracks):
        title = re.sub(r"^\s*\d{1,2}\s*[.)]\s+", "", t["title"]).strip()
        segue = bool(re.search(r"-?>\s*$", title))
        title = re.sub(r"\s*-?>\s*$", "", title)
        out.append({"title": title or (names[i] if names else ""), "file": urllib.parse.quote(t["file"]),
                    "duration": lengths[(item, t["file"])], "segue": segue})
    return out


def build() -> dict:
    """Find the shows and write shows.json. Raises OSError when archive.org or BIP can't be reached."""
    found = [d for d in archive.search(["identifier", "date", "source", "downloads"]) if d.get("date")]
    for d in found:
        d["kind"] = kind(d.get("source"))
    candidates = [d for d in found if d["kind"] == "sbd" or int(d["date"][:4]) in VAULT_YEARS]
    years = sorted({int(d["date"][:4]) for d in candidates})
    with ThreadPoolExecutor(archive.WORKERS) as pool:
        setlists = [s for year in pool.map(bip.year_setlists, years) for s in year]
        listings = dict(zip((d["identifier"] for d in candidates), pool.map(archive.item_tracks, (d["identifier"] for d in candidates))))
    by_date: dict = {}
    for s in setlists:
        by_date.setdefault(s["show"]["date"][:10], []).append(s)

    chosen: dict = {}   # BIP show slug -> (recording, setlist)
    skipped = []
    rank = {"sbd": 0, "matrix": 1, "aud": 2}
    for d in sorted(candidates, key=lambda d: (rank[d["kind"]], -(d.get("downloads") or 0), d["identifier"])):
        tracks = listings[d["identifier"]]
        if not tracks or not all(seconds(t["length"]) for t in tracks):
            skipped.append(d["identifier"])
            continue
        # A night with two shows (an early set, a festival) is matched to the one the recording covers.
        night = [s for s in by_date.get(d["date"][:10], []) if entries(s)]
        full = [s for s in night if is_full(tracks, s)]
        if not full:
            skipped.append(d["identifier"])
            continue
        setlist = max(full, key=lambda s: coverage(tracks, s))
        chosen.setdefault(setlist["show"]["slug"], (d, setlist))

    picked = sorted(chosen.values(), key=lambda c: (c[1]["show"]["date"], c[1]["show"]["slug"]))
    lengths = exact_lengths({d["identifier"]: listings[d["identifier"]] for d, _ in picked})
    shows = []
    for d, s in picked:
        rated = s["show"].get("ratingsCount") or 0
        shows.append({
            "show": s["show"]["slug"], "date": s["show"]["date"][:10],
            "venue": (s.get("venue") or {}).get("name") or "Unknown venue", "place": bip.place(s.get("venue")),
            "item": d["identifier"], "source": (" ".join(d["source"]) if isinstance(d.get("source"), list) else d.get("source")) or "",
            "kind": d["kind"], **({"vault": True} if d["kind"] != "sbd" else {}),
            "rating": round(s["show"]["averageRating"], 2) if rated else None, "ratings": rated,
            "setlist": setlist_text(s), "tracks": program_tracks(d["identifier"], listings[d["identifier"]], s, lengths),
        })
    program = {"station": STATION, "epoch": EPOCH, "shows": shows}
    OUT.write_text(json.dumps(program, indent=1) + "\n")
    hours = lambda vault: sum(t["duration"] for sh in shows if sh.get("vault", False) == vault for t in sh["tracks"]) / 3600
    vault = sum(1 for sh in shows if sh.get("vault"))
    print(f"  shows: {len(shows) - vault} full soundboard shows, {hours(False):.1f} hours; vault: {vault} matrix and audience "
          f"shows, {hours(True):.1f} hours ({len(candidates)} recordings; {len(skipped)} partial, untimed or not on BIP)")
    return program


def api_program(program: dict) -> dict:
    """What the API needs of the program (functions/_station.js, _shared.js): shows.json without the setlists, titles
    and files, so each request parses a sixth of it. Same shape, so the functions read either file."""
    return {"epoch": program["epoch"], "shows": [{"show": s["show"], **({"vault": True} if s.get("vault") else {}),
                                                  "tracks": [{"duration": t["duration"]} for t in s["tracks"]]}
                                                 for s in program["shows"]]}


if __name__ == "__main__":
    build()
