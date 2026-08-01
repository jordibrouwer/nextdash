#!/bin/sh
set -e

# Unraid Tailscale hooks and some volume mounts expect the container user to be
# root at start; drop to nextdash for the app unless explicitly disabled.
if [ "$(id -u)" = "0" ]; then
    if [ -d /app/data ]; then
        chown -R nextdash:nextdash /app/data 2>/dev/null || true
    fi
    if [ "${NEXTDASH_RUN_AS_ROOT:-0}" = "1" ]; then
        exec /app/main "$@"
    fi
    exec su-exec nextdash:nextdash /app/main "$@"
fi

exec /app/main "$@"
