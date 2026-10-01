#!/bin/bash
cd "$(dirname "$0")"
if [ ! -d "venv" ]; then
    python3 -m venv venv
    ./venv/bin/pip install -q -r requirements.txt
    ./venv/bin/pip install -q yt-dlp
fi
mkdir -p downloads cookies
export APP_SECURITY_API_KEYS="${YT_API_KEYS:-[\"changeme\"]}"
export APP_SECURITY_ALLOW_DEGRADED_START=true
if [ -n "$YOUTUBE_COOKIES_B64" ]; then
    echo "$YOUTUBE_COOKIES_B64" | base64 -d > cookies/youtube.txt
fi
export APP_YOUTUBE_COOKIE_PATH="$(pwd)/cookies/youtube.txt"
exec ./venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
