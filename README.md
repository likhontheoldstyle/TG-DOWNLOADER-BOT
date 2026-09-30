# 🤖 Telegram All-in-One Downloader Bot

Paste any video link — the bot downloads it for you. No command needed.

**Supported:** 📺 YouTube • 🎵 TikTok • 📘 Facebook • 📸 Instagram • 🐦 X (Twitter)

**Qualities:** 🎬 360p / 720p HD / 1080p Full HD • 🎵 MP3 128k / 320k • M4A

## Project structure

```
├── main/
│   └── index.js          # main bot (link detect, buttons, download, upload)
├── config.js           # BOT_TOKEN + ADMIN_IDS + MAX_SIZE
├── social/             # one file per platform
│   ├── youtube.js
│   ├── facebook.js
│   ├── instagram.js
│   ├── tiktok.js
│   ├── twitter.js
│   ├── pinterest.js
│   └── linkedin.js
├── package.json
└── run.sh              # auto-restart supervisor
```

To add a new platform, drop a new file in `social/` exporting
`{ id, tag, match(url), extractorArgs }` — `bot.js` picks it up automatically.

## Setup

1. Put your bot token and admin IDs in `config.js`.
2. Install dependencies and tools:

```bash
npm install
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ~/.local/bin/yt-dlp
chmod +x ~/.local/bin/yt-dlp
sudo apt-get install -y ffmpeg
```

3. Run:

```bash
node main/index.js
# or with auto-restart:
./run.sh
```

## Notes

- Telegram Bot API allows files up to 50MB — the bot caps downloads at 48MB (`MAX_SIZE` in `config.js`).
- `ADMIN_IDS` in `config.js`: Telegram user IDs of bot admins.
