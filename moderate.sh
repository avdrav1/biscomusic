#!/bin/bash
# Moderate comments on biscomusic.com (live D1 database).
#   ./moderate.sh                 latest 30 comments
#   ./moderate.sh list 100        latest 100
#   ./moderate.sh hide 42         hide comment 42
#   ./moderate.sh unhide 42       show it again
#   ./moderate.sh hide-author 42  hide every comment from whoever posted 42 (same IP)
set -euo pipefail
cd "$(dirname "$0")"
DB=biscomusic-comments

sql() { npx --yes wrangler@4 d1 execute "$DB" --remote --json --command "$1" 2>/dev/null; }
changed() { sql "$1" | jq -r '"\(.[0].meta.changes) comment(s) updated"'; }

cmd=${1:-list}
arg=${2:-}
if [[ "$cmd" != list ]] && ! [[ "$arg" =~ ^[0-9]+$ ]]; then echo "Need a comment id, e.g. ./moderate.sh $cmd 42"; exit 1; fi

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
  *) sed -n '2,7p' "$0"; exit 1 ;;
esac
