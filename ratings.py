"""Rank the versions (performances) of a song by what listeners think of them, on BIP and archive.org.

BIP          listeners rate each performance of each song: 1-5 stars, `rating` the mean of `ratings` votes.
archive.org  reviewers rate a recording of a whole show: 1-5 stars, sound quality included. Every
             recording of one night is pooled into that night's rating (show_ratings).

The two grade on different curves, so a rating becomes a z-score against its own source: how far above
that source's average it is, in that source's standard deviations (Scale, over every rated performance or
show, weighted by votes). A version scores

    sum(w * z) / (sum(w) + PRIOR)        w = WEIGHT[source] * votes / (votes + SHRINK)

so votes are what move it away from average (0): one 5-star vote doesn't outrank eight votes averaging
4.9. archive.org counts half as much as BIP because it rates the night and the tape, not this song.
A version rated nowhere isn't ranked.
"""
import math

SHRINK = 2.0
PRIOR = 0.5
WEIGHT = {"bip": 1.0, "ia": 0.5}


class Scale:
    """Mean and spread of one source's ratings: pairs of (average rating, votes)."""

    def __init__(self, pairs):
        votes = sum(v for _, v in pairs)
        self.mean = sum(r * v for r, v in pairs) / votes if votes else 0.0
        var = sum(v * (r - self.mean) ** 2 for r, v in pairs) / votes if votes else 0.0
        self.sd = math.sqrt(var) or 1.0

    def z(self, rating: float) -> float:
        return (rating - self.mean) / self.sd


def show_ratings(by_date: dict) -> dict:
    """archive.items_by_date() -> {date: (rating, reviews)}, every reviewed recording of the night pooled."""
    out = {}
    for day, items in by_date.items():
        reviews = sum(it["reviews"] for it in items if it["rating"])
        if reviews:
            out[day] = (sum(it["rating"] * it["reviews"] for it in items if it["rating"]) / reviews, reviews)
    return out


def rank(perfs: dict, shows: dict, n: int = 3) -> dict:
    """perfs: {song slug: bip.song_performances()}; shows: show_ratings(). -> {slug: [version]} with each
    song's n best rated versions, best first (ties: earlier first). A version is the performance plus
    `score`, `bip` {rating, votes} and `ia` {rating, reviews}, either None when that source has no rating."""
    bip_scale = Scale([(p["rating"], p["ratings"]) for ps in perfs.values() for p in ps if p["ratings"]])
    ia_scale = Scale(list(shows.values()))
    out = {}
    for slug, ps in perfs.items():
        versions = []
        for p in ps:
            parts = []
            bip = ia = None
            if p["ratings"]:
                bip = {"rating": round(p["rating"], 2), "votes": p["ratings"]}
                parts.append(("bip", bip_scale.z(p["rating"]), p["ratings"]))
            if p["date"] in shows:
                rating, reviews = shows[p["date"]]
                ia = {"rating": round(rating, 2), "reviews": reviews}
                parts.append(("ia", ia_scale.z(rating), reviews))
            if not parts:
                continue
            weights = [WEIGHT[src] * votes / (votes + SHRINK) for src, _, votes in parts]
            score = sum(w * z for w, (_, z, _) in zip(weights, parts)) / (sum(weights) + PRIOR)
            versions.append({**p, "score": round(score, 3), "bip": bip, "ia": ia})
        versions.sort(key=lambda v: (-v["score"], v["date"]))
        if versions:
            out[slug] = versions[:n]
    return out
