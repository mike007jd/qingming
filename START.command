#!/bin/zsh
set -e
cd "${0:A:h}"
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null; then
  print 'Install Node.js 22.15 or newer, then double-click this file.'
  read '?Press Return to close'
  exit 1
fi
url="http://127.0.0.1:${PORT:-4193}/"
if curl -fsS "$url" 2>/dev/null | grep -q 'Qingming Riverside'; then
  [[ "${QINGMING_NO_OPEN:-0}" == 1 ]] || open "$url"
  print "Already running: $url"
  exit 0
fi
if [[ "${QINGMING_NO_OPEN:-0}" != 1 ]]; then
  (sleep 1; open "$url") &
fi
exec node server.mjs
