#!/bin/sh
# Uploads the built docs to the web server, next to WordPress.
#
#   DOCS_DEPLOY_TARGET=user@host:/var/www/nextdash.cc/docs/ npm run deploy
#
# Run `npm run build` first. rsync --delete removes files on the server that
# the build no longer has, so the target must be the docs folder itself: the
# script refuses any target that does not end in /docs/.
set -eu

cd "$(dirname "$0")/.."
DIST=.vitepress/dist

target="${DOCS_DEPLOY_TARGET:-}"
if [ -z "$target" ]; then
  echo "Set DOCS_DEPLOY_TARGET, for example user@host:/var/www/nextdash.cc/docs/" >&2
  exit 1
fi
case "$target" in
  */docs/) ;;
  *) echo "DOCS_DEPLOY_TARGET must end in /docs/ (got: $target)" >&2; exit 1 ;;
esac
if [ ! -f "$DIST/index.html" ] || [ ! -d "$DIST/pagefind" ]; then
  echo "No complete build in $DIST. Run npm run build first." >&2
  exit 1
fi

ref=$(node -e "console.log(require('./src/_meta.json').ref)")
echo "Deploying the manual of $ref to $target"
# -rlpt rather than -a: owner and group are not copied, so the files belong to
# the remote user instead of the Mac's uid. Works with macOS's openrsync too.
# The build's scripts go first and without --delete: a page still open in a
# browser asks for the previous build's scripts, which must stay there.
rsync -rlptz "$DIST/assets/" "${target}assets/"
rsync -rlptz --delete --exclude /assets/ --stats "$DIST/" "$target"
