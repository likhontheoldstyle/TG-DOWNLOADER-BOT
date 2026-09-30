#!/bin/bash
# Supervisor: keeps the telegram bot alive. Restarts it if it ever exits.
cd "$(dirname "$0")"
export PATH="$HOME/.local/bin:$PATH"
while true; do
    node bot.js
    echo "[supervisor] bot exited (code $?) — restarting in 5s..."
    sleep 5
done
