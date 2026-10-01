import json
import os
import shutil
import urllib.parse
import urllib.request

from . import config

API_URL = os.environ.get("YT_API_URL") or config.YT_API_URL
API_KEY = os.environ.get("YT_API_KEY") or config.YT_API_KEY


class ApiError(Exception):
    def __init__(self, message, status_code=None):
        super().__init__(message)
        self.status_code = status_code


def api_request(method, api_path, body=None):
    url = API_URL + api_path
    payload = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=payload, method=method)
    req.add_header("X-API-Key", API_KEY)
    if payload:
        req.add_header("Content-Type", "application/json")
    try:
        with urllib.request.urlopen(req, timeout=600) as res:
            data = res.read().decode("utf-8", "replace")
            return json.loads(data) if data.strip() else None
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8", "replace")
        try:
            parsed = json.loads(raw) if raw.strip() else None
        except Exception:
            parsed = None
        detail = None
        if isinstance(parsed, dict):
            d = parsed.get("detail")
            detail = (d.get("message") if isinstance(d, dict) else d) or parsed.get("message")
        msg = str(detail or f"API error {e.code}")[:500]
        raise ApiError(msg, e.code)


def api_health():
    try:
        api_request("GET", "/health")
        return True
    except ApiError as e:
        return e.status_code == 503
    except Exception:
        return False


def get_info(url):
    data = api_request("GET", "/api/v1/info?url=" + urllib.parse.quote(url, safe=""))
    return {
        "id": data.get("video_id"),
        "title": data.get("title"),
        "uploader": data.get("author"),
        "duration": data.get("duration"),
        "thumbnail": data.get("thumbnail_url"),
        "view_count": data.get("view_count"),
        "upload_date": data.get("upload_date"),
        "description": data.get("description"),
        "extractor": "youtube",
    }


def get_formats(url):
    data = api_request("GET", "/api/v1/formats?url=" + urllib.parse.quote(url, safe=""))
    out = []
    for f in data.get("formats") or []:
        out.append({
            "format_id": f.get("format_id"),
            "ext": f.get("ext"),
            "resolution": f.get("resolution"),
            "filesize": f.get("filesize"),
            "abr": f.get("abr"),
            "vcodec": f.get("vcodec"),
            "acodec": f.get("acodec"),
        })
    return out


def get_transcript(url, lang="en"):
    q = ("/api/v1/transcript?url=" + urllib.parse.quote(url, safe="") +
         "&lang=" + urllib.parse.quote(lang or "en", safe="") + "&fmt=text")
    return api_request("GET", q)


def download(url, opts=None):
    opts = opts or {}
    body = {"url": url, "async": False}
    if opts.get("format_id"):
        body["format_id"] = opts["format_id"]
    if opts.get("extract_audio"):
        body["extract_audio"] = True
    if opts.get("audio_format"):
        body["audio_format"] = opts["audio_format"]
    data = api_request("POST", "/api/v1/download", body)
    if not data or not data.get("file_path"):
        raise ApiError("API download returned no file")
    return {
        "file_path": data.get("file_path"),
        "file_size": data.get("file_size"),
        "format_id": data.get("format_id"),
    }


def download_to_dir(url, opts, dest_dir, base_name):
    result = download(url, opts)
    src_path = result["file_path"]
    if not os.path.exists(src_path):
        raise ApiError("API file not found: " + src_path)
    ext = os.path.splitext(src_path)[1] or ".mp4"
    dest_path = os.path.join(dest_dir, base_name + ext)
    shutil.copyfile(src_path, dest_path)
    return dest_path
