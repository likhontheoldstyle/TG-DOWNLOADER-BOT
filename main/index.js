const TelegramBot = require("node-telegram-bot-api");
const { execFile, execFileSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const config = require("../config");

const TOKEN = config.BOT_TOKEN;

if (!TOKEN) {
    console.error("❌ Bot token missing.");
    process.exit(1);
}

/* =========================================================
   YT-DLP
========================================================= */

let YTDLP = "yt-dlp";

try {
    execFileSync("yt-dlp", ["--version"], {
        stdio: "ignore"
    });
} catch (_) {
    const alt = path.join(os.homedir(), ".local", "bin", "yt-dlp");

    if (fs.existsSync(alt)) {
        YTDLP = alt;
    }
}

/* =========================================================
   Optional YouTube settings
   config.js এ চাইলে এগুলো দিতে পারো:
   
   YOUTUBE_COOKIES_FILE: "/path/to/cookies.txt"
   YOUTUBE_PO_TOKEN: "your_po_token"
   
   না দিলেও bot normal public videos এর জন্য কাজ করবে।
========================================================= */

const YOUTUBE_COOKIES_FILE =
    config.YOUTUBE_COOKIES_FILE ||
    process.env.YOUTUBE_COOKIES_FILE ||
    "";

const YOUTUBE_PO_TOKEN =
    config.YOUTUBE_PO_TOKEN ||
    process.env.YOUTUBE_PO_TOKEN ||
    "";

/* =========================================================
   Detect JS runtime for current yt-dlp
========================================================= */

function commandExists(command) {
    try {
        execFileSync(command, ["--version"], {
            stdio: "ignore"
        });
        return true;
    } catch (_) {
        return false;
    }
}

let JS_RUNTIME_ARGS = [];

if (commandExists("deno")) {
    JS_RUNTIME_ARGS = [
        "--js-runtimes",
        "deno"
    ];
} else if (commandExists("node")) {
    JS_RUNTIME_ARGS = [
        "--js-runtimes",
        "node"
    ];
}

/*
 * EJS remote component.
 * This helps when yt-dlp was installed without bundled EJS.
 */
const EJS_ARGS = [
    "--remote-components",
    "ejs:github"
];

/* =========================================================
   Telegram
========================================================= */

const bot = new TelegramBot(TOKEN, {
    polling: {
        params: {
            timeout: 10
        },
        interval: 1000
    }
});

/* =========================================================
   Download directory
========================================================= */

const DL_DIR = path.join(
    __dirname,
    "..",
    "downloads"
);

if (!fs.existsSync(DL_DIR)) {
    fs.mkdirSync(DL_DIR, {
        recursive: true
    });
}

/* =========================================================
   Social platforms
========================================================= */

const SOCIAL_DIR = path.join(
    __dirname,
    "..",
    "social"
);

let platforms = [];

if (fs.existsSync(SOCIAL_DIR)) {
    platforms = fs
        .readdirSync(SOCIAL_DIR)
        .filter(f => f.endsWith(".js"))
        .map(f => {
            try {
                return require(
                    path.join(SOCIAL_DIR, f)
                );
            } catch (e) {
                console.error(
                    `❌ Failed loading platform ${f}:`,
                    e.message
                );
                return null;
            }
        })
        .filter(Boolean);
}

/* =========================================================
   URL helpers
========================================================= */

function detectPlatform(url) {
    try {
        const found = platforms.find(
            p => typeof p.match === "function" && p.match(url)
        );

        return found || {
            id: "generic",
            tag: "🔗 Video",
            extractorArgs: []
        };
    } catch (_) {
        return {
            id: "generic",
            tag: "🔗 Video",
            extractorArgs: []
        };
    }
}

function isYouTubeUrl(url) {
    try {
        const host = new URL(url).hostname
            .toLowerCase()
            .replace(/^www\./, "");

        return (
            host === "youtube.com" ||
            host === "youtu.be" ||
            host.endsWith(".youtube.com")
        );
    } catch (_) {
        return false;
    }
}

/* =========================================================
   Short callback storage
   Telegram callback_data has a strict size limit.
========================================================= */

const URL_STORE = new Map();

const URL_TTL = 30 * 60 * 1000;

function createUrlKey(url) {
    const key = crypto
        .randomBytes(8)
        .toString("hex");

    URL_STORE.set(key, {
        url,
        createdAt: Date.now()
    });

    return key;
}

function getStoredUrl(key) {
    const item = URL_STORE.get(key);

    if (!item) {
        return null;
    }

    if (
        Date.now() - item.createdAt >
        URL_TTL
    ) {
        URL_STORE.delete(key);
        return null;
    }

    return item.url;
}

/* Cleanup old callback URLs */

setInterval(() => {
    const now = Date.now();

    for (const [key, item] of URL_STORE.entries()) {
        if (now - item.createdAt > URL_TTL) {
            URL_STORE.delete(key);
        }
    }
}, 5 * 60 * 1000);

/* =========================================================
   Telegram retry helper
========================================================= */

async function tg(fn, retries = 3) {
    let lastError;

    for (let i = 0; i < retries; i++) {
        try {
            return await fn();
        } catch (e) {
            lastError = e;

            if (i < retries - 1) {
                await new Promise(resolve =>
                    setTimeout(resolve, 1500)
                );
            }
        }
    }

    throw lastError;
}

/* =========================================================
   yt-dlp command
========================================================= */

function ytdlp(args, timeoutMs = 300000) {
    return new Promise((resolve, reject) => {
        execFile(
            YTDLP,
            args,
            {
                timeout: timeoutMs,
                maxBuffer: 128 * 1024 * 1024
            },
            (err, stdout, stderr) => {

                if (err) {
                    const message =
                        (stderr || err.message || "")
                            .trim();

                    reject(
                        new Error(
                            message.slice(0, 1000)
                        )
                    );

                    return;
                }

                resolve(stdout);
            }
        );
    });
}

/* =========================================================
   Duration
========================================================= */

function fmtDur(s) {
    if (!s) return "?";

    s = Math.floor(Number(s));

    if (!Number.isFinite(s)) {
        return "?";
    }

    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;

    return h
        ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`
        : `${m}:${String(sec).padStart(2, "0")}`;
}

/* =========================================================
   File size
========================================================= */

function formatBytes(bytes) {
    if (!bytes || !Number.isFinite(Number(bytes))) {
        return "?";
    }

    bytes = Number(bytes);

    const units = [
        "B",
        "KB",
        "MB",
        "GB"
    ];

    let i = 0;

    while (
        bytes >= 1024 &&
        i < units.length - 1
    ) {
        bytes /= 1024;
        i++;
    }

    return `${bytes.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

/* =========================================================
   Download options
========================================================= */

const OPTIONS = {

    v360: {
        label: "360p",
        kind: "video",
        args: [
            "-f",
            "bv*[height<=360]+ba/b[height<=360]/bv*+ba/b",
            "--merge-output-format",
            "mp4"
        ]
    },

    v720: {
        label: "720p HD",
        kind: "video",
        args: [
            "-f",
            "bv*[height<=720]+ba/b[height<=720]/bv*+ba/b",
            "--merge-output-format",
            "mp4"
        ]
    },

    v1080: {
        label: "1080p Full HD",
        kind: "video",
        args: [
            "-f",
            "bv*[height<=1080]+ba/b[height<=1080]/bv*+ba/b",
            "--merge-output-format",
            "mp4"
        ]
    },

    mp3: {
        label: "MP3 128k",
        kind: "audio",
        args: [
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "128K"
        ]
    },

    mp32: {
        label: "MP3 320k",
        kind: "audio",
        args: [
            "-x",
            "--audio-format",
            "mp3",
            "--audio-quality",
            "320K"
        ]
    },

    m4a: {
        label: "M4A",
        kind: "audio",
        args: [
            "-x",
            "--audio-format",
            "m4a"
        ]
    }
};

/* =========================================================
   Base yt-dlp arguments
========================================================= */

const BASE = [
    "--no-warnings",
    "--no-playlist",
    "--no-part",
    "--newline"
];

/*
 * Normal Telegram Bot API upload limit is 50 MB.
 * Keep slightly below the limit for reliability.
 */
const MAX_SIZE =
    config.MAX_SIZE ||
    "48M";

/* =========================================================
   YouTube extra arguments
========================================================= */

function youtubeArgs() {

    if (!YOUTUBE_COOKIES_FILE &&
        !YOUTUBE_PO_TOKEN) {

        return [
            ...JS_RUNTIME_ARGS,
            ...EJS_ARGS
        ];
    }

    const args = [
        ...JS_RUNTIME_ARGS,
        ...EJS_ARGS
    ];

    if (YOUTUBE_COOKIES_FILE &&
        fs.existsSync(YOUTUBE_COOKIES_FILE)) {

        args.push(
            "--cookies",
            YOUTUBE_COOKIES_FILE
        );
    }

    if (YOUTUBE_PO_TOKEN) {

        args.push(
            "--extractor-args",
            `youtube:player-client=default,mweb;po_token=mweb.gvs+${YOUTUBE_PO_TOKEN}`
        );
    }

    return args;
}

/* =========================================================
   Build yt-dlp arguments
========================================================= */

function buildCommonArgs(url, extra = []) {

    const args = [];

    if (isYouTubeUrl(url)) {
        args.push(...youtubeArgs());
    }

    return [
        ...args,
        ...BASE,
        ...extra
    ];
}

/* =========================================================
   Bot check detection
========================================================= */

function isBotCheck(e) {

    const text = String(
        (e && e.message) || e || ""
    ).toLowerCase();

    return (
        /sign in to confirm/.test(text) ||
        /not a bot/.test(text) ||
        /confirm you're not a bot/.test(text) ||
        /confirm you are not a bot/.test(text) ||
        /captcha/.test(text) ||
        /robot/.test(text) ||
        /http error 403/.test(text) ||
        /forbidden/.test(text) ||
        /po token/.test(text) ||
        /player response/.test(text) ||
        /challenge/.test(text)
    );
}

/* =========================================================
   Parse JSON safely
========================================================= */

function parseJsonOutput(out) {

    const text = String(out || "")
        .trim();

    if (!text) {
        throw new Error(
            "yt-dlp returned empty response"
        );
    }

    /*
     * dump-json normally returns one JSON object.
     */
    try {
        return JSON.parse(text);
    } catch (_) {
        /*
         * Fallback for accidental extra lines.
         */
        const lines = text
            .split(/\r?\n/)
            .map(x => x.trim())
            .filter(Boolean);

        for (const line of lines) {
            try {
                const parsed = JSON.parse(line);

                if (parsed && typeof parsed === "object") {
                    return parsed;
                }
            } catch (_) {}
        }

        throw new Error(
            "Invalid JSON returned by yt-dlp"
        );
    }
}

/* =========================================================
   YouTube / video info
========================================================= */

async function ytInfoSmart(url) {

    const platform = detectPlatform(url);

    const attempts = [];

    /*
     * Attempt 1:
     * Normal extractor + current EJS setup
     */
    attempts.push([
        ...buildCommonArgs(url),
        "--dump-json",
        "--no-download",
        url
    ]);

    /*
     * Attempt 2:
     * Android client fallback.
     *
     * This is only a fallback, not a guarantee.
     */
    if (isYouTubeUrl(url)) {

        attempts.push([
            ...JS_RUNTIME_ARGS,
            ...EJS_ARGS,
            "--extractor-args",
            "youtube:player-client=android",
            ...BASE,
            "--dump-json",
            "--no-download",
            url
        ]);
    }

    /*
     * Platform-specific extractor.
     */
    if (platform.extractorArgs &&
        platform.extractorArgs.length) {

        attempts.unshift([
            ...platform.extractorArgs,
            ...buildCommonArgs(url),
            "--dump-json",
            "--no-download",
            url
        ]);
    }

    let lastError;

    for (let i = 0; i < attempts.length; i++) {

        try {

            const out = await ytdlp(
                attempts[i],
                120000
            );

            return parseJsonOutput(out);

        } catch (e) {

            lastError = e;

            console.error(
                `yt-dlp info attempt ${i + 1} failed:`,
                e.message
            );

            /*
             * Give fallback attempts a little delay.
             */
            if (i < attempts.length - 1) {
                await new Promise(resolve =>
                    setTimeout(resolve, 1000)
                );
            }
        }
    }

    throw lastError;
}

/* =========================================================
   Download
========================================================= */

async function ytDownloadSmart(
    url,
    optArgs,
    outTemplate
) {

    const platform = detectPlatform(url);

    const attempts = [];

    /*
     * Normal attempt
     */
    attempts.push([
        ...(platform.extractorArgs || []),
        ...buildCommonArgs(url),
        ...optArgs,
        "--max-filesize",
        MAX_SIZE,
        "-o",
        outTemplate,
        url
    ]);

    /*
     * YouTube fallback
     */
    if (isYouTubeUrl(url)) {

        attempts.push([
            ...JS_RUNTIME_ARGS,
            ...EJS_ARGS,
            "--extractor-args",
            "youtube:player-client=android",
            ...BASE,
            ...optArgs,
            "--max-filesize",
            MAX_SIZE,
            "-o",
            outTemplate,
            url
        ]);
    }

    let lastError;

    for (let i = 0; i < attempts.length; i++) {

        try {

            await ytdlp(
                attempts[i],
                600000
            );

            return;

        } catch (e) {

            lastError = e;

            console.error(
                `yt-dlp download attempt ${i + 1} failed:`,
                e.message
            );

            if (i < attempts.length - 1) {
                await new Promise(resolve =>
                    setTimeout(resolve, 1500)
                );
            }
        }
    }

    throw lastError;
}

/* =========================================================
   Quality keyboard
========================================================= */

function qualityKeyboard(url) {

    const key = createUrlKey(url);

    return [

        [
            {
                text: "🎬 360p",
                callback_data: `dl|v360|${key}`
            },

            {
                text: "🎬 720p HD",
                callback_data: `dl|v720|${key}`
            }
        ],

        [
            {
                text: "🎬 1080p Full HD",
                callback_data: `dl|v1080|${key}`
            }
        ],

        [
            {
                text: "🎵 MP3 128k",
                callback_data: `dl|mp3|${key}`
            },

            {
                text: "🎵 MP3 320k",
                callback_data: `dl|mp32|${key}`
            },

            {
                text: "🎵 M4A",
                callback_data: `dl|m4a|${key}`
            }
        ]
    ];
}

/* =========================================================
   Show quality
========================================================= */

async function showQuality(
    chatId,
    url,
    waitMsg
) {

    const platform = detectPlatform(url);

    let info;

    try {

        info = await ytInfoSmart(url);

    } catch (e) {

        const message = String(
            (e && e.message) || e
        );

        let friendly;

        if (isBotCheck(e)) {

            friendly =
                "❌ YouTube verification/block detected.\n\n" +
                "yt-dlp/EJS দিয়ে আবার চেষ্টা করা হয়েছে, " +
                "কিন্তু YouTube এই request accept করেনি.\n\n" +
                "💡 yt-dlp, EJS এবং JavaScript runtime update করে " +
                "আবার চেষ্টা করো.";

        } else {

            friendly =
                "❌ Video info pawa jayni.\n\n" +
                message.slice(0, 500);
        }

        try {

            await tg(() =>
                bot.editMessageText(
                    friendly,
                    {
                        chat_id: chatId,
                        message_id: waitMsg.message_id
                    }
                )
            );

        } catch (_) {}

        return;
    }

    const title =
        (info.title || "Video")
            .replace(/\s+/g, " ")
            .slice(0, 100);

    const uploader =
        (info.uploader ||
            info.channel ||
            "-")
            .replace(/\s+/g, " ")
            .slice(0, 40);

    const caption =
        `${platform.tag}\n` +
        `🎬 ${title}\n` +
        `⏱ ${fmtDur(info.duration)} • 👤 ${uploader}\n\n` +
        `👇 Quality select koro:`;

    const keyboard =
        qualityKeyboard(url);

    try {
        await tg(() =>
            bot.deleteMessage(
                chatId,
                waitMsg.message_id
            )
        );
    } catch (_) {}

    try {

        if (info.thumbnail) {

            await tg(() =>
                bot.sendPhoto(
                    chatId,
                    info.thumbnail,
                    {
                        caption,
                        reply_markup: {
                            inline_keyboard: keyboard
                        }
                    }
                )
            );

        } else {

            await tg(() =>
                bot.sendMessage(
                    chatId,
                    caption,
                    {
                        reply_markup: {
                            inline_keyboard: keyboard
                        }
                    }
                )
            );
        }

    } catch (e) {

        console.error(
            "Quality message error:",
            e.message
        );

        try {

            await tg(() =>
                bot.sendMessage(
                    chatId,
                    caption,
                    {
                        reply_markup: {
                            inline_keyboard: keyboard
                        }
                    }
                )
            );

        } catch (_) {}
    }
}

/* =========================================================
   Search YouTube
========================================================= */

async function ytSearch(
    chatId,
    query,
    waitMsg
) {

    let out;

    try {

        const args = [
            ...JS_RUNTIME_ARGS,
            ...EJS_ARGS,
            "--no-warnings",
            "--dump-json",
            "--flat-playlist",
            "--no-download",
            `ytsearch5:${query}`
        ];

        out = await ytdlp(
            args,
            120000
        );

    } catch (e) {

        console.error(
            "Search error:",
            e.message
        );

        try {

            await tg(() =>
                bot.editMessageText(
                    "❌ Search failed.\n\n" +
                    e.message.slice(0, 300),
                    {
                        chat_id: chatId,
                        message_id: waitMsg.message_id
                    }
                )
            );

        } catch (_) {}

        return;
    }

    const items = out
        .trim()
        .split("\n")
        .map(line => {
            try {
                return JSON.parse(line);
            } catch (_) {
                return null;
            }
        })
        .filter(v => v && v.id)
        .slice(0, 5);

    if (!items.length) {

        try {

            await tg(() =>
                bot.editMessageText(
                    "❌ Kichu pawa jayni.\n" +
                    "Onno nam likho.",
                    {
                        chat_id: chatId,
                        message_id: waitMsg.message_id
                    }
                )
            );

        } catch (_) {}

        return;
    }

    const keyboard = items.map(v => {

        const title =
            (v.title || "Video")
                .replace(/\s+/g, " ")
                .slice(0, 45);

        const id =
            String(v.id);

        return [
            {
                text:
                    `🎬 ${title}`,
                callback_data:
                    `sr|${id}`
            }
        ];
    });

    try {

        await tg(() =>
            bot.editMessageText(
                `🔍 "${query.slice(0, 50)}"\n\n` +
                `👇 Video select koro:`,
                {
                    chat_id: chatId,
                    message_id: waitMsg.message_id,
                    reply_markup: {
                        inline_keyboard: keyboard
                    }
                }
            )
        );

    } catch (e) {

        console.error(
            "Search keyboard error:",
            e.message
        );
    }
}

/* =========================================================
   START
========================================================= */

bot.onText(
    /\/start/,
    msg => {

        tg(() =>
            bot.sendMessage(
                msg.chat.id,

                "👋 All-in-One Downloader\n\n" +

                "🔍 Jekono gan ba video r nam likho — " +
                "ami YouTube e search kore dibo.\n" +

                "🔗 Ba sorasori link pathao.\n\n" +

                "📺 YouTube • 🎵 TikTok • " +
                "📘 Facebook • 📸 Instagram • " +
                "🐦 X • 📌 Pinterest • 💼 LinkedIn\n\n" +

                "Full HD video ba MP3/M4A audio — " +
                "option tomake dibo."
            )
        ).catch(() => {});
    }
);

/* =========================================================
   MESSAGE
========================================================= */

bot.on(
    "message",
    async msg => {

        if (!msg.text) {
            return;
        }

        if (msg.text.startsWith("/")) {
            return;
        }

        const chatId =
            msg.chat.id;

        const text =
            msg.text.trim();

        if (!text) {
            return;
        }

        /*
         * Better URL detection.
         */
        const links =
            text.match(
                /https?:\/\/[^\s<>"']+/gi
            );

        let waitMsg;

        try {

            waitMsg = await tg(() =>
                bot.sendMessage(
                    chatId,
                    "🔎 Khujchi..."
                )
            );

        } catch (e) {

            console.error(
                "Send waiting message error:",
                e.message
            );

            return;
        }

        if (links && links.length) {

            /*
             * Remove trailing punctuation.
             */
            const url =
                links[0]
                    .replace(/[),.!?]+$/, "");

            await showQuality(
                chatId,
                url,
                waitMsg
            );

        } else {

            await ytSearch(
                chatId,
                text,
                waitMsg
            );
        }
    }
);

/* =========================================================
   CALLBACK QUERY
========================================================= */

bot.on(
    "callback_query",
    async q => {

        try {

            if (!q.message) {
                await bot.answerCallbackQuery(
                    q.id
                ).catch(() => {});

                return;
            }

            const chatId =
                q.message.chat.id;

            const data =
                String(q.data || "");

            const parts =
                data.split("|");

            const action =
                parts[0];

            const arg =
                parts[1];

            /* =============================================
               Search result
            ============================================= */

            if (
                action === "sr" &&
                arg
            ) {

                await tg(() =>
                    bot.answerCallbackQuery(
                        q.id
                    )
                ).catch(() => {});

                let waitMsg;

                try {

                    waitMsg = await tg(() =>
                        bot.sendMessage(
                            chatId,
                            "🔎 Video info anche..."
                        )
                    );

                } catch (_) {

                    return;
                }

                try {

                    await tg(() =>
                        bot.deleteMessage(
                            chatId,
                            q.message.message_id
                        )
                    );

                } catch (_) {}

                await showQuality(
                    chatId,
                    `https://www.youtube.com/watch?v=${arg}`,
                    waitMsg
                );

                return;
            }

            /* =============================================
               Download
            ============================================= */

            if (
                action !== "dl" ||
                !OPTIONS[arg]
            ) {

                await tg(() =>
                    bot.answerCallbackQuery(
                        q.id
                    )
                ).catch(() => {});

                return;
            }

            const key =
                parts.slice(2).join("|");

            const url =
                getStoredUrl(key);

            if (!url) {

                await tg(() =>
                    bot.answerCallbackQuery(
                        q.id,
                        {
                            text:
                                "❌ Link expired. আবার link পাঠাও।",
                            show_alert: true
                        }
                    )
                ).catch(() => {});

                return;
            }

            const opt =
                OPTIONS[arg];

            const platform =
                detectPlatform(url);

            await tg(() =>
                bot.answerCallbackQuery(
                    q.id,
                    {
                        text:
                            `⏳ ${opt.label} download hocche...`
                    }
                )
            ).catch(() => {});

            await tg(() =>
                bot.editMessageReplyMarkup(
                    {
                        inline_keyboard: []
                    },
                    {
                        chat_id: chatId,
                        message_id:
                            q.message.message_id
                    }
                )
            ).catch(() => {});

            let statusMsg;

            try {

                statusMsg = await tg(() =>
                    bot.sendMessage(
                        chatId,
                        `⏳ ${opt.label} download hocche...\n` +
                        `Eta ektu somoy nite pare.`
                    )
                );

            } catch (e) {

                console.error(
                    "Status message error:",
                    e.message
                );

                return;
            }

            const stamp =
                `${Date.now()}_${Math.floor(
                    Math.random() * 1e6
                )}`;

            const outTemplate =
                path.join(
                    DL_DIR,
                    `tg_${stamp}.%(ext)s`
                );

            let filePath = null;

            try {

                /*
                 * Download
                 */
                await ytDownloadSmart(
                    url,
                    opt.args,
                    outTemplate
                );

                /*
                 * Find generated file
                 */
                const files =
                    fs
                        .readdirSync(DL_DIR)
                        .filter(
                            f =>
                                f.startsWith(
                                    `tg_${stamp}.`
                                )
                        );

                if (!files.length) {
                    throw new Error(
                        "Download complete but file toiri hoyni."
                    );
                }

                /*
                 * Prefer actual media file
                 */
                const preferred =
                    files.find(f =>
                        /\.(mp4|mkv|webm|mp3|m4a|aac|opus)$/i
                            .test(f)
                    );

                const found =
                    preferred || files[0];

                filePath =
                    path.join(
                        DL_DIR,
                        found
                    );

                if (!fs.existsSync(filePath)) {
                    throw new Error(
                        "Downloaded file not found."
                    );
                }

                const stat =
                    fs.statSync(filePath);

                const sizeMB =
                    stat.size /
                    1024 /
                    1024;

                console.log(
                    `Downloaded: ${found} (${sizeMB.toFixed(2)} MB)`
                );

                /*
                 * Telegram cloud Bot API limitation.
                 */
                if (sizeMB > 49) {

                    throw new Error(
                        `FILE_TOO_LARGE:${sizeMB.toFixed(1)}MB`
                    );
                }

                try {

                    await tg(() =>
                        bot.deleteMessage(
                            chatId,
                            statusMsg.message_id
                        )
                    );

                } catch (_) {}

                const caption =
                    `${platform.tag} ` +
                    `${opt.label} • 💾 ` +
                    `${formatBytes(stat.size)}`;

                /*
                 * Send video
                 */
                if (opt.kind === "video") {

                    await tg(
                        () =>
                            bot.sendVideo(
                                chatId,
                                filePath,
                                {
                                    caption
                                }
                            ),
                        2
                    );

                } else {

                    /*
                     * Send audio
                     */
                    await tg(
                        () =>
                            bot.sendAudio(
                                chatId,
                                filePath,
                                {
                                    caption
                                }
                            ),
                        2
                    );
                }

                console.log(
                    `✅ Sent ${found} to ${chatId}`
                );

            } catch (e) {

                const errorText =
                    String(
                        (e && e.message) ||
                        e ||
                        ""
                    );

                console.error(
                    "DOWNLOAD ERROR:",
                    errorText
                );

                let friendly;

                /*
                 * File too large
                 */
                if (
                    errorText.startsWith(
                        "FILE_TOO_LARGE:"
                    )
                ) {

                    const size =
                        errorText.split(":")[1];

                    friendly =
                        `❌ File ${size} — ` +
                        `Telegram Bot API-এর 50 MB limit-এর ` +
                        `বেশি।\n\n` +
                        `ছোট quality select করো।`;

                }

                /*
                 * Max filesize from yt-dlp
                 */
                else if (
                    /max-filesize|larger than/i
                        .test(errorText)
                ) {

                    friendly =
                        `❌ File ${MAX_SIZE} এর বেশি।\n` +
                        `আরও ছোট quality try koro.`;

                }

                /*
                 * YouTube bot check
                 */
                else if (
                    isBotCheck(e)
                ) {

                    friendly =
                        "❌ YouTube verification/block detected.\n\n" +
                        "yt-dlp-এর latest EJS/runtime দিয়ে " +
                        "retry করা হয়েছে, কিন্তু YouTube request " +
                        "accept করেনি.\n\n" +
                        "যদি server-এ yt-dlp পুরোনো হয়, update করো.";
                }

                /*
                 * FFmpeg error
                 */
                else if (
                    /ffmpeg|ffprobe|merging|postprocess/i
                        .test(errorText)
                ) {

                    friendly =
                        "❌ FFmpeg problem.\n\n" +
                        "Video/audio merge করার জন্য server-এ " +
                        "FFmpeg install থাকতে হবে.";
                }

                else {

                    friendly =
                        `❌ Download failed:\n` +
                        `${errorText.slice(0, 500)}`;
                }

                try {

                    await tg(() =>
                        bot.editMessageText(
                            friendly,
                            {
                                chat_id: chatId,
                                message_id:
                                    statusMsg.message_id
                            }
                        )
                    );

                } catch (_) {}

            } finally {

                /*
                 * Delete temporary files.
                 */
                if (filePath &&
                    fs.existsSync(filePath)) {

                    try {
                        fs.unlinkSync(filePath);
                    } catch (_) {}
                }

                /*
                 * Remove any leftover files
                 * created by this download.
                 */
                try {

                    const leftovers =
                        fs
                            .readdirSync(DL_DIR)
                            .filter(
                                f =>
                                    f.startsWith(
                                        `tg_${stamp}.`
                                    )
                            );

                    for (const file of leftovers) {

                        try {
                            fs.unlinkSync(
                                path.join(
                                    DL_DIR,
                                    file
                                )
                            );
                        } catch (_) {}
                    }

                } catch (_) {}
            }
        }

        } catch (e) {

            console.error(
                "Callback handler error:",
                e && e.stack
                    ? e.stack
                    : e
            );

            try {

                await bot.answerCallbackQuery(
                    q.id,
                    {
                        text:
                            "❌ Something went wrong.",
                        show_alert: true
                    }
                );

            } catch (_) {}
        }
    }
);

/* =========================================================
   Errors
========================================================= */

bot.on(
    "polling_error",
    e => {
        console.error(
            "Telegram polling:",
            e && e.message
        );
    }
);

process.on(
    "uncaughtException",
    e => {
        console.error(
            "UNCAUGHT:",
            e && e.stack
                ? e.stack
                : e
        );
    }
);

process.on(
    "unhandledRejection",
    e => {
        console.error(
            "UNHANDLED:",
            e && e.stack
                ? e.stack
                : e
        );
    }
);

/* =========================================================
   Startup diagnostics
========================================================= */

console.log(
    "🤖 Telegram downloader bot running..."
);

console.log(
    `📦 yt-dlp: ${YTDLP}`
);

console.log(
    `⚙️ JS runtime: ${
        JS_RUNTIME_ARGS.length
            ? JS_RUNTIME_ARGS.join(" ")
            : "NOT FOUND"
    }`
);

console.log(
    `🍪 YouTube cookies: ${
        YOUTUBE_COOKIES_FILE
            ? "configured"
            : "not configured"
    }`
);

console.log(
    `🔐 YouTube PO Token: ${
        YOUTUBE_PO_TOKEN
            ? "configured"
            : "not configured"
    }`
);

console.log(
    `📤 Telegram max download: ${MAX_SIZE}`
);
