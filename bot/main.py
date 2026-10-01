import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from telegram.ext import Application, CallbackQueryHandler, CommandHandler, MessageHandler, filters

from bot import config, handlers, helpers


async def post_init(app):
    asyncio.create_task(helpers.url_store_cleaner())


def main():
    if not config.BOT_TOKEN:
        print("❌ Bot token missing.")
        sys.exit(1)
    os.makedirs(config.DL_DIR, exist_ok=True)
    app = Application.builder().token(config.BOT_TOKEN).post_init(post_init).build()
    app.add_handler(CommandHandler("start", handlers.start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, handlers.on_message))
    app.add_handler(CallbackQueryHandler(handlers.on_callback))
    print("🤖 Telegram downloader bot running...")
    print(f"📦 yt-dlp: {helpers.YTDLP}")
    print("⚙️ JS runtime: " + (" ".join(helpers.JS_RUNTIME_ARGS) if helpers.JS_RUNTIME_ARGS else "NOT FOUND"))
    print("🎬 YouTube via yt-dlp-api: " + (helpers.yt_api.API_URL if config.YT_API_ENABLED else "disabled (direct yt-dlp)"))
    print("🔐 YouTube PO Token: " + ("configured" if config.YOUTUBE_PO_TOKEN else "not configured"))
    print(f"📤 Telegram max download: {config.MAX_SIZE}")
    app.run_polling(allowed_updates=["message", "callback_query"])


if __name__ == "__main__":
    main()
