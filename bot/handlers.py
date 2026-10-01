import asyncio
import os
import random
import re
import time

from telegram import InlineKeyboardButton, InlineKeyboardMarkup, Update
from telegram.ext import ContextTypes

from . import config, helpers, platforms

OPTIONS = {
    "v360": {"label": "360p", "kind": "video",
             "args": ["-f", "bv*[height<=360]+ba/b[height<=360]/bv*+ba/b",
                      "--merge-output-format", "mp4"]},
    "v720": {"label": "720p HD", "kind": "video",
             "args": ["-f", "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b",
                      "--merge-output-format", "mp4"]},
    "v1080": {"label": "1080p Full HD", "kind": "video",
              "args": ["-f", "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
                       "--merge-output-format", "mp4"]},
    "mp3": {"label": "MP3 128k", "kind": "audio",
            "args": ["-x", "--audio-format", "mp3", "--audio-quality", "128K"]},
    "mp32": {"label": "MP3 320k", "kind": "audio",
             "args": ["-x", "--audio-format", "mp3", "--audio-quality", "320K"]},
    "m4a": {"label": "M4A", "kind": "audio",
            "args": ["-x", "--audio-format", "m4a"]},
}

BOT_CHECK_MSG = (
    "❌ YouTube verification/block detected.\n\n"
    "সব player client (android/ios/tv/mweb) দিয়ে চেষ্টা "
    "করা হয়েছে, কিন্তু YouTube এই IP থেকে request "
    "accept করেনি.\n\n"
    "💡 Fix: YouTube cookies add করো.\n"
    "1. PC/phone browser থেকে cookies.txt export করো\n"
    "2. GitHub repo Settings → Secrets → "
    "YOUTUBE_COOKIES_B64 নামে add করো\n"
    "3. Workflow আবার run করো"
)


def quality_keyboard(url):
    key = helpers.create_url_key(url)
    return InlineKeyboardMarkup([
        [InlineKeyboardButton("🎬 360p", callback_data=f"dl|v360|{key}"),
         InlineKeyboardButton("🎬 720p HD", callback_data=f"dl|v720|{key}")],
        [InlineKeyboardButton("🎬 1080p Full HD", callback_data=f"dl|v1080|{key}")],
        [InlineKeyboardButton("🎵 MP3 128k", callback_data=f"dl|mp3|{key}"),
         InlineKeyboardButton("🎵 MP3 320k", callback_data=f"dl|mp32|{key}"),
         InlineKeyboardButton("🎵 M4A", callback_data=f"dl|m4a|{key}")],
    ])


async def show_quality(chat_id, url, wait_msg_id, context):
    platform = platforms.detect_platform(url)
    try:
        info = await asyncio.to_thread(helpers.yt_info_smart, url)
    except Exception as e:
        message = str(e)
        friendly = BOT_CHECK_MSG if helpers.is_bot_check(e) else (
            "❌ Video info pawa jayni.\n\n" + message[:500])
        try:
            await helpers.tg(lambda: context.bot.edit_message_text(
                friendly, chat_id=chat_id, message_id=wait_msg_id))
        except Exception:
            pass
        return
    title = re.sub(r"\s+", " ", str(info.get("title") or "Video"))[:100]
    uploader = re.sub(r"\s+", " ", str(info.get("uploader") or info.get("channel") or "-"))[:40]
    caption = (f"{platform['tag']}\n🎬 {title}\n"
               f"⏱ {helpers.fmt_dur(info.get('duration'))} • 👤 {uploader}\n\n"
               "👇 Quality select koro:")
    keyboard = quality_keyboard(url)
    try:
        await helpers.tg(lambda: context.bot.delete_message(chat_id, wait_msg_id))
    except Exception:
        pass
    try:
        if info.get("thumbnail"):
            await helpers.tg(lambda: context.bot.send_photo(
                chat_id, photo=info["thumbnail"], caption=caption, reply_markup=keyboard))
        else:
            raise RuntimeError("no thumbnail")
    except Exception as e:
        print("Quality message error:", str(e)[:200])
        try:
            await helpers.tg(lambda: context.bot.send_message(
                chat_id, caption, reply_markup=keyboard))
        except Exception:
            pass


async def yt_search(chat_id, query, wait_msg_id, context):
    try:
        out = await asyncio.to_thread(
            helpers.ytdlp,
            helpers.JS_RUNTIME_ARGS + helpers.EJS_ARGS + [
                "--no-warnings", "--dump-json", "--flat-playlist",
                "--no-download", f"ytsearch5:{query}"],
            120)
    except Exception as e:
        print("Search error:", str(e)[:200])
        try:
            await helpers.tg(lambda: context.bot.edit_message_text(
                "❌ Search failed.\n\n" + str(e)[:300],
                chat_id=chat_id, message_id=wait_msg_id))
        except Exception:
            pass
        return
    import json
    items = []
    for line in out.strip().split("\n"):
        try:
            v = json.loads(line)
        except Exception:
            continue
        if v and v.get("id"):
            items.append(v)
    items = items[:5]
    if not items:
        try:
            await helpers.tg(lambda: context.bot.edit_message_text(
                "❌ Kichu pawa jayni.\nOnno nam likho.",
                chat_id=chat_id, message_id=wait_msg_id))
        except Exception:
            pass
        return
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton(
            "🎬 " + re.sub(r"\s+", " ", str(v.get("title") or "Video"))[:45],
            callback_data=f"sr|{v['id']}")]
        for v in items
    ])
    try:
        await helpers.tg(lambda: context.bot.edit_message_text(
            f"🔍 \"{query[:50]}\"\n\n👇 Video select koro:",
            chat_id=chat_id, message_id=wait_msg_id, reply_markup=keyboard))
    except Exception as e:
        print("Search keyboard error:", str(e)[:200])


async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    try:
        await helpers.tg(lambda: context.bot.send_message(
            update.effective_chat.id,
            "👋 All-in-One Downloader\n\n"
            "🔍 Jekono gan ba video r nam likho — "
            "ami YouTube e search kore dibo.\n"
            "🔗 Ba sorasori link pathao.\n\n"
            "📺 YouTube • 🎵 TikTok • "
            "📘 Facebook • 📸 Instagram • "
            "🐦 X • 📌 Pinterest • 💼 LinkedIn\n\n"
            "Full HD video ba MP3/M4A audio — "
            "option tomake dibo."))
    except Exception:
        pass


async def on_message(update: Update, context: ContextTypes.DEFAULT_TYPE):
    msg = update.message
    if not msg or not msg.text:
        return
    text = msg.text.strip()
    if not text:
        return
    chat_id = msg.chat.id
    try:
        wait_msg = await helpers.tg(
            lambda: context.bot.send_message(chat_id, "🔎 Khujchi..."))
    except Exception as e:
        print("Send waiting message error:", str(e)[:200])
        return
    links = re.findall(r"https?://[^\s<>\"']+", text, re.I)
    if links:
        url = re.sub(r"[),.!?]+$", "", links[0])
        await show_quality(chat_id, url, wait_msg.message_id, context)
    else:
        await yt_search(chat_id, text, wait_msg.message_id, context)


async def on_callback(update: Update, context: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    try:
        if not q or not q.message:
            try:
                await q.answer()
            except Exception:
                pass
            return
        chat_id = q.message.chat.id
        data = str(q.data or "")
        parts = data.split("|")
        action = parts[0] if parts else ""
        arg = parts[1] if len(parts) > 1 else ""

        if action == "sr" and arg:
            try:
                await helpers.tg(lambda: q.answer())
            except Exception:
                pass
            try:
                wait_msg = await helpers.tg(
                    lambda: context.bot.send_message(chat_id, "🔎 Video info anche..."))
            except Exception:
                return
            try:
                await helpers.tg(lambda: context.bot.delete_message(
                    chat_id, q.message.message_id))
            except Exception:
                pass
            await show_quality(chat_id, f"https://www.youtube.com/watch?v={arg}",
                               wait_msg.message_id, context)
            return

        if action != "dl" or arg not in OPTIONS:
            try:
                await helpers.tg(lambda: q.answer())
            except Exception:
                pass
            return

        key = "|".join(parts[2:])
        url = helpers.get_stored_url(key)
        if not url:
            try:
                await helpers.tg(lambda: q.answer(
                    "❌ Link expired. আবার link পাঠাও।", show_alert=True))
            except Exception:
                pass
            return

        opt = OPTIONS[arg]
        platform = platforms.detect_platform(url)
        try:
            await helpers.tg(lambda: q.answer(f"⏳ {opt['label']} download hocche..."))
        except Exception:
            pass
        try:
            await helpers.tg(lambda: q.edit_message_reply_markup(reply_markup=None))
        except Exception:
            pass
        try:
            status_msg = await helpers.tg(lambda: context.bot.send_message(
                chat_id, f"⏳ {opt['label']} download hocche...\nEta ektu somoy nite pare."))
        except Exception as e:
            print("Status message error:", str(e)[:200])
            return

        stamp = f"{int(time.time() * 1000)}_{random.randint(0, 999999)}"
        out_template = os.path.join(config.DL_DIR, f"tg_{stamp}.%(ext)s")
        file_path = None
        try:
            await asyncio.to_thread(helpers.yt_download_smart, url, opt["args"], out_template)
            files = [f for f in os.listdir(config.DL_DIR) if f.startswith(f"tg_{stamp}.")]
            if not files:
                raise RuntimeError("Download complete but file toiri hoyni.")
            preferred = next((f for f in files if re.search(
                r"\.(mp4|mkv|webm|mp3|m4a|aac|opus)$", f, re.I)), None)
            found = preferred or files[0]
            file_path = os.path.join(config.DL_DIR, found)
            if not os.path.exists(file_path):
                raise RuntimeError("Downloaded file not found.")
            size = os.path.getsize(file_path)
            size_mb = size / 1024 / 1024
            print(f"Downloaded: {found} ({size_mb:.2f} MB)")
            if size_mb > 49:
                raise RuntimeError(f"FILE_TOO_LARGE:{size_mb:.1f}MB")
            try:
                await helpers.tg(lambda: context.bot.delete_message(
                    chat_id, status_msg.message_id))
            except Exception:
                pass
            caption = f"{platform['tag']} {opt['label']} • 💾 {helpers.format_bytes(size)}"
            if opt["kind"] == "video":
                with open(file_path, "rb") as f:
                    await helpers.tg(lambda: context.bot.send_video(
                        chat_id, video=f, caption=caption), 2)
            else:
                with open(file_path, "rb") as f:
                    await helpers.tg(lambda: context.bot.send_audio(
                        chat_id, audio=f, caption=caption), 2)
            print(f"✅ Sent {found} to {chat_id}")
        except Exception as e:
            error_text = str(e)
            print("DOWNLOAD ERROR:", error_text[:500])
            if error_text.startswith("FILE_TOO_LARGE:"):
                size = error_text.split(":")[1]
                friendly = (f"❌ File {size} — Telegram Bot API-এর 50 MB limit-এর "
                            "বেশি।\n\nছোট quality select করো।")
            elif re.search(r"max-filesize|larger than", error_text, re.I):
                friendly = (f"❌ File {config.MAX_SIZE} এর বেশি।\nআরও ছোট quality try koro.")
            elif helpers.is_bot_check(e):
                friendly = ("❌ YouTube verification/block detected.\n\n"
                            "yt-dlp-এর latest EJS/runtime দিয়ে retry করা হয়েছে, "
                            "কিন্তু YouTube request accept করেনি.\n\n"
                            "যদি server-এ yt-dlp পুরোনো হয়, update করো.")
            elif re.search(r"ffmpeg|ffprobe|merging|postprocess", error_text, re.I):
                friendly = ("❌ FFmpeg problem.\n\nVideo/audio merge করার জন্য "
                            "server-এ FFmpeg install থাকতে হবে।")
            else:
                friendly = "❌ Download failed:\n" + error_text[:500]
            try:
                await helpers.tg(lambda: context.bot.edit_message_text(
                    friendly, chat_id=chat_id, message_id=status_msg.message_id))
            except Exception:
                pass
        finally:
            for f in os.listdir(config.DL_DIR):
                if f.startswith(f"tg_{stamp}."):
                    try:
                        os.unlink(os.path.join(config.DL_DIR, f))
                    except Exception:
                        pass
    except Exception as e:
        print("Callback handler error:", str(e)[:500])
        try:
            await q.answer("❌ Something went wrong.", show_alert=True)
        except Exception:
            pass
