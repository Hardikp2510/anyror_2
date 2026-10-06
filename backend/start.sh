#!/bin/sh
set -e

# Clean any stale X11 lock files from prior container runs
rm -f /tmp/.X*-lock /tmp/.X11-unix/X* 2>/dev/null || true

# Start Xvfb virtual display for headed Chrome automation
if which Xvfb >/dev/null 2>&1; then
    echo "Starting fresh Xvfb on DISPLAY=:99..."
    Xvfb :99 -screen 0 1920x1080x24 -ac +extension GLX +render -noreset &
    export DISPLAY=:99
    sleep 1
fi

echo "Starting Uvicorn..."
exec uvicorn main:app --host 0.0.0.0 --port 8000
