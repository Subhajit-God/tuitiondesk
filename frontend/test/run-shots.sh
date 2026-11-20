#!/bin/sh
# Starts the dev API + static server and captures docs/screenshots/*.png (demo data, TuitionDesk's own screens only).
cd "$(dirname "$0")/.." || exit 2
D=${TMPDIR:-/tmp}/td-shots; mkdir -p $D ../docs/screenshots
OUT=$D/dist node build.mjs >/dev/null || exit 2
printf '{"apiUrl":"http://localhost:8787","publicUrl":""}' > $D/dist/config.json
node ../backend/dev-server.js 8787 >$D/api.log 2>&1 & A=$!
OUT=$D/dist node serve.mjs 5173 >$D/web.log 2>&1 & W=$!
sleep 2
node test/screenshots.cjs ../docs/screenshots; rc=$?
kill $A $W 2>/dev/null
exit $rc
