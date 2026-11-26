#!/bin/bash
# Copies the site in docs/ into the pantsonmyhead.com repository (../recipe-app/docs/taper), commits and pushes it.
# Taper lives at https://pantsonmyhead.com/taper/; this repository stays the source.
#     bash tools/publish.sh
set -euo pipefail
here="$(cd "$(dirname "$0")/.." && pwd)"
site="$(cd "$here/../recipe-app" && pwd)"
rev="$(git -C "$here" rev-parse --short HEAD)"
rsync -a --delete "$here/docs/" "$site/docs/taper/"
git -C "$site" add docs/taper
if git -C "$site" diff --cached --quiet; then
  echo "pantsonmyhead.com/taper is already at $rev"
  exit 0
fi
git -C "$site" commit -q -m "Taper at $rev"
git -C "$site" -c credential.helper= -c credential.helper='!gh auth git-credential' push -q origin HEAD
echo "pushed Taper $rev to pantsonmyhead.com/taper"
