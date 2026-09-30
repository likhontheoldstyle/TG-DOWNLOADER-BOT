const TelegramBot = require("node-telegram-bot-api");
const { execFile, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const config = require("./config");

const TOKEN = config.BOT_TOKEN;
if (!TOKEN) {
    console.error("Bot token missing.");
    process.exit(1);
}

let YTDLP = "yt-dlp";
try {
    execFileSync("yt-dlp", ["--version"], { stdio: "ignore" });
} catch (_) {
    const alt = path.join(os.homedir(), ".local", "bin", "yt-dlp");
    if (fs.existsSync(alt)) YTDLP = alt;
}

const bot = new TelegramBot(TOKEN, { polling: { params: { timeout: 10 }, interval: 1000 } });
const DL_DIR = path.join(__dirname, "downloads");
if (!fs.existsSync(DL_DIR)) fs.mkdirSync(DL_DIR, { recursive: true });

const platforms = fs.readdirSync(path.join(__dirname, "social"))
    .filter(f => f.endsWith(".js"))
    .map(f => require(path.join(__dirname, "social", f)));

function detectPlatform(url) {
    return platforms.find(p => p.match(url)) || { id: "generic", tag: "🔗 Video", extractorArgs: [] };
}

async function tg(fn, retries = 3) {
    let last;
    for (let i = 0; i < retries; i++) {
        try { return await fn(); }
        catch (e) { last = e; await new Promise(r => setTimeout(r, 1500)); }
    }
    throw last;
}

function ytdlp(args, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
        execFile(YTDLP, args, { timeout: timeoutMs, maxBuffer: 64 * 1024 * 1024 }, (err, stdout, stderr) => {
            if (err) reject(new Error((stderr || err.message).trim().slice(0, 300)));
            else resolve(stdout);
        });
    });
}

function fmtDur(s) {
    if (!s) return "?";
    s = Math.floor(s);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

const OPTIONS = {
    v360:  { label: "360p", kind: "video", args: ["-f", "bv*[height<=360]+ba/b[height<=360]/bv*+ba/b", "--merge-output-format", "mp4"] },
    v720:  { label: "720p HD", kind: "video", args: ["-f", "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b", "--merge-output-format", "mp4"] },
    v1080: { label: "1080p Full HD", kind: "video", args: ["-f", "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b", "--merge-output-format", "mp4"] },
    mp3:   { label: "MP3 128k", kind: "audio", args: ["-x", "--audio-format", "mp3", "--audio-quality", "128K"] },
    mp32:  { label: "MP3 320k", kind: "audio", args: ["-x", "--audio-format", "mp3", "--audio-quality", "320K"] },
    m4a:   { label: "M4A", kind: "audio", args: ["-x", "--audio-format", "m4a"] },
};

const BASE = ["--no-warnings", "--no-playlist"];
const MAX_SIZE = config.MAX_SIZE || "48M";

bot.onText(/\/start/, (msg) => {
    tg(() => bot.sendMessage(msg.chat.id,
        "👋 All-in-One Downloader\n\n" +
        "Jekono video link pathao — ami download kore dibo.\n" +
        "📺 YouTube • 🎵 TikTok • 📘 Facebook • 📸 Instagram • 🐦 X • 📌 Pinterest • 💼 LinkedIn\n\n" +
        "Full HD video ba MP3/M4A audio — option tomake dibo.")).catch(() => {});
});

bot.on("message", async (msg) => {
    if (!msg.text || msg.text.startsWith("/")) return;
    const links = msg.text.match(/(https?:\/\/[^\s]+)/g);
    if (!links) return;
    const url = links[0];
    const chatId = msg.chat.id;
    const platform = detectPlatform(url);

    let waitMsg;
    try {
        waitMsg = await tg(() => bot.sendMessage(chatId, "🔎 Video info anche..."));
    } catch (_) { return; }

    let info;
    try {
        const out = await ytdlp([...platform.extractorArgs, ...BASE, "--dump-json", "--no-download", url], 90000);
        info = JSON.parse(out);
    } catch (e) {
        const m = String((e && e.message) || e);
        const friendly = /not a bot|sign in to confirm/i.test(m)
            ? "❌ YouTube ekhon block korteche (bot check).\nEktu pore abar try koro, ba TikTok/FB/IG link pathao."
            : `❌ Video info pawa jayni.\n${m.slice(0, 150)}`;
        try { await tg(() => bot.editMessageText(friendly, { chat_id: chatId, message_id: waitMsg.message_id })); } catch (_) {}
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
            `${platform.tag}\n🎬 ${title}\n⏱ ${fmtDur(info.duration)} • 👤 ${(info.uploader || "-").slice(0, 40)}\n\n👇 Quality select koro:`,
            { chat_id: chatId, message_id: waitMsg.message_id, reply_markup: { inline_keyboard: keyboard } }
        ));
    } catch (_) {}
});

bot.on("callback_query", async (q) => {
    const [action, optKey, ...urlParts] = (q.data || "").split("|");
    if (action !== "dl" || !OPTIONS[optKey]) { tg(() => bot.answerCallbackQuery(q.id)).catch(() => {}); return; }
    const url = urlParts.join("|");
    const chatId = q.message.chat.id;
    const opt = OPTIONS[optKey];
    const platform = detectPlatform(url);

    await tg(() => bot.answerCallbackQuery(q.id, { text: `⏳ ${opt.label} download hocche...` })).catch(() => {});
    await tg(() => bot.editMessageReplyMarkup({ inline_keyboard: [] }, { chat_id: chatId, message_id: q.message.message_id })).catch(() => {});

    let statusMsg;
    try {
        statusMsg = await tg(() => bot.sendMessage(chatId, `⏳ ${opt.label} download hocche...\nEta ektu somoy nite pare.`));
    } catch (_) { return; }

    const stamp = `${Date.now()}_${Math.floor(Math.random() * 1e6)}`;
    const outTemplate = path.join(DL_DIR, `tg_${stamp}.%(ext)s`);

    try {
        await ytdlp([...platform.extractorArgs, ...BASE, ...opt.args, "--max-filesize", MAX_SIZE, "-o", outTemplate, url]);
        const found = fs.readdirSync(DL_DIR).find(f => f.startsWith(`tg_${stamp}.`));
        if (!found) throw new Error("File toiri hoyni");
        const filePath = path.join(DL_DIR, found);
        const sizeMB = (fs.statSync(filePath).size / 1024 / 1024).toFixed(1);
        await tg(() => bot.deleteMessage(chatId, statusMsg.message_id)).catch(() => {});
        const caption = `${platform.tag} ${opt.label} • 💾 ${sizeMB} MB`;
        if (opt.kind === "video") await tg(() => bot.sendVideo(chatId, filePath, { caption }), 2);
        else await tg(() => bot.sendAudio(chatId, filePath, { caption }), 2);
        fs.unlinkSync(filePath);
    } catch (e) {
        const friendly = /max-filesize|larger than/i.test(e.message)
            ? `❌ File ${MAX_SIZE} er beshi — choto quality try koro.`
            : `❌ Download failed: ${e.message.slice(0, 200)}`;
        await tg(() => bot.editMessageText(friendly, { chat_id: chatId, message_id: statusMsg.message_id })).catch(() => {});
    }
});

bot.on("polling_error", (e) => console.error("polling:", e.message));
process.on("uncaughtException", (e) => console.error("uncaught:", e && e.message));
process.on("unhandledRejection", (e) => console.error("unhandled:", (e && e.message) || e));

console.log("🤖 Telegram downloader bot running...");
