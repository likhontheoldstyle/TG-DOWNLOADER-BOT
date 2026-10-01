#!/bin/bash
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"
while true; do
    python3 bot/main.py
    echo "[supervisor] bot exited (code $?) — restarting in 5s..."
    sleep 5
done
