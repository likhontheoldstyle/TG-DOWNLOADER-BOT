import asyncio
import base64
import json
import os
import re
import secrets
import shutil
import subprocess
import tempfile
import time

from . import config, platforms, yt_api

YTDLP = "yt-dlp"
if shutil.which("yt-dlp") is None:
    alt = os.path.join(os.path.expanduser("~"), ".local", "bin", "yt-dlp")
    if os.path.exists(alt):
        YTDLP = alt

JS_RUNTIME_ARGS = []
if shutil.which("deno"):
    JS_RUNTIME_ARGS = ["--js-runtimes", "deno"]
elif shutil.which("node"):
    JS_RUNTIME_ARGS = ["--js-runtimes", "node"]

EJS_ARGS = ["--remote-components", "ejs:github"]

BASE = ["--no-warnings", "--no-playlist", "--no-part", "--newline"]


def _cookies_file():
    if config.YOUTUBE_COOKIES_FILE and os.path.exists(config.YOUTUBE_COOKIES_FILE):
        return config.YOUTUBE_COOKIES_FILE
    b64 = os.environ.get("YOUTUBE_COOKIES_B64")
    if b64:
        try:
            p = os.path.join(tempfile.gettempdir(), "youtube_cookies.txt")
            with open(p, "wb") as f:
                f.write(base64.b64decode(b64))
            return p
        except Exception:
            pass
    return ""


YOUTUBE_COOKIES_FILE = _cookies_file()


def youtube_args():
    args = list(JS_RUNTIME_ARGS) + list(EJS_ARGS)
    if YOUTUBE_COOKIES_FILE and os.path.exists(YOUTUBE_COOKIES_FILE):
        args += ["--cookies", YOUTUBE_COOKIES_FILE]
    if config.YOUTUBE_PO_TOKEN:
        args += ["--extractor-args",
                 "youtube:player-client=default,mweb;po_token=mweb.gvs+" + config.YOUTUBE_PO_TOKEN]
    return args


def build_common_args(url, extra=None):
    args = []
    if platforms.is_youtube_url(url):
        args += youtube_args()
    return args + BASE + (extra or [])


def ytdlp(args, timeout=300):
    try:
        r = subprocess.run([YTDLP] + args, capture_output=True, text=True, timeout=timeout)
    except subprocess.TimeoutExpired:
        raise RuntimeError("yt-dlp timed out")
    if r.returncode != 0:
        msg = (r.stderr or r.stdout or "yt-dlp error").strip()
        raise RuntimeError(msg[:1000])
    return r.stdout


def fmt_dur(s):
    try:
        s = int(float(s))
    except Exception:
        return "?"
    h, rem = divmod(s, 3600)
    m, sec = divmod(rem, 60)
    if h:
        return f"{h}:{m:02d}:{sec:02d}"
    return f"{m}:{sec:02d}"


def format_bytes(n):
    try:
        n = float(n)
    except Exception:
        return "?"
    units = ["B", "KB", "MB", "GB"]
    i = 0
    while n >= 1024 and i < len(units) - 1:
        n /= 1024
        i += 1
    return f"{n:.0f} {units[i]}" if i == 0 else f"{n:.1f} {units[i]}"


def is_bot_check(e):
    text = str(getattr(e, "args", [e])[0] if getattr(e, "args", None) else e).lower()
    patterns = [
        "sign in to confirm", "not a bot", "confirm you're not a bot",
        "confirm you are not a bot", "captcha", "robot", "http error 403",
        "forbidden", "po token", "player response", "challenge",
    ]
    return any(p in text for p in patterns)


def parse_json_output(out):
    text = str(out or "").strip()
    if not text:
        raise RuntimeError("yt-dlp returned empty response")
    try:
        return json.loads(text)
    except Exception:
        pass
    for line in text.splitlines():
        line = line.strip()
        if not line:
            continue
        try:
            parsed = json.loads(line)
            if isinstance(parsed, dict):
                return parsed
        except Exception:
            continue
    raise RuntimeError("Invalid JSON returned by yt-dlp")


URL_STORE = {}
URL_TTL = 30 * 60


def create_url_key(url):
    key = secrets.token_hex(8)
    URL_STORE[key] = (url, time.time())
    return key


def get_stored_url(key):
    item = URL_STORE.get(key)
    if not item:
        return None
    if time.time() - item[1] > URL_TTL:
        URL_STORE.pop(key, None)
        return None
    return item[0]


async def url_store_cleaner():
    while True:
        await asyncio.sleep(300)
        now = time.time()
        for k in [k for k, v in URL_STORE.items() if now - v[1] > URL_TTL]:
            URL_STORE.pop(k, None)


async def tg(fn, retries=3):
    last = None
    for i in range(retries):
        try:
            return await fn()
        except Exception as e:
            last = e
            if i < retries - 1:
                await asyncio.sleep(1.5)
    raise last


def yt_info_smart(url):
    platform = platforms.detect_platform(url)
    if platforms.is_youtube_url(url) and config.YT_API_ENABLED:
        try:
            return yt_api.get_info(url)
        except Exception as e:
            print("yt-dlp-api info failed, falling back:", str(e)[:200])
    attempts = [build_common_args(url) + ["--dump-json", "--no-download", url]]
    if platform.get("extractor_args"):
        attempts.insert(0, platform["extractor_args"] + build_common_args(url) +
                        ["--dump-json", "--no-download", url])
    last = None
    for i, args in enumerate(attempts):
        try:
            return parse_json_output(ytdlp(args, timeout=120))
        except Exception as e:
            last = e
            print(f"yt-dlp info attempt {i + 1} failed:", str(e)[:200])
            if i < len(attempts) - 1:
                time.sleep(1)
    raise last


def yt_download_smart(url, opt_args, out_template):
    platform = platforms.detect_platform(url)
    if platforms.is_youtube_url(url) and config.YT_API_ENABLED:
        try:
            dl_opts = {}
            arg_str = " ".join(opt_args or [])
            if re.search(r"--audio-format\s+m4a", arg_str, re.I):
                dl_opts = {"extract_audio": True, "audio_format": "m4a"}
            elif "-x" in arg_str:
                dl_opts = {"extract_audio": True, "audio_format": "mp3"}
            else:
                max_h = 1080
                m = re.search(r"height<=(\d+)", arg_str)
                if m:
                    max_h = int(m.group(1))
                try:
                    fmts = yt_api.get_formats(url)
                    best = None
                    best_h = 0
                    for f in fmts:
                        res = str(f.get("resolution") or "")
                        h = int(res.split("x")[1]) if "x" in res and res.split("x")[1].isdigit() else 0
                        if 0 < h <= max_h and h > best_h:
                            best = f
                            best_h = h
                    if best:
                        dl_opts["format_id"] = best["format_id"]
                except Exception:
                    pass
            stamp = os.path.basename(out_template).split(".")[0]
            dest_dir = os.path.dirname(out_template)
            yt_api.download_to_dir(url, dl_opts, dest_dir, stamp)
            return
        except Exception as e:
            print("yt-dlp-api download failed, falling back:", str(e)[:200])
    args = ((platform.get("extractor_args") or []) + build_common_args(url) +
            (opt_args or []) + ["--max-filesize", config.MAX_SIZE,
                                "-o", out_template, url])
    last = None
    for i in range(1):
        try:
            ytdlp(args, timeout=600)
            return
        except Exception as e:
            last = e
            print(f"yt-dlp download attempt {i + 1} failed:", str(e)[:200])
            time.sleep(1.5)
    raise last
