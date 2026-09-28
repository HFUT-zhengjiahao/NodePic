#!/bin/bash
# Stops the local GPT Image Playground server (the same thing the "关闭服务" button in the UI does).
set -u

export PATH="/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin:$PATH"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PORT="${PORT:-3000}"
RUN_DIR="$PROJECT_DIR/.run"
PID_FILE="$RUN_DIR/dev.pid"
# Next.js 16 registers the running dev server here ({"appUrl":..., "pid":...}) — the reliable way to
# find it even when it ended up on a fallback port instead of 3000.
LOCK_FILE="$PROJECT_DIR/.next/dev/lock"

STOPPED=0

# The server Next.js itself knows about, whichever port it landed on.
if [ -f "$LOCK_FILE" ]; then
    L_PID="$(grep -oE '"pid"[[:space:]]*:[[:space:]]*[0-9]+' "$LOCK_FILE" 2>/dev/null | head -1 | grep -oE '[0-9]+')"
    if [ -n "${L_PID:-}" ] && kill -0 "$L_PID" 2>/dev/null; then
        kill "$L_PID" 2>/dev/null || true
        STOPPED=1
    fi
fi

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

# A lock whose process is gone is just debris that would block the next start.
if [ -f "$LOCK_FILE" ]; then
    L_PID="$(grep -oE '"pid"[[:space:]]*:[[:space:]]*[0-9]+' "$LOCK_FILE" 2>/dev/null | head -1 | grep -oE '[0-9]+')"
    if [ -z "${L_PID:-}" ] || ! kill -0 "$L_PID" 2>/dev/null; then
        rm -f "$LOCK_FILE"
    fi
fi

if lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1; then
    echo "端口 $PORT 仍被占用，未能完全停止。"
    exit 1
fi

if [ "$STOPPED" = "1" ]; then
    echo "已停止 GPT Image Playground（端口 $PORT 已释放）。"
else
    echo "GPT Image Playground 本来就没有在运行。"
fi
