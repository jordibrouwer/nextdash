#!/bin/sh
set -e

# Unraid Tailscale hooks and some volume mounts expect the container user to be
# root at start; drop to nextdash for the app unless explicitly disabled.
if [ "$(id -u)" = "0" ]; then
    if [ -d /app/data ]; then
        chown -R nextdash:nextdash /app/data 2>/dev/null || true
    fi
    # A data folder moved with NEXTDASH_DATA_DIR, and the folder automatic
    # backups go to, are mounts too: left to root, the start-up write check
    # failed and the container restarted in a loop, or every backup failed.
    data_dir="${NEXTDASH_DATA_DIR:-}"
    if [ -n "$data_dir" ] && [ "$data_dir" != "/app/data" ] && [ "$data_dir" != "/" ] && [ -d "$data_dir" ]; then
        chown -R nextdash:nextdash "$data_dir" 2>/dev/null || true
    fi
    backup_dir="${NEXTDASH_AUTO_BACKUP_DIR:-}"
    if [ -n "$backup_dir" ] && [ -d "$backup_dir" ]; then
        chown nextdash:nextdash "$backup_dir" 2>/dev/null || true
    fi
    if [ "${NEXTDASH_RUN_AS_ROOT:-0}" = "1" ]; then
        exec /app/main "$@"
    fi
    # The Docker socket belongs to the host's docker group (281 on Unraid).
    # Join that gid so the unprivileged user can read it; su-exec with a user
    # only (no :group) keeps the supplementary groups from /etc/group.
    sock="${NEXTDASH_DOCKER_SOCKET:-}"
    if [ -n "$sock" ] && [ -S "$sock" ]; then
        gid="$(stat -c %g "$sock")"
        if [ "$gid" = "0" ]; then
            echo "nextdash: $sock is owned by gid 0; set NEXTDASH_RUN_AS_ROOT=1 to use it" >&2
        else
            group="$(getent group "$gid" | cut -d: -f1)"
            if [ -z "$group" ]; then
                group="dockersock"
                addgroup -S -g "$gid" "$group" 2>/dev/null || true
            fi
            addgroup nextdash "$group" 2>/dev/null || true
        fi
    fi
    exec su-exec nextdash /app/main "$@"
fi

exec /app/main "$@"
