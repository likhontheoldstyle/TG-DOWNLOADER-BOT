# 🤖 Telegram All-in-One Downloader Bot

Paste any video link — the bot downloads it for you. No command needed.

**Supported:** 📺 YouTube • 🎵 TikTok • 📘 Facebook • 📸 Instagram • 🐦 X (Twitter)

**Qualities:** 🎬 360p / 720p HD / 1080p Full HD • 🎵 MP3 128k / 320k • M4A

## Setup

1. Create a bot with [@BotFather](https://t.me/BotFather) and copy the token.
2. Put the token in **one** of these (priority order):
   - `BOT_TOKEN` environment variable, or
   - `.env` file: `BOT_TOKEN=...`, or
   - `config.py`: `BOT_TOKEN = "..."` (copy from `config.py.example` — never commit the real one)
3. Install dependencies and tools:

```bash
npm install
# yt-dlp
curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o ~/.local/bin/yt-dlp
chmod +x ~/.local/bin/yt-dlp
# ffmpeg (Debian/Ubuntu)
sudo apt-get install -y ffmpeg
```

4. Run:

```bash
node bot.js
# or with auto-restart:
./run.sh
```

## GitHub Actions (temporary run)

> Actions jobs stop after ~6 hours. For 24/7 use Render/Railway/VPS.

1. Push this repo to GitHub.
2. Repo **Settings → Secrets and variables → Actions → New repository secret**: name `BOT_TOKEN`, value = your bot token.
3. **Actions tab → "Telegram Downloader Bot" → Run workflow**.

## Notes

- Telegram Bot API allows files up to 50MB — the bot caps downloads at 48MB.
- `config.py` with a real token must stay local (it is gitignored).
