#!/bin/bash
# Moderate comments on jams. and shows.biscomusic.com (live D1 database; a show radio comment's track is "<show id>/<track index>").
#   ./moderate.sh                 latest 30 comments
#   ./moderate.sh list 100        latest 100
#   ./moderate.sh hide 42         hide comment 42
#   ./moderate.sh unhide 42       show it again
#   ./moderate.sh hide-author 42  hide every comment from whoever posted 42 (same IP)
#   ./moderate.sh station         what's on air, what's next, and this round's votes
#   ./moderate.sh skip            end the current track now (votes cast so far still count)
#   ./moderate.sh nominations 50  most-wanted performances from /nominate (default 30)
set -euo pipefail
cd "$(dirname "$0")"
DB=biscomusic-comments

sql() { npx --yes wrangler@4 d1 execute "$DB" --remote --json --command "$1" 2>/dev/null; }
changed() { sql "$1" | jq -r '"\(.[0].meta.changes) comment(s) updated"'; }

cmd=${1:-list}
arg=${2:-}
if [[ "$cmd" =~ ^(hide|unhide|hide-author)$ ]] && ! [[ "$arg" =~ ^[0-9]+$ ]]; then echo "Need a comment id, e.g. ./moderate.sh $cmd 42"; exit 1; fi

case "$cmd" in
  list)
    [[ "$arg" =~ ^[0-9]+$ ]] || arg=30
    sql "SELECT id, track, CAST(pos AS INT) AS sec, COALESCE(nickname, 'anonymous') AS nick, body,
                datetime(created_at / 1000, 'unixepoch') AS utc, substr(ip_hash, 1, 8) AS author, hidden
         FROM comments ORDER BY id DESC LIMIT $arg" |
      jq -r '.[0].results[] | "#\(.id)  \(.utc)  \(.track) @\(.sec / 60 | floor):\(.sec % 60 | tostring | if length < 2 then "0" + . else . end)  [\(.author)] \(.nick): \(.body)\(if .hidden == 1 then "  (HIDDEN)" else "" end)"' ;;
  hide)        changed "UPDATE comments SET hidden = 1 WHERE id = $arg" ;;
  unhide)      changed "UPDATE comments SET hidden = 0 WHERE id = $arg" ;;
  hide-author) changed "UPDATE comments SET hidden = 1 WHERE ip_hash = (SELECT ip_hash FROM comments WHERE id = $arg)" ;;
  station)
    sql "SELECT round, track, datetime(started_at / 1000, 'unixepoch') AS since, next_track, next_source, next_votes,
                (SELECT group_concat(track || ' x' || n, ', ') FROM (SELECT track, COUNT(*) AS n FROM votes
                   WHERE round = station.round GROUP BY track ORDER BY n DESC)) AS votes
         FROM station" |
      jq -r '.[0].results[] | "Round \(.round): \(.track) since \(.since) UTC\nNext: \(.next_track // "not locked yet") \(if .next_source then "(" + .next_source + ")" else "" end)\nVotes: \(.votes // "none")"' ;;
  skip)
    # Make the current track end now; the next /api/station request locks the next pick and moves on.
    track=$(sql "SELECT track FROM station" | jq -r '.[0].results[0].track')
    dur=$(jq -r --arg t "audio/$track.mp3" '.tracks[] | select(.file == $t) | .duration' schedule.json)
    [ -n "$dur" ] || dur=0
    started=$(python3 -c "import time; print(int(time.time() * 1000 - $dur * 1000))")
    sql "UPDATE station SET version = version + 1, started_at = $started, next_track = NULL, next_source = NULL,
         next_votes = NULL, next_cursor = NULL" | jq -r '"Skipped \"'"$track"'\" (\(.[0].meta.changes) row)"'
    curl -s -o /dev/null https://biscomusic.com/api/station ;;
  nominations)
    # Votes live in D1 by Nugs track id; names and dates come from the built site/nominees.json.
    [[ "$arg" =~ ^[0-9]+$ ]] || arg=30
    sql "SELECT track, COUNT(*) AS n FROM nominations GROUP BY track ORDER BY n DESC LIMIT $arg" |
      jq -r --slurpfile cat site/nominees.json '
        ($cat[0].tracks | map({key: (.[0] | tostring), value: .}) | from_entries) as $t |
        .[0].results[] | $t[.track | tostring] as $x | $cat[0].shows[$x[1]] as $s |
        "\(.n) votes  \($s[1])  \($x[2]) (\($x[3] / 60 | floor) min)  \($s[2]), \($s[3])  https://play.nugs.net/release/\($s[0])"' ;;
  *) sed -n '2,10p' "$0"; exit 1 ;;
esac
