#!/bin/bash
# Render the PNG assets in static/ from their sources here, using headless Chrome.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
shot() { "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size="$2,$2" --screenshot="$3" "file://$PWD/$1" 2>/dev/null; }

# The favicon SVG at a given size; `scale` < 1 pads it for maskable icons (Android crops to a circle/squircle).
icon() {
  local size=$1 scale=$2 out=$3
  cat > .icon.html <<EOF
<html><body style="margin:0;background:#030604;display:grid;place-items:center;width:${size}px;height:${size}px">
<img src="../static/favicon.svg" style="width:calc(${size}px * ${scale});height:calc(${size}px * ${scale})"></body></html>
EOF
  shot .icon.html "$size" "$out"
}

"$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size=1200,630 --screenshot=../static/og.png "file://$PWD/og.html" 2>/dev/null
icon 180 1   ../static/apple-touch-icon.png   # iOS adds its own rounded corners
icon 192 1   ../static/icon-192.png
icon 512 1   ../static/icon-512.png
icon 512 0.7 ../static/icon-maskable-512.png  # logo inside the 80% safe zone
rm .icon.html
ls -l ../static
