#!/bin/bash
# Stops the local GPT Image Playground server (the same thing the "关闭服务" button in the UI does).
set -u

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3000}"
RUN_DIR="$PROJECT_DIR/.run"
PID_FILE="$RUN_DIR/dev.pid"

STOPPED=0

if [ -f "$PID_FILE" ]; then
    PID="$(cat "$PID_FILE" 2>/dev/null || true)"
    if [ -n "${PID:-}" ] && kill -0 "$PID" 2>/dev/null; then
        kill "$PID" 2>/dev/null || true
        STOPPED=1
    fi
    rm -f "$PID_FILE"
fi

# Catch a server that was started manually (npm run dev in a terminal, or a leftover process).
LEFTOVER_PIDS="$(lsof -nP -tiTCP:"$PORT" -sTCP:LISTEN 2>/dev/null || true)"
if [ -n "$LEFTOVER_PIDS" ]; then
    # shellcheck disable=SC2086
    kill $LEFTOVER_PIDS 2>/dev/null || true
    STOPPED=1
fi

sleep 1

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "端口 $PORT 仍被占用，未能完全停止。"
    exit 1
fi

if [ "$STOPPED" = "1" ]; then
    echo "已停止 GPT Image Playground（端口 $PORT 已释放）。"
else
    echo "GPT Image Playground 本来就没有在运行。"
fi
