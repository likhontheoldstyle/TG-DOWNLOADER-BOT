// Telegram All-in-One Social Media Downloader Bot
// Needs: BOT_TOKEN env var, yt-dlp + ffmpeg installed
const TelegramBot = require("node-telegram-bot-api");
const { execFile } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

// load .env (BOT_TOKEN) if present
try {
    const envPath = path.join(__dirname, ".env");
    if (fs.existsSync(envPath)) {
        for (const line of fs.readFileSync(envPath, "utf8").split("\n")) {
            const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
            if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
        }
    }
} catch (_) {}

// load config.py (BOT_TOKEN = "...") if present and env not already set
try {
    const cfgPath = path.join(__dirname, "config.py");
    if (!process.env.BOT_TOKEN && fs.existsSync(cfgPath)) {
        const m = fs.readFileSync(cfgPath, "utf8").match(/^\s*BOT_TOKEN\s*=\s*["'](.+?)["']/m);
        if (m) process.env.BOT_TOKEN = m[1].trim();
    }
} catch (_) {}

const TOKEN = process.env.BOT_TOKEN;
if (!TOKEN) {
    console.error("Set BOT_TOKEN env var (or .env / config.py) first.");
    process.exit(1);
}

// find yt-dlp (PATH or ~/.local/bin)
let YTDLP = "yt-dlp";
{
    const { execFileSync } = require("child_process");
    try { execFileSync("yt-dlp", ["--version"], { stdio: "ignore" }); }
    catch (_) {
        const alt = path.join(os.homedir(), ".local", "bin", "yt-dlp");
        if (fs.existsSync(alt)) YTDLP = alt;
    }
}

const bot = new TelegramBot(TOKEN, { polling: { params: { timeout: 10 }, interval: 1000 } });
const DL_DIR = path.join(__dirname, "downloads");
if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR, { recursive: true });

// retry wrapper for flaky network — Telegram calls get 3 attempts
async function tg(fn, retries = 3) {
    let last;
    for (let i = 0; i < retries; i++) {
        try { return await fn(); }
        catch (e) { last = e; await new Promise(r => setTimeout(r, 1500)); }
    }
    throw last;
}

const BASE = ["--extractor-args", "youtube:player_client=android", "--no-warnings", "--no-playlist"];
// Telegram Bot API file limit = 50MB -> stay under it
const MAX_SIZE = "48M";

const OPTIONS = {
    v360:  { label: "🎬 360p",          args: ["-f", "bv*[height<=360]+ba/b[height<=360]/b", "--merge-output-format", "mp4"], kind: "video" },
    v720:  { label: "🎬 720p HD",       args: ["-f", "bv*[height<=720]+ba/b[height<=720]/b", "--merge-output-format", "mp4"], kind: "video" },
    v1080: { label: "🎬 1080p Full HD", args: ["-f", "bv*[height<=1080]+ba/b[height<=1080]/b", "--merge-output-format", "mp4"], kind: "video" },
    mp3:   { label: "🎵 MP3 128k",      args: ["-x", "--audio-format", "mp3", "--audio-quality", "128K"], kind: "audio" },
    mp32:  { label: "🎵 MP3 320k",      args: ["-x", "--audio-format", "mp3", "--audio-quality", "0"], kind: "audio" },
    m4a:   { label: "🎵 M4A Best",      args: ["-f", "ba/b", "-x", "--audio-format", "m4a", "--audio-quality", "0"], kind: "audio" },
};

function ytdlp(args, timeoutMs = 600000) {
    return new Promise((resolve, reject) => {
        execFile(YTDLP, args, { timeout: timeoutMs, maxBuffer: 30 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) return reject(new Error((stderr || err.message).split("\n").filter(Boolean).slice(-2).join(" | ").slice(0, 250)));
            resolve(stdout);
        });
    });
}

function fmtDur(sec) {
    if (!sec) return "?:??";
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}` : `${m}:${String(s).padStart(2, "0")}`;
}

function platformTag(url) {
    const u = url.toLowerCase();
    if (/youtube\.com|youtu\.be/.test(u)) return "📺 YouTube";
    if (/tiktok\.com/.test(u)) return "🎵 TikTok";
    if (/facebook\.com|fb\.watch/.test(u)) return "📘 Facebook";
    if (/instagram\.com/.test(u)) return "📸 Instagram";
    if (/twitter\.com|x\.com/.test(u)) return "🐦 X (Twitter)";
    return "🔗 Video";
}

bot.onText(/\/start/, (msg) => {
    bot.sendMessage(msg.chat.id,
        "👋 All-in-One Downloader\n\n" +
        "Jekono video link pathao — ami download kore dibo.\n" +
        "📺 YouTube • 🎵 TikTok • 📘 Facebook • 📸 Instagram • 🐦 X\n\n" +
        "Full HD video ba MP3/M4A audio — option tomake dibo.");
});

bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;
    const links = msg.text.match(/(https?:\/\/[^\s]+)/g);
    if (!links) return;

    const url = links[0];
    const chatId = msg.chat.id;

    let waitMsg;
    try {
        waitMsg = await tg(() => bot.sendMessage(chatId, "🔎 Video info anche..."));
    } catch (e) { console.error("send wait failed:", e.message); return; }

    let info;
    try {
        const out = await ytdlp([...BASE, "--dump-json", "--no-download", url], 90000);
        info = JSON.parse(out);
    } catch (e) {
        try {
            await tg(() => bot.editMessageText(`❌ Video info pawa jayni.\n${String(e.message).slice(0, 150)}`, { chat_id: chatId, message_id: waitMsg.message_id }));
        } catch (_) {}
        return;
    }

    const title = (info.title || "Video").slice(0, 100);
    const keyboard = [
        [{ text: "🎬 360p", callback_data: `dl|v360|${url}` },
         { text: "🎬 720p HD", callback_data: `dl|v720|${url}` }],
        [{ text: "🎬 1080p Full HD", callback_data: `dl|v1080|${url}` }],
        [{ text: "🎵 MP3 128k", callback_data: `dl|mp3|${url}` },
         { text: "🎵 MP3 320k", callback_data: `dl|mp32|${url}` },
         { text: "🎵 M4A", callback_data: `dl|m4a|${url}` }],
    ];

    try {
        await tg(() => bot.editMessageText(
            `${platformTag(url)}\n🎬 ${title}\n⏱ ${fmtDur(info.duration)} • 👤 ${(info.uploader || "YouTube").slice(0, 40)}\n\n👇 Quality select koro:`,
            { chat_id: chatId, message_id: waitMsg.message_id, reply_markup: { inline_keyboard: keyboard } }
        ));
    } catch (e) { console.error("send menu failed:", e.message); }
});

bot.on("callback_query", async (q) => {
    const [action, optKey, ...urlParts] = q.data.split("|");
    if (action !== "dl" || !OPTIONS[optKey]) { tg(() => bot.answerCallbackQuery(q.id)).catch(() => {}); return; }
    const url = urlParts.join("|");
    const chatId = q.message.chat.id;
    const opt = OPTIONS[optKey];

    await tg(() => bot.answerCallbackQuery(q.id, { text: `⏳ ${opt.label} download hocche...` })).catch(() => {});
    await tg(() => bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: q.message.message_id })).catch(() => {});
    let statusMsg;
    try {
        statusMsg = await tg(() => bot.sendMessage(chatId, `⏳ ${opt.label} download hocche...\nEta ektu somoy nite pare.`));
    } catch (e) { console.error("send status failed:", e.message); return; }

    const stamp = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const outTemplate = path.join(DL_DIR, `tg_${stamp}.%(ext)s`);

    try {
        await ytdlp([...BASE, ...opt.args, "--max-filesize", MAX_SIZE, "-o", outTemplate, url]);
        const found = fs.readdirSync(DL_DIR).find(f => f.startsWith(`tg_${stamp}.`));
        if (!found) throw new Error("File toiri hoyni");
        const filePath = path.join(DL_DIR, found);
        const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);

        await tg(() => bot.deleteMessage(chatId, statusMsg.message_id)).catch(() => {});
        const caption = `${opt.label} • 💾 ${sizeMB} MB`;

        if (opt.kind === "video") await tg(() => bot.sendVideo(chatId, filePath, { caption }), 2);
        else await tg(() => bot.sendAudio(chatId, filePath, { caption }), 2);

        fs.unlinkSync(filePath);
    } catch (e) {
        const friendly = /max-filesize|larger than/i.test(e.message)
            ? "❌ File 48MB er beshi — choto quality try koro."
            : `❌ Download failed: ${e.message.slice(0, 200)}`;
        await tg(() => bot.editMessageText(friendly, { chat_id: chatId, message_id: statusMsg.message_id })).catch(() => {});
    }
});

bot.on("polling_error", (e) => console.error("polling:", e.message));

// never die on transient network errors — log and keep polling
process.on("uncaughtException", (e) => console.error("uncaught:", e && e.message));
process.on("unhandledRejection", (e) => console.error("unhandled:", (e && e.message) || e));

console.log("🤖 Telegram downloader bot running...");
