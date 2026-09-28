#!/bin/bash
# Starts the local GPT Image Playground server (only when it is not already running) and opens it
# in the default browser. Safe to double-click repeatedly: an already running instance is reused,
# even when Next.js had to fall back to a port other than 3000.
set -u

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"
RUN_DIR="$PROJECT_DIR/.run"
PID_FILE="$RUN_DIR/dev.pid"
LOG_FILE="$RUN_DIR/dev.log"
# Next.js 16 takes an flock on this file so only one `next dev` runs per project, and stores
# {"appUrl":..., "pid":...} in it. A server that was killed (force quit, SIGKILL, crash) leaves it
# behind, and every later `next dev` then bails out with "Another next dev server is already
# running" — no port ever comes up and this script used to sit there until it timed out.
LOCK_FILE="$PROJECT_DIR/.next/dev/lock"

cd "$PROJECT_DIR" || exit 1
mkdir -p "$RUN_DIR"

alive() { kill -0 "$1" 2>/dev/null; }

# Reads a string field (e.g. appUrl) out of the JSON lockfile.
lock_field() {
    [ -f "$1" ] || return 0
    grep -oE "\"$2\"[[:space:]]*:[[:space:]]*\"[^\"]*\"" "$1" 2>/dev/null |
        head -1 | sed -E 's/.*:[[:space:]]*"([^"]*)".*/\1/'
}

# Reads the numeric "pid" field out of the JSON lockfile.
lock_pid() {
    [ -f "$1" ] || return 0
    grep -oE '"pid"[[:space:]]*:[[:space:]]*[0-9]+' "$1" 2>/dev/null |
        head -1 | grep -oE '[0-9]+'
}

# 1) A server Next.js has already registered? Use it as-is. This is what keeps the launcher working
#    when the server drifted to a fallback port (3111 and friends) because 3000 was taken.
if [ -f "$LOCK_FILE" ]; then
    L_URL="$(lock_field "$LOCK_FILE" appUrl)"
    L_PID="$(lock_pid "$LOCK_FILE")"
    if [ -n "${L_URL:-}" ] && curl -sf -o /dev/null --max-time 2 "$L_URL"; then
        open "$L_URL"
        exit 0
    fi
    # Process gone but lock left behind: clear it, otherwise `next dev` refuses to start.
    if [ -n "${L_PID:-}" ] && ! alive "$L_PID"; then
        rm -f "$LOCK_FILE"
    fi
fi

# Already serving on the expected port? Just focus the browser tab.
if curl -sf -o /dev/null --max-time 2 "$URL"; then
    open "$URL"
    exit 0
fi

# Clean up a stale process recorded by an earlier run.
if [ -f "$PID_FILE" ]; then
    OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "${OLD_PID:-}" ] && alive "$OLD_PID"; then
        kill "$OLD_PID" 2>/dev/null || true
        sleep 1
    fi
    rm -f "$PID_FILE"
fi

# Whatever still holds the port would block the new server.
LEFTOVER_PIDS="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$LEFTOVER_PIDS" ]; then
    # shellcheck disable=SC2086
    kill $LEFTOVER_PIDS 2>/dev/null || true
    sleep 1
fi

start_server() {
    : > "$LOG_FILE"
    nohup npm run dev >> "$LOG_FILE" 2>&1 &
    echo $! > "$PID_FILE"
}

# Echoes the URL that actually answers. Next.js silently moves to the next free port when 3000 is
# taken, so the "Local:" line in the log — not the hardcoded 3000 — is the truth.
serving_url() {
    local real
    real="$(grep -oE 'http://localhost:[0-9]+' "$LOG_FILE" 2>/dev/null | head -1)"
    # Trust the port Next.js reported over the hardcoded 3000: if 3000 was taken by something else,
    # that other thing would happily answer the curl and we would open the wrong page.
    if [ -n "${real:-}" ]; then
        if curl -sf -o /dev/null --max-time 2 "$real"; then
            printf '%s' "$real"
            return 0
        fi
        return 1
    fi
    if curl -sf -o /dev/null --max-time 2 "$URL"; then
        printf '%s' "$URL"
        return 0
    fi
    return 1
}

start_server

ATTEMPT=1
while [ "$ATTEMPT" -le 2 ]; do
    for _ in $(seq 1 60); do
        if SERVED="$(serving_url)"; then
            open "$SERVED"
            exit 0
        fi
        sleep 0.5
    done

    # Timed out because a stale lock made Next refuse to start: drop it and try once more.
    if [ "$ATTEMPT" -eq 1 ] && grep -q "Another next dev server is already running" "$LOG_FILE" 2>/dev/null; then
        STALE_PID="$(grep -oE 'PID:[[:space:]]*[0-9]+' "$LOG_FILE" 2>/dev/null | head -1 | grep -oE '[0-9]+')"
        if [ -n "${STALE_PID:-}" ] && ! alive "$STALE_PID"; then
            rm -f "$LOCK_FILE"
            if [ -f "$PID_FILE" ]; then
                OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
                [ -n "${OLD_PID:-}" ] && kill "$OLD_PID" 2>/dev/null
            fi
            start_server
        fi
    fi
    ATTEMPT=$((ATTEMPT + 1))
done

osascript -e 'display alert "GPT Image Playground" message "启动超时，请查看项目目录下的 .run/dev.log"' >/dev/null 2>&1
exit 1
