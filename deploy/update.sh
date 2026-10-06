#!/bin/sh
# Called by cron on the server. Pulls the image CI pushed for main and lets
# compose recreate the container when the image or compose.yaml changed.
# No inbound access, no secrets.
set -eu
# cron runs with a minimal PATH; docker and flock must still be found.
PATH=/usr/local/bin:/usr/bin:/bin:/snap/bin
cd "$(dirname "$0")"

# Runs start every few minutes; a slow pull must not overlap the next run.
exec 9>.update.lock
flock --nonblock 9 || exit 0

# compose prints status lines even with --quiet; show them only on failure,
# so update.log records deploys and errors, not every run.
quiet() {
  if ! out=$("$@" 2>&1); then
    echo "$out"
    exit 1
  fi
}

quiet docker compose pull --quiet
before=$(docker compose ps --quiet game)
# compose recreates the container only when its image or config changed. This
# also applies a rollback to a tag that is already on the host.
quiet docker compose up --detach --remove-orphans
after=$(docker compose ps --quiet game)
[ "$before" = "$after" ] && exit 0

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) deployed $(docker compose config --images) container ${after}"
# Removes dangling images only: the previous :main once a new one is pulled.
docker image prune --force >/dev/null
