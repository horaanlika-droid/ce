"""Runtime configuration.

Deliberately minimal: on BotHost you only need to set
  TELEGRAM_BOT_TOKEN   — token from @BotFather
  ADMIN_ID             — your Telegram numeric ID (admin chat)
  ADMIN_PASSWORD       — password for additional editors/staff (optional)

Everything else (port, database path, media folder, public URL) is detected
automatically, so the panel stays clean.
"""
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent
ROOT_DIR = BASE_DIR.parent


def _load_dotenv() -> None:
    """Minimal .env loader (local development only)."""
    for candidate in (ROOT_DIR / ".env", BASE_DIR / ".env"):
        if not candidate.exists():
            continue
        for raw in candidate.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


_load_dotenv()


def _first(*names: str, default: str = "") -> str:
    for name in names:
        value = os.getenv(name)
        if value:
            return value.strip()
    return default


# ------------------------------------------------------------------ telegram
BOT_TOKEN = _first("TELEGRAM_BOT_TOKEN", "BOT_TOKEN", "TELEGRAM_TOKEN", "TG_TOKEN")
ADMIN_PASSWORD = _first("ADMIN_PASSWORD", "BOT_PASSWORD", "PASSWORD")

_admin_raw = _first("ADMIN_ID", "ADMIN_IDS", "TELEGRAM_ADMIN_ID", "OWNER_ID")
ADMIN_IDS: list[int] = [int(x) for x in _admin_raw.replace(" ", "").split(",") if x.lstrip("-").isdigit()]
ADMIN_ID = ADMIN_IDS[0] if ADMIN_IDS else 0

# --------------------------------------------------------------------- http
HOST = _first("HOST", default="0.0.0.0")
PORT = int(_first("PORT", "SERVER_PORT", default="8080"))

# ------------------------------------------------------------------ storage
DB_PATH = Path(_first("DB_PATH", default=str(BASE_DIR / "data" / "embassy.db")))
MEDIA_DIR = Path(_first("MEDIA_DIR", default=str(BASE_DIR / "media")))


def _default_seed() -> Path:
    for candidate in (BASE_DIR / "seed.json", ROOT_DIR / "data" / "content.json"):
        if candidate.exists():
            return candidate
    return ROOT_DIR / "data" / "content.json"


SEED_PATH = Path(_first("SEED_PATH", default=str(_default_seed())))

# ------------------------------------------------------------------ public url
def _detect_public_url() -> str:
    explicit = _first("PUBLIC_API_URL", "API_URL", "PUBLIC_URL", "SERVER_URL")
    if explicit:
        return explicit.rstrip("/")
    domain = _first("BOTHOST_DOMAIN", "RAILWAY_PUBLIC_DOMAIN", "RENDER_EXTERNAL_URL", "FLY_APP_NAME")
    if not domain:
        return ""
    if domain.startswith("http"):
        return domain.rstrip("/")
    return f"https://{domain}".rstrip("/")


PUBLIC_API_URL = _detect_public_url()
STOREFRONT_URL = _first("STOREFRONT_URL", default="https://horaanlika-droid.github.io/ce").rstrip("/")

CORS_ORIGINS = [o.strip() for o in _first("CORS_ORIGINS", default="*").split(",") if o.strip()]

RUN_BOT = bool(BOT_TOKEN) and _first("RUN_BOT", default="1").lower() not in ("0", "false", "no")
MAX_UPLOAD_MB = int(_first("MAX_UPLOAD_MB", default="12"))
AUTH_TTL_HOURS = int(_first("AUTH_TTL_HOURS", default="72"))


def summary() -> str:
    return (
        f"bot={'on' if BOT_TOKEN else 'OFF'} admin_ids={ADMIN_IDS or 'not set'} "
        f"password={'set' if ADMIN_PASSWORD else 'not set'} port={PORT} "
        f"db={DB_PATH} media={MEDIA_DIR}"
    )
