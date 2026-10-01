import re

PLATFORMS = [
    {"id": "youtube", "tag": "\U0001F4FA YouTube", "pattern": r"youtube\.com|youtu\.be", "extractor_args": []},
    {"id": "tiktok", "tag": "\U0001F3B5 TikTok", "pattern": r"tiktok\.com", "extractor_args": []},
    {"id": "facebook", "tag": "\U0001F4D8 Facebook", "pattern": r"facebook\.com|fb\.watch|fb\.com", "extractor_args": []},
    {"id": "instagram", "tag": "\U0001F4F8 Instagram", "pattern": r"instagram\.com", "extractor_args": []},
    {"id": "twitter", "tag": "\U0001F426 X (Twitter)", "pattern": r"twitter\.com|x\.com", "extractor_args": []},
    {"id": "pinterest", "tag": "\U0001F4CC Pinterest", "pattern": r"pinterest\.com|pin\.it", "extractor_args": []},
    {"id": "linkedin", "tag": "\U0001F4BC LinkedIn", "pattern": r"linkedin\.com|lnkd\.in", "extractor_args": []},
]

GENERIC = {"id": "generic", "tag": "\U0001F517 Video", "extractor_args": []}


def detect_platform(url):
    try:
        for p in PLATFORMS:
            if re.search(p["pattern"], url, re.I):
                return p
    except Exception:
        pass
    return GENERIC


def is_youtube_url(url):
    try:
        from urllib.parse import urlparse
        host = urlparse(url).hostname.lower().replace("www.", "", 1) if urlparse(url).hostname else ""
        return host == "youtube.com" or host == "youtu.be" or host.endswith(".youtube.com")
    except Exception:
        return False
