"""Cocktail Embassy — API + Telegram back office (single process for BotHost & local preview)."""
from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import logging
import re
import secrets
import time
import uuid
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, field_validator

import db
import settings as cfg

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
log = logging.getLogger("embassy")

# ------------------------------------------------------------------ admin auth
_ADMIN_TOKENS: dict[str, float] = {}   # token -> expiry timestamp
_ADMIN_TTL_SECONDS = 60 * 60 * 24      # 24 h session
_DEFAULT_WEB_PASSWORD = "embassy2026"


def _verify_web_password(password: str) -> bool:
    clean = (password or "").strip()
    if not clean:
        return False
    custom_hash = db.get_setting("_web_admin_pw_hash", "")
    if isinstance(custom_hash, str) and len(custom_hash) == 64:
        digest = hashlib.sha256(clean.encode("utf-8")).hexdigest()
        return hmac.compare_digest(digest, custom_hash)
    expected = cfg.ADMIN_PASSWORD or _DEFAULT_WEB_PASSWORD
    return hmac.compare_digest(clean.encode("utf-8"), expected.encode("utf-8"))


def _require_admin(request: Request) -> None:
    """401 unless a valid admin session token is presented."""
    auth = request.headers.get("authorization", "")
    if not auth.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="admin login required")
    token = auth[7:]
    expiry = _ADMIN_TOKENS.get(token)
    if not expiry or time.time() > expiry:
        _ADMIN_TOKENS.pop(token, None)
        raise HTTPException(status_code=401, detail="admin session expired")


def _issue_admin_token() -> str:
    token = secrets.token_urlsafe(24)
    _ADMIN_TOKENS[token] = time.time() + _ADMIN_TTL_SECONDS
    return token


class RequestItem(BaseModel):
    slug: str = Field(min_length=1, max_length=120)
    name: str = Field(default="", max_length=200)
    qty: int = Field(default=1, ge=1, le=999)
    price: float | None = None


class RequestIn(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    company: str = Field(default="", max_length=160)
    email: str = Field(min_length=3, max_length=160)
    phone: str = Field(default="", max_length=60)
    country: str = Field(default="", max_length=80)
    city: str = Field(default="", max_length=80)
    address: str = Field(default="", max_length=240)
    taxId: str = Field(default="", max_length=40)
    delivery: str = Field(default="", max_length=32)
    payment: str = Field(default="", max_length=32)
    shipping: float | None = None
    note: str = Field(default="", max_length=2000)
    items: list[RequestItem] = Field(min_length=1, max_length=100)
    total: float | None = None
    currency: str = Field(default="AED", max_length=8)
    source: str = Field(default="web", max_length=32)

    @field_validator("email")
    @classmethod
    def valid_email(cls, value: str) -> str:
        if "@" not in value or "." not in value.split("@")[-1]:
            raise ValueError("Invalid email address")
        return value.strip()


class RequestOut(BaseModel):
    ok: bool = True
    id: int
    reference: str


@asynccontextmanager
async def lifespan(app: FastAPI):
    db.init_db()
    cfg.MEDIA_DIR.mkdir(parents=True, exist_ok=True)

    bot_task = None
    if cfg.RUN_BOT and cfg.BOT_TOKEN:
        import telegram_bot

        bot_task = asyncio.create_task(telegram_bot.run_polling())
        log.info("Telegram polling started")
    elif cfg.RUN_BOT:
        log.warning("TELEGRAM_BOT_TOKEN is empty — running API only")

    yield

    if bot_task:
        bot_task.cancel()
        try:
            await bot_task
        except (asyncio.CancelledError, Exception):  # noqa: BLE001
            pass


app = FastAPI(title="Cocktail Embassy API", version="1.1.0", lifespan=lifespan)

cfg.MEDIA_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/media", StaticFiles(directory=str(cfg.MEDIA_DIR)), name="media")

app.add_middleware(
    CORSMiddleware,
    allow_origins=cfg.CORS_ORIGINS,
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allow_headers=["*"],
)


@app.middleware("http")
async def no_store(request: Request, call_next):
    response = await call_next(request)
    p = request.url.path
    if p.startswith("/api/"):
        response.headers["Cache-Control"] = "no-store, max-age=0"
    elif p.startswith(("/glasses/", "/covers/", "/packaging/")):
        response.headers["Cache-Control"] = "no-cache"
    return response


_FOLDER_IMG_EXTS = {".webp", ".png", ".jpg", ".jpeg", ".avif", ".gif"}
_PACKAGING_CATS = {"acids", "essences"}
_SITE_COVERS = (
    ("homeCraft", "covers/home-craft"),
    ("infoBanner", "covers/info-banner"),
    ("infoStory", "covers/info-story"),
    ("ogShare", "covers/og-share"),
    ("announcementImage", "covers/announcement"),
)
_SHA_CACHE: dict[str, tuple[int, int, str]] = {}
_DEFAULTS_CACHE: tuple[int, dict[str, str]] | None = None


def _load_folder_defaults() -> dict[str, str]:
    global _DEFAULTS_CACHE
    p = cfg.ROOT_DIR / "data" / "folder-defaults.json"
    if not p.is_file():
        return {}
    st = p.stat()
    if _DEFAULTS_CACHE and _DEFAULTS_CACHE[0] == st.st_mtime_ns:
        return _DEFAULTS_CACHE[1]
    try:
        data = json.loads(p.read_text(encoding="utf-8"))
        if isinstance(data, dict):
            _DEFAULTS_CACHE = (st.st_mtime_ns, data)
            return data
    except Exception:
        pass
    return {}


def _git_sha(path: Path) -> str:
    st = path.stat()
    key = str(path)
    cached = _SHA_CACHE.get(key)
    if cached and cached[0] == st.st_mtime_ns and cached[1] == st.st_size:
        return cached[2]
    raw = path.read_bytes()
    sha = hashlib.sha1(f"blob {len(raw)}\0".encode("utf-8") + raw).hexdigest()
    _SHA_CACHE[key] = (st.st_mtime_ns, st.st_size, sha)
    return sha


def _natural_key(name: str) -> tuple:
    low = name.lower()
    stem = Path(low).stem
    prio = 0 if stem in ("photo", "cover", "main", "1", "01", "wide") else 1
    parts = [int(t) if t.isdigit() else t for t in re.split(r"(\d+)", low)]
    return (prio, parts)


def _versioned_rel(path: Path, defaults: dict[str, str]) -> str:
    rel = path.relative_to(cfg.ROOT_DIR).as_posix()
    sha = _git_sha(path)
    if defaults.get(rel) == sha:
        return rel
    return f"{rel}?v={sha[:8]}"


def _pick_folder_images(folder: Path, defaults: dict[str, str]) -> list[str]:
    if not folder.is_dir():
        return []
    files = [
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in _FOLDER_IMG_EXTS and not p.name.startswith(".")
    ]
    if not files:
        return []
    files.sort(key=lambda p: _natural_key(p.name))
    if len(files) > 1 and defaults:
        custom = [p for p in files if defaults.get(p.relative_to(cfg.ROOT_DIR).as_posix()) != _git_sha(p)]
        if custom:
            files = custom
    return [_versioned_rel(p, defaults) for p in files]


def _pick_hero_images(folder: Path, defaults: dict[str, str]) -> tuple[str, str]:
    if not folder.is_dir():
        return ("", "")
    files = [
        p for p in folder.iterdir()
        if p.is_file() and p.suffix.lower() in _FOLDER_IMG_EXTS and not p.name.startswith(".")
    ]
    if not files:
        return ("", "")
    is_port = lambda p: any(tok in p.stem.lower() for tok in ("portrait", "mobile", "tall"))
    portraits = sorted([p for p in files if is_port(p)], key=lambda p: _natural_key(p.name))
    mains = sorted([p for p in files if not is_port(p)], key=lambda p: _natural_key(p.name))

    if len(mains) > 1 and defaults:
        custom_m = [p for p in mains if defaults.get(p.relative_to(cfg.ROOT_DIR).as_posix()) != _git_sha(p)]
        if custom_m:
            mains = custom_m
    if not mains:
        return (_versioned_rel(portraits[0], defaults), "")

    main_p = mains[0]
    if not portraits:
        return (_versioned_rel(main_p, defaults), "")

    if len(portraits) > 1 and defaults:
        custom_p = [p for p in portraits if defaults.get(p.relative_to(cfg.ROOT_DIR).as_posix()) != _git_sha(p)]
        if custom_p:
            portraits = custom_p
    port_p = portraits[0]
    if defaults:
        m_rel = main_p.relative_to(cfg.ROOT_DIR).as_posix()
        p_rel = port_p.relative_to(cfg.ROOT_DIR).as_posix()
        if defaults.get(m_rel) != _git_sha(main_p) and defaults.get(p_rel) == _git_sha(port_p):
            return (_versioned_rel(main_p, defaults), "")
    return (_versioned_rel(main_p, defaults), _versioned_rel(port_p, defaults))


def _apply_repo_folders(payload: dict[str, Any]) -> dict[str, Any]:
    if not (cfg.ROOT_DIR / "glasses").is_dir():
        return payload
    defaults = _load_folder_defaults()
    for product in payload.get("products") or []:
        imgs = product.get("images") or []
        if any(str(u).startswith(("data:", "/media/")) for u in imgs):
            continue
        top = "packaging" if product.get("categorySlug") in _PACKAGING_CATS else "glasses"
        found = _pick_folder_images(cfg.ROOT_DIR / top / str(product.get("slug", "")), defaults)
        if found:
            product["images"] = found

    for cat in payload.get("categories") or []:
        cov = str(cat.get("cover") or "")
        if cov.startswith(("data:", "/media/")):
            continue
        found = _pick_folder_images(cfg.ROOT_DIR / "covers" / f"category-{cat.get('slug', '')}", defaults)
        if found:
            cat["cover"] = found[0]

    settings = payload.setdefault("settings", {})
    for slide in settings.get("hero") or []:
        slug = slide.get("productSlug") or ""
        if not slug:
            continue
        cover, portrait = _pick_hero_images(cfg.ROOT_DIR / "covers" / f"hero-{slug}", defaults)
        if cover:
            slide["cover"] = cover
        else:
            slide.pop("cover", None)
        if portrait:
            slide["portraitCover"] = portrait
        else:
            slide.pop("portraitCover", None)

    covers_map = dict(settings.get("covers") or {})
    for key, rel_dir in _SITE_COVERS:
        found = _pick_folder_images(cfg.ROOT_DIR / rel_dir, defaults)
        if found:
            covers_map[key] = found[0]
    settings["covers"] = covers_map
    return payload


@app.get("/api/health")
async def health() -> dict[str, Any]:
    return {
        "ok": True,
        "products": len(db.list_products()),
        "requests": db.request_counts(),
        "bot": bool(cfg.BOT_TOKEN),
    }


@app.get("/api/content")
async def content() -> JSONResponse:
    return JSONResponse(_apply_repo_folders(db.get_content()))


def _shipping_for(settings: dict, delivery: str, subtotal: float) -> float:
    methods = settings.get("deliveryMethods") or []
    method = next((m for m in methods if m.get("id") == delivery), None)
    if not method:
        return 0.0
    fee = float(method.get("fee") or 0)
    threshold = float(settings.get("freeShippingFrom") or 0)
    if method.get("id") == "pickup" or fee <= 0:
        return 0.0
    if threshold and subtotal >= threshold:
        return 0.0
    return fee


@app.post("/api/requests", response_model=RequestOut)
async def create_request(payload: RequestIn) -> RequestOut:
    products = {p["slug"]: p for p in db.list_products()}
    items: list[dict[str, Any]] = []
    total = 0.0
    for item in payload.items:
        product = products.get(item.slug)
        price = float(product["price"]) if product else float(item.price or 0)
        name = product["name"] if product else item.name
        items.append(
            {
                "slug": item.slug,
                "name": name,
                "qty": item.qty,
                "price": price,
                "sum": round(price * item.qty, 2),
            }
        )
        total += price * item.qty

    settings = db.all_settings()
    subtotal = round(total if total else float(payload.total or 0), 2)
    shipping = _shipping_for(settings, payload.delivery, subtotal)

    record = db.create_request(
        {
            "name": payload.name.strip(),
            "company": payload.company.strip(),
            "email": payload.email.strip(),
            "phone": payload.phone.strip(),
            "country": payload.country.strip(),
            "city": payload.city.strip(),
            "address": payload.address.strip(),
            "taxId": payload.taxId.strip(),
            "delivery": payload.delivery.strip(),
            "payment": payload.payment.strip(),
            "shipping": shipping,
            "note": payload.note.strip(),
            "items": items,
            "total": subtotal,
            "currency": payload.currency,
        }
    )
    log.info("New request %s from %s (%s items)", record["reference"], record["email"], len(items))

    if cfg.RUN_BOT and cfg.BOT_TOKEN:
        try:
            import telegram_bot

            asyncio.create_task(telegram_bot.notify_new_request(record))
        except Exception as exc:  # noqa: BLE001
            log.warning("Bot notification failed: %s", exc)

    return RequestOut(id=record["id"], reference=record["reference"])


# ================================================================ admin API

class AdminLoginIn(BaseModel):
    password: str


class AdminPasswordChangeIn(BaseModel):
    currentPassword: str
    newPassword: str = Field(min_length=4, max_length=200)


class SettingsIn(BaseModel):
    key: str
    value: Any


class BulkSettingsIn(BaseModel):
    settings: dict[str, Any]


class UploadImageIn(BaseModel):
    filename: str = Field(default="photo.webp", max_length=200)
    dataUrl: str


@app.post("/api/admin/login")
async def admin_login(payload: AdminLoginIn) -> JSONResponse:
    if not _verify_web_password(payload.password):
        raise HTTPException(status_code=401, detail="Неверный пароль")
    return JSONResponse({"ok": True, "token": _issue_admin_token()})


@app.post("/api/admin/password")
async def admin_change_password(payload: AdminPasswordChangeIn, request: Request) -> JSONResponse:
    _require_admin(request)
    if not _verify_web_password(payload.currentPassword):
        raise HTTPException(status_code=400, detail="Текущий пароль указан неверно")
    digest = hashlib.sha256(payload.newPassword.strip().encode("utf-8")).hexdigest()
    db.set_setting("_web_admin_pw_hash", digest)
    return JSONResponse({"ok": True})


@app.get("/api/admin/content")
async def admin_content(request: Request) -> JSONResponse:
    _require_admin(request)
    return JSONResponse(db.get_content())


@app.put("/api/admin/settings")
async def admin_set_setting(payload: SettingsIn, request: Request) -> JSONResponse:
    _require_admin(request)
    if str(payload.key).startswith("_"):
        raise HTTPException(status_code=400, detail="Invalid setting key")
    db.set_setting(payload.key, payload.value)
    return JSONResponse({"ok": True})


@app.put("/api/admin/settings/bulk")
async def admin_set_settings_bulk(payload: BulkSettingsIn, request: Request) -> JSONResponse:
    _require_admin(request)
    for key, value in payload.settings.items():
        if not str(key).startswith("_"):
            db.set_setting(key, value)
    return JSONResponse({"ok": True})


@app.post("/api/admin/upload")
async def admin_upload_image(payload: UploadImageIn, request: Request) -> JSONResponse:
    _require_admin(request)
    m = re.match(r"^data:image/(webp|png|jpe?g);base64,(.+)$", payload.dataUrl.strip(), re.IGNORECASE)
    if not m:
        raise HTTPException(status_code=400, detail="Поддерживаются изображения WebP, PNG или JPEG")
    ext = m.group(1).lower()
    if ext == "jpeg":
        ext = "jpg"
    try:
        raw = base64.b64decode(m.group(2))
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail="Повреждённые данные изображения") from exc
    if len(raw) > cfg.MAX_UPLOAD_MB * 1024 * 1024:
        raise HTTPException(status_code=413, detail=f"Файл превышает {cfg.MAX_UPLOAD_MB} МБ")
    fname = f"upload-{uuid.uuid4().hex[:12]}.{ext}"
    out_path = cfg.MEDIA_DIR / fname
    out_path.write_bytes(raw)
    return JSONResponse({"ok": True, "url": f"/media/{fname}"})


@app.put("/api/admin/products/{slug}")
async def admin_update_product(slug: str, payload: dict, request: Request) -> JSONResponse:
    _require_admin(request)
    db.upsert_product(
        slug=slug,
        name=payload.get("name", ""),
        subtitle=payload.get("subtitle", ""),
        description=payload.get("description", ""),
        price=float(payload.get("price") or 0),
        volume=payload.get("volume", ""),
        category_slug=payload.get("categorySlug", ""),
        badge=payload.get("badge", ""),
        featured=bool(payload.get("featured")),
        in_stock=bool(payload.get("inStock", True)),
        coming_soon=bool(payload.get("comingSoon", False)),
        sort=int(payload.get("sort") or 0),
        images=payload.get("images", []),
        collections=payload.get("collectionSlugs", []),
        specs=payload.get("specs", {}),
    )
    return JSONResponse({"ok": True})


@app.post("/api/admin/products")
async def admin_create_product(payload: dict, request: Request) -> JSONResponse:
    _require_admin(request)
    base_slug = db.slugify(payload.get("slug") or payload.get("name", "item"))
    slug = db.unique_slug("products", base_slug)
    db.upsert_product(
        slug=slug,
        name=payload.get("name", ""),
        subtitle=payload.get("subtitle", ""),
        description=payload.get("description", ""),
        price=float(payload.get("price") or 0),
        volume=payload.get("volume", ""),
        category_slug=payload.get("categorySlug", ""),
        badge=payload.get("badge", ""),
        featured=bool(payload.get("featured")),
        in_stock=bool(payload.get("inStock", True)),
        coming_soon=bool(payload.get("comingSoon", False)),
        sort=int(payload.get("sort") or db.next_sort("product")),
        images=payload.get("images", []),
        collections=payload.get("collectionSlugs", []),
        specs=payload.get("specs", {}),
    )
    return JSONResponse({"ok": True, "slug": slug})


@app.delete("/api/admin/products/{slug}")
async def admin_delete_product(slug: str, request: Request) -> JSONResponse:
    _require_admin(request)
    db.delete_product(slug)
    return JSONResponse({"ok": True})


@app.put("/api/admin/categories/{slug}")
async def admin_update_category(slug: str, payload: dict, request: Request) -> JSONResponse:
    _require_admin(request)
    target_slug = db.slugify(payload.get("slug") or slug)
    db.upsert_category(
        slug=target_slug,
        name=payload.get("name", ""),
        blurb=payload.get("blurb", ""),
        sort=int(payload.get("sort") or 0),
        cover=payload.get("cover", ""),
    )
    if target_slug != slug:
        conn = db.get_conn()
        with db._lock:
            conn.execute("UPDATE products SET category_slug = ? WHERE category_slug = ?", (target_slug, slug))
            conn.execute("DELETE FROM categories WHERE slug = ?", (slug,))
            conn.commit()
    return JSONResponse({"ok": True, "slug": target_slug})


@app.delete("/api/admin/categories/{slug}")
async def admin_delete_category(slug: str, request: Request) -> JSONResponse:
    _require_admin(request)
    db.delete_category(slug)
    return JSONResponse({"ok": True})


@app.put("/api/admin/collections/{slug}")
async def admin_update_collection(slug: str, payload: dict, request: Request) -> JSONResponse:
    _require_admin(request)
    db.upsert_collection(
        slug=slug,
        name=payload.get("name", ""),
        subtitle=payload.get("subtitle", ""),
        description=payload.get("description", ""),
        image=payload.get("image", ""),
        sort=int(payload.get("sort") or 0),
    )
    return JSONResponse({"ok": True})


@app.get("/api/admin/requests")
async def admin_list_requests(request: Request, status: str | None = None) -> JSONResponse:
    _require_admin(request)
    return JSONResponse(db.list_requests(status=status))


@app.post("/api/admin/requests/{request_id}/status")
async def admin_set_request_status(
    request: Request, request_id: int, payload: dict
) -> JSONResponse:
    _require_admin(request)
    db.set_request_status(request_id, payload.get("status", "new"))
    return JSONResponse({"ok": True})


@app.exception_handler(ValueError)
async def value_error_handler(_: Request, exc: ValueError) -> JSONResponse:
    return JSONResponse(status_code=422, content={"detail": str(exc)})


# ---------------------------------------------------- storefront static mount
_INDEX_FILE = cfg.ROOT_DIR / "index.html"
if _INDEX_FILE.exists():
    for _dir_name in ("css", "js", "assets", "data", "glasses", "covers", "packaging"):
        _dir_path = cfg.ROOT_DIR / _dir_name
        if _dir_path.is_dir():
            app.mount(f"/{_dir_name}", StaticFiles(directory=str(_dir_path)), name=f"static-{_dir_name}")

    @app.get("/")
    async def storefront_index() -> FileResponse:
        return FileResponse(_INDEX_FILE, headers={"Cache-Control": "no-cache"})

    @app.get("/index.html")
    async def storefront_index_file() -> FileResponse:
        return FileResponse(_INDEX_FILE, headers={"Cache-Control": "no-cache"})

    @app.get("/sw.js")
    async def storefront_sw() -> FileResponse:
        return FileResponse(cfg.ROOT_DIR / "sw.js", media_type="application/javascript", headers={"Cache-Control": "no-cache"})

    @app.get("/manifest.webmanifest")
    async def storefront_manifest() -> FileResponse:
        return FileResponse(cfg.ROOT_DIR / "manifest.webmanifest", media_type="application/manifest+json")
else:
    @app.get("/")
    async def index() -> dict[str, Any]:
        return {
            "service": "Cocktail Embassy API",
            "status": "ok",
            "endpoints": ["/api/content", "/api/requests", "/api/health", "/media/<file>"],
        }


def main() -> None:
    if not cfg.BOT_TOKEN:
        log.warning("TELEGRAM_BOT_TOKEN is not set. The admin bot will not start.")
    log.info("Starting API on %s:%s", cfg.HOST, cfg.PORT)
    uvicorn.run("main:app", host=cfg.HOST, port=cfg.PORT, log_level="info", proxy_headers=True)


if __name__ == "__main__":
    main()
