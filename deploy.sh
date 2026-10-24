#!/bin/bash
# Publish the stations: new FLACs -> 192k MP3 -> R2 (audio.biscomusic.com),
# rebuild the schedules and the show radio's program, then redeploy to Pages: one deploy serves
# jams.biscomusic.com, shows.biscomusic.com and the station picker at biscomusic.com (functions/_middleware.js).
# Pages picks up functions/ (the comments API) and wrangler.toml (D1 binding) from here.
set -euo pipefail
cd "$(dirname "$0")"

BUCKET=biscomusic-audio
PROJECT=biscomusic
AUDIO_URL=https://audio.biscomusic.com
UPLOADED=.r2-uploaded   # "<key> <md5>" for each file known to be in R2
wrangler() { npx --yes wrangler@4 "$@"; }

for tool in ffmpeg ffprobe python3 curl; do
  command -v "$tool" >/dev/null || { echo "Missing $tool (brew install ffmpeg)"; exit 1; }
done
wrangler whoami 2>&1 | grep -q "You are logged in" || { echo "Run: npx wrangler@4 login"; exit 1; }

echo "Building schedule..."
python3 build.py

if ! wrangler r2 bucket list 2>/dev/null | grep -qw "$BUCKET"; then
  echo "Creating R2 bucket $BUCKET..."
  wrangler r2 bucket create "$BUCKET"
fi

echo "Uploading new and changed audio..."
touch "$UPLOADED"
new=0
for mp3 in audio/*.mp3; do
  key=$(basename "$mp3")
  sum=$(md5 -q "$mp3" 2>/dev/null || md5sum "$mp3" | cut -d' ' -f1)
  grep -qxF "$key $sum" "$UPLOADED" && continue
  # Same content already in R2 (R2's ETag is the MD5)? Then just record it.
  # The ?v= keeps the edge cache from answering with an older copy.
  # (a new file 404s here; that must not stop the script under set -e/pipefail)
  etag=$( (curl -sfI "$AUDIO_URL/$key?v=$sum" || true) | tr -d '\r"' | awk 'tolower($1)=="etag:"{print $2}')
  if [ "$etag" != "$sum" ]; then
    echo "  $key"
    wrangler r2 object put "$BUCKET/$key" --file "$mp3" --remote \
      --content-type audio/mpeg --cache-control "public, max-age=2592000" >/dev/null
    new=$((new + 1))
  fi
  awk -v k="$key" '$1 != k' "$UPLOADED" > "$UPLOADED.tmp"
  echo "$key $sum" >> "$UPLOADED.tmp" && mv "$UPLOADED.tmp" "$UPLOADED"
done
echo "  $new uploaded"

if ! wrangler pages project list 2>/dev/null | grep -Eq "(^|[^-[:alnum:]])$PROJECT([^-[:alnum:]]|$)"; then
  echo "Creating Pages project $PROJECT..."
  # --force keeps this a classic Pages project (newer wrangler otherwise
  # tries to turn it into a Worker)
  wrangler pages project create "$PROJECT" --production-branch main --force
fi

echo "Updating comments database..."
wrangler d1 migrations apply biscomusic-comments --remote

echo "Deploying player and comments API..."
wrangler pages deploy site --project-name "$PROJECT" --branch main --commit-dirty=true
