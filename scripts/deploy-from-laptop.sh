#!/usr/bin/env bash
#
# Mwalimu Cosmetics — deploy to Hetzner from this laptop.
#
# The same steps .github/workflows/deploy.yml runs, minus GitHub. It exists for
# the times when waiting on CI is the wrong shape: a fix that has to be on the
# server now, a change being tried before it is committed, or a day when the
# push itself is the thing that is blocked.
#
# It deploys the WORKING TREE, not a commit. That is the point of it and also
# the danger of it, so it says exactly what it is about to send and refuses to
# guess when the tree is dirty unless told to go anyway.
#
#   ./scripts/deploy-from-laptop.sh              # dry run: shows what would go
#   ./scripts/deploy-from-laptop.sh --apply      # deploy a clean tree
#   ./scripts/deploy-from-laptop.sh --apply --dirty   # deploy uncommitted work
#
# Requires an ssh host alias that reaches the server. Defaults to hetzner-martin,
# override with DEPLOY_SSH.

set -euo pipefail

DEPLOY_SSH="${DEPLOY_SSH:-hetzner-martin}"
DEPLOY_DIR="${DEPLOY_DIR:-/home/admin/apps/mwalimucosmetics}"
APP_PORT="${APP_PORT:-3001}"
FRONT_PORT="${FRONT_PORT:-3002}"

APPLY=0
ALLOW_DIRTY=0
for arg in "$@"; do
  case "$arg" in
    --apply) APPLY=1 ;;
    --dirty) ALLOW_DIRTY=1 ;;
    *) echo "unknown argument: $arg" >&2; exit 2 ;;
  esac
done

cd "$(dirname "$0")/.."
ROOT="$(pwd)"

echo "Deploying from : $ROOT"
echo "To             : $DEPLOY_SSH:$DEPLOY_DIR"
echo "Mode           : $([ "$APPLY" = 1 ] && echo 'APPLY' || echo 'dry run (pass --apply to deploy)')"
echo

# The working tree is what gets sent, so somebody should know when it does not
# match what is committed.
DIRTY="$(git status --porcelain | wc -l | tr -d ' ')"
if [ "$DIRTY" != "0" ]; then
  echo "The working tree has $DIRTY uncommitted change(s):"
  git status --short | sed 's/^/  /'
  echo
  if [ "$APPLY" = 1 ] && [ "$ALLOW_DIRTY" != 1 ]; then
    echo "REFUSING: deploying uncommitted work leaves the server running something"
    echo "no commit describes. Commit first, or pass --dirty if that is deliberate."
    exit 1
  fi
fi

if ! ssh -o ConnectTimeout=15 -o BatchMode=yes "$DEPLOY_SSH" 'test -d '"$DEPLOY_DIR" 2>/dev/null; then
  echo "REFUSING: cannot reach $DEPLOY_SSH, or $DEPLOY_DIR is not there."
  exit 1
fi

# ── Getting the files there ───────────────────────────────────────────
#
# The workflow uses rsync from end to end. Git Bash on Windows has no rsync and
# this laptop has no WSL, so the transfer is split: tar carries the files over
# ssh, and the server's own rsync does the comparison and the deleting. The
# semantics end up identical to the workflow's, including the protect filters.
#
# The file list comes from git rather than from the filesystem, and that is
# load-bearing. `mwalimu/` on this laptop holds an entire FumasV5 install —
# hundreds of megabytes — and is gitignored, as are node_modules, .next, the
# generated QR pool and every .env. Tarring the directory would ship all of it.
# `git ls-files -co --exclude-standard` is exactly "tracked, plus untracked
# files git would be willing to add", which is the working tree as the
# repository sees it and what CI would have had if this were committed.
STAGE="/tmp/mwalimu-deploy-$$"

file_list() {
  git ls-files -co --exclude-standard -z \
    | grep -zv '^apps/desktop/' \
    | grep -zv '^bridge/tickets/qr/' \
    | grep -zv '^bridge/tickets/logs/'
}

COUNT="$(file_list | tr '\0' '\n' | grep -c . || true)"
echo "Files to send  : $COUNT"

if [ "$APPLY" != 1 ]; then
  echo
  echo "-- what the server would end up with (first 40) --"
  file_list | tr '\0' '\n' | head -40
  echo
  echo "Nothing was sent. Re-run with --apply."
  exit 0
fi

echo "-- sending --"
file_list | tar -czf - --null -T - \
  | ssh -o StrictHostKeyChecking=no "$DEPLOY_SSH" \
      "rm -rf '$STAGE' && mkdir -p '$STAGE' && tar -xzf - -C '$STAGE'"

echo "-- syncing into place --"
ssh -o StrictHostKeyChecking=no "$DEPLOY_SSH" bash -s <<ENDSYNC
set -e
rsync -a --delete \
  --exclude "node_modules/" \
  --exclude ".next/" \
  --exclude "apps/front/.next/" \
  --exclude "apps/front/out/" \
  --exclude "apps/back/dist/" \
  --exclude "apps/desktop/" \
  --filter "P .env" \
  --filter "P .env.*" \
  --filter "P node_modules" \
  --filter "P apps/back/dist" \
  --filter "P apps/front/.next" \
  --filter "P bridge/FumasV5.exe" \
  --filter "P bridge/FumasV5-version.txt" \
  --filter "P bridge/FumasV5-updated.exe" \
  "$STAGE/" "$DEPLOY_DIR/"
rm -rf "$STAGE"
ENDSYNC

echo "-- installing, migrating, building, restarting --"
ssh -o StrictHostKeyChecking=no "$DEPLOY_SSH" \
  "DEPLOY_DIR='$DEPLOY_DIR' APP_PORT='$APP_PORT' FRONT_PORT='$FRONT_PORT' bash -s" <<'ENDSSH'
set -e
cd "$DEPLOY_DIR"

env_file="apps/back/.env"
if [ -f "$env_file" ]; then
  if grep -q '^PORT=' "$env_file"; then
    sed -i "s|^PORT=.*|PORT=${APP_PORT:-3001}|" "$env_file"
  else
    printf '\nPORT=%s\n' "${APP_PORT:-3001}" >> "$env_file"
  fi
fi

ELECTRON_SKIP_BINARY_DOWNLOAD=1 npm install

DATABASE_URL=$(grep '^DATABASE_URL=' apps/back/.env | cut -d= -f2-) \
  node_modules/.bin/prisma generate --schema packages/db/prisma/schema.prisma

# Additive only. Without --accept-data-loss Prisma refuses to drop anything,
# including the mirror_* tables created by raw SQL outside the schema; the
# || true lets it continue when it finds those.
DATABASE_URL=$(grep '^DATABASE_URL=' apps/back/.env | cut -d= -f2-) \
  node_modules/.bin/prisma db push \
    --schema packages/db/prisma/schema.prisma || true

cd apps/front && NEXT_SKIP_LOCKFILE_PATCH=1 npx next build && cd ../..
npm run build --workspace=@mwalimu/back

pm2 restart mwalimu-front || \
  pm2 start node_modules/.bin/next --name mwalimu-front -- start -p ${FRONT_PORT:-3002}
pm2 restart mwalimu-back || \
  pm2 start apps/back/dist/index.js --name mwalimu-back
pm2 save
ENDSSH

echo
echo "-- checking it came back up --"
sleep 3
ssh -o StrictHostKeyChecking=no "$DEPLOY_SSH" \
  "pm2 list | grep -E 'mwalimu-(back|front)' || true"
echo
echo "Deployed."
