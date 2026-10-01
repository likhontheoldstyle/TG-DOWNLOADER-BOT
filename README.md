# 🤖 Telegram All-in-One Downloader Bot

Paste any video link — the bot downloads it for you. No command needed.

**Supported:** 📺 YouTube • 🎵 TikTok • 📘 Facebook • 📸 Instagram • 🐦 X (Twitter) • 📌 Pinterest • 💼 LinkedIn

**Qualities:** 🎬 360p / 720p HD / 1080p Full HD • 🎵 MP3 128k / 320k • M4A

## Project structure

```
├── bot/
│   ├── main.py           # entry point (polling, handlers)
│   ├── config.py         # BOT_TOKEN + ADMIN_IDS + MAX_SIZE + YT_API_*
│   ├── handlers.py       # /start, messages, callbacks, downloads
│   ├── helpers.py        # yt-dlp runner, URL store, formatting
│   ├── platforms.py      # one matcher per platform
│   └── yt_api.py         # yt-dlp-api REST client (YouTube)
├── yt-dlp-api/           # Python FastAPI service for YouTube
├── requirements.txt      # python-telegram-bot
└── run.sh                # auto-restart supervisor
```

To add a new platform, add a matcher entry in `bot/platforms.py`.

## Setup

1. Put your bot token and admin IDs in `bot/config.py` (or `BOT_TOKEN` env var).
2. Install dependencies and tools:

```bash
pip install -r requirements.txt
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ~/.local/bin/yt-dlp
chmod +x ~/.local/bin/yt-dlp
sudo apt-get install -y ffmpeg
```

3. Run:

```bash
python3 bot/main.py
# or with auto-restart:
./run.sh
```

## Notes

- Telegram Bot API allows files up to 50MB — the bot caps downloads at 48MB (`MAX_SIZE` in `bot/config.py`).
- `ADMIN_IDS` in `bot/config.py`: Telegram user IDs of bot admins.
- YouTube downloads go through `yt-dlp-api` first (set `YT_API_KEY`), with direct yt-dlp fallback.
