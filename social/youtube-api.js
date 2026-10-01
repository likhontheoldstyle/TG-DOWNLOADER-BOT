const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");

const API_URL =
    process.env.YT_API_URL ||
    "http://127.0.0.1:8000";

const API_KEY =
    process.env.YT_API_KEY ||
    "";

function apiRequest(method, apiPath, body) {

    return new Promise((resolve, reject) => {

        const u = new URL(API_URL + apiPath);

        const lib = u.protocol === "https:" ? https : http;

        const payload = body ? JSON.stringify(body) : null;

        const req = lib.request(
            {
                hostname: u.hostname,
                port: u.port || (u.protocol === "https:" ? 443 : 80),
                path: u.pathname + u.search,
                method,
                headers: {
                    "X-API-Key": API_KEY,
                    "Content-Type": "application/json",
                    ...(payload ? { "Content-Length": Buffer.byteLength(payload) } : {})
                },
                timeout: 600000
            },
            res => {

                let data = "";

                res.on("data", c => { data += c; });
                res.on("end", () => {

                    let json = null;

                    try { json = JSON.parse(data); }
                    catch (_) {}

                    if (res.statusCode >= 200 && res.statusCode < 300) {
                        resolve(json);
                    } else {

                        const msg =
                            (json && json.detail && (json.detail.message || json.detail)) ||
                            (json && json.message) ||
                            `API error ${res.statusCode}`;

                        const err = new Error(String(msg).slice(0, 500));

                        err.statusCode = res.statusCode;

                        reject(err);
                    }
                });
            }
        );

        req.on("error", reject);
        req.on("timeout", () => { req.destroy(new Error("API timeout")); });

        if (payload) req.write(payload);

        req.end();
    });
}

async function apiHealth() {

    try {

        await apiRequest("GET", "/health");

        return true;

    } catch (e) {

        return e && e.statusCode === 503;
    }
}

async function getInfo(url) {

    const data = await apiRequest(
        "GET",
        "/api/v1/info?url=" + encodeURIComponent(url)
    );

    return {
        id: data.video_id,
        title: data.title,
        uploader: data.author,
        duration: data.duration,
        thumbnail: data.thumbnail_url,
        view_count: data.view_count,
        upload_date: data.upload_date,
        description: data.description,
        extractor: "youtube"
    };
}

async function getFormats(url) {

    const data = await apiRequest(
        "GET",
        "/api/v1/formats?url=" + encodeURIComponent(url)
    );

    return (data.formats || []).map(f => ({
        format_id: f.format_id,
        ext: f.ext,
        resolution: f.resolution,
        filesize: f.filesize,
        abr: f.abr,
        vcodec: f.vcodec,
        acodec: f.acodec
    }));
}

async function getTranscript(url, lang) {

    const q =
        "/api/v1/transcript?url=" +
        encodeURIComponent(url) +
        "&lang=" + encodeURIComponent(lang || "en") +
        "&fmt=text";

    return apiRequest("GET", q);
}

async function download(url, opts) {

    opts = opts || {};

    const body = {
        url,
        async: false
    };

    if (opts.format_id) body.format_id = opts.format_id;
    if (opts.extract_audio) body.extract_audio = true;
    if (opts.audio_format) body.audio_format = opts.audio_format;

    const data = await apiRequest("POST", "/api/v1/download", body);

    if (!data || !data.file_path) {
        throw new Error("API download returned no file");
    }

    return {
        file_path: data.file_path,
        file_size: data.file_size,
        format_id: data.format_id
    };
}

async function downloadToDir(url, opts, destDir, baseName) {

    const result = await download(url, opts);

    const srcPath = result.file_path;

    if (!fs.existsSync(srcPath)) {
        throw new Error("API file not found: " + srcPath);
    }

    const ext = path.extname(srcPath) || ".mp4";

    const destPath = path.join(destDir, baseName + ext);

    fs.copyFileSync(srcPath, destPath);

    return destPath;
}

module.exports = {
    apiHealth,
    getInfo,
    getFormats,
    getTranscript,
    download,
    downloadToDir,
    API_URL
};
