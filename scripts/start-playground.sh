#!/bin/bash
# Starts the local GPT Image Playground server (only when it is not already running) and opens it
# in the default browser. Safe to double-click repeatedly: an already running instance is reused.
set -u

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3000}"
URL="http://localhost:${PORT}"
RUN_DIR="$PROJECT_DIR/.run"
PID_FILE="$RUN_DIR/dev.pid"
LOG_FILE="$RUN_DIR/dev.log"

cd "$PROJECT_DIR" || exit 1
mkdir -p "$RUN_DIR"

# Already serving? Just focus the browser tab.
if curl -sf -o /dev/null --max-time 2 "$URL"; then
    open "$URL"
    exit 0
fi

# Clean up a stale process recorded by an earlier run.
if [ -f "$PID_FILE" ]; then
    OLD_PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "${OLD_PID:-}" ] && kill -0 "$OLD_PID" 2>/dev/null; then
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

: > "$LOG_FILE"
nohup npm run dev >> "$LOG_FILE" 2>&1 &
echo $! > "$PID_FILE"

# Wait until the server actually answers before opening the browser.
for _ in $(seq 1 120); do
    if curl -sf -o /dev/null --max-time 2 "$URL"; then
        open "$URL"
        exit 0
    fi
    sleep 0.5
done

osascript -e 'display alert "GPT Image Playground" message "启动超时，请查看项目目录下的 .run/dev.log"' >/dev/null 2>&1
exit 1
