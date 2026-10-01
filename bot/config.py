import os

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

BOT_TOKEN = os.environ.get("BOT_TOKEN") or "8745548411:AAHcUPwcbVf9eXTc4dxDZrLTdxmhCDRbl3E"
ADMIN_IDS = []
MAX_SIZE = "48M"

YT_API_URL = os.environ.get("YT_API_URL") or "http://127.0.0.1:8000"
YT_API_KEY = os.environ.get("YT_API_KEY") or "changeme"
YT_API_ENABLED = os.environ.get("YT_API_ENABLED", "true").lower() != "false"

YOUTUBE_COOKIES_FILE = os.environ.get("YOUTUBE_COOKIES_FILE") or ""
YOUTUBE_PO_TOKEN = os.environ.get("YOUTUBE_PO_TOKEN") or ""

DL_DIR = os.path.join(BASE_DIR, "downloads")
