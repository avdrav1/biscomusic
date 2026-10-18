#!/bin/bash
# Render the PNG assets in static/ from their sources here, using headless Chrome.
set -euo pipefail
cd "$(dirname "$0")"
CHROME="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"
shot() { "$CHROME" --headless=new --disable-gpu --hide-scrollbars --force-device-scale-factor=1 \
  --window-size="$2" --screenshot="$3" "file://$PWD/$1" 2>/dev/null; }

shot og.html 1200,630 ../static/og.png
# Apple touch icon: the favicon SVG at 180px (iOS adds its own rounded corners)
cat > .icon.html <<EOF
<html><body style="margin:0;background:#0b0d14"><img src="../static/favicon.svg" style="width:180px;height:180px;display:block"></body></html>
EOF
shot .icon.html 180,180 ../static/apple-touch-icon.png
rm .icon.html
ls -l ../static
