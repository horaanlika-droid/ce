"""SQLite storage for the catalogue, site settings and incoming requests."""
from __future__ import annotations

import json
import re
import sqlite3
import threading
from datetime import datetime, timezone
from typing import Any, Iterable

from settings import DB_PATH, SEED_PATH

_lock = threading.RLock()
_conn: sqlite3.Connection | None = None

DEFAULT_SETTINGS: dict[str, Any] = {
    "brand": "Cocktail Embassy",
    "tagline": "Hand-blown glassware for the modern bar.",
    "announcement": "",
    "ticker": [
        "Hand-blown crystal · China",
        "52 pieces · six categories",
        "Trade prices in AED",
        "Bars · hotels · studios",
        "Dubai · HoReCa supply",
        "Worldwide delivery from Dubai",
        "Dispatch in 2–4 days",
        "Breakage replaced free",
    ],
    "marquee": [
        "Hand-blown *crystal*",
        "52 pieces · six categories",
        "Bars, hotels & *studios*",
        "Trade prices in *AED*",
        "Dubai",
        "Worldwide *delivery*",
        "Breakage replaced *free*",
    ],
    "currency": "AED",
    "locale": "en-AE",
    "priceNote": "Prices exclude VAT & shipping",
    "requestNote": "No online payment — submit a request and our team confirms availability, shipping and final invoicing within one business day.",
    "shippingNote": "Dispatch in 2–4 business days.",
    "freeShippingFrom": 750,
    "shippingCost": 45,
    "deliveryMethods": [
        {"id": "courier", "name": "Courier · Dubai", "note": "Next business day", "fee": 45},
        {"id": "freight", "name": "Freight · GCC & worldwide", "note": "Quoted per pallet", "fee": 0},
        {"id": "pickup", "name": "Pickup · our warehouse", "note": "Free, by appointment", "fee": 0},
    ],
    "paymentMethods": [
        {"id": "transfer", "name": "Bank transfer", "note": "Invoice on confirmation"},
        {"id": "card", "name": "Card link", "note": "Secure link by email"},
        {"id": "account", "name": "Trade account", "note": "Net 30 for approved accounts"},
    ],
    "returnsNote": "Breakage in transit is replaced free of charge.",
    "about": "",
    "contacts": {
        "email": "",
        "phone": "",
        "whatsapp": "",
        "telegram": "",
        "instagram": "",
        "address": "",
        "hours": "",
    },
    "hero": [],
}


# --------------------------------------------------------------------- setup
def get_conn() -> sqlite3.Connection:
    global _conn
    with _lock:
        if _conn is None:
            DB_PATH.parent.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(DB_PATH, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.execute("PRAGMA journal_mode=WAL")
            _conn.execute("PRAGMA foreign_keys=ON")
        return _conn


SCHEMA = """
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    blurb TEXT DEFAULT '',
    sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS collections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    subtitle TEXT DEFAULT '',
    description TEXT DEFAULT '',
    image TEXT DEFAULT '',
    sort INTEGER DEFAULT 0
);
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    slug TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    subtitle TEXT DEFAULT '',
    description TEXT DEFAULT '',
    price REAL DEFAULT 0,
    volume TEXT DEFAULT '',
    category_slug TEXT DEFAULT '',
    badge TEXT DEFAULT '',
    featured INTEGER DEFAULT 0,
    in_stock INTEGER DEFAULT 1,
    sort INTEGER DEFAULT 0,
    images TEXT DEFAULT '[]',
    collections TEXT DEFAULT '[]',
    specs TEXT DEFAULT '{}'
);
CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    reference TEXT UNIQUE NOT NULL,
    created_at TEXT NOT NULL,
    name TEXT DEFAULT '',
    company TEXT DEFAULT '',
    email TEXT DEFAULT '',
    phone TEXT DEFAULT '',
    country TEXT DEFAULT '',
    city TEXT DEFAULT '',
    address TEXT DEFAULT '',
    tax_id TEXT DEFAULT '',
    delivery TEXT DEFAULT '',
    payment TEXT DEFAULT '',
    shipping REAL DEFAULT 0,
    note TEXT DEFAULT '',
    items TEXT DEFAULT '[]',
    total REAL DEFAULT 0,
    currency TEXT DEFAULT 'AED',
    status TEXT DEFAULT 'new',
    notified INTEGER DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(status, id DESC);
CREATE TABLE IF NOT EXISTS staff (
    user_id INTEGER PRIMARY KEY,
    username TEXT DEFAULT '',
    full_name TEXT DEFAULT '',
    granted_at TEXT NOT NULL
);
"""


ORDER_STATUSES = ("new", "confirmed", "packing", "shipped", "delivered", "cancelled")

ORDER_COLUMNS = {
    "city": "TEXT DEFAULT ''",
    "address": "TEXT DEFAULT ''",
    "tax_id": "TEXT DEFAULT ''",
    "delivery": "TEXT DEFAULT ''",
    "payment": "TEXT DEFAULT ''",
    "shipping": "REAL DEFAULT 0",
}


def _migrate(conn: sqlite3.Connection) -> None:
    """Add newer columns to databases created before they existed."""
    have_req = {row["name"] for row in conn.execute("PRAGMA table_info(requests)").fetchall()}
    for column, decl in ORDER_COLUMNS.items():
        if column not in have_req:
            conn.execute(f"ALTER TABLE requests ADD COLUMN {column} {decl}")

    have_cat = {row["name"] for row in conn.execute("PRAGMA table_info(categories)").fetchall()}
    if "cover" not in have_cat:
        conn.execute("ALTER TABLE categories ADD COLUMN cover TEXT DEFAULT ''")

    have_prod = {row["name"] for row in conn.execute("PRAGMA table_info(products)").fetchall()}
    if "coming_soon" not in have_prod:
        conn.execute("ALTER TABLE products ADD COLUMN coming_soon INTEGER DEFAULT 0")

    conn.commit()


def init_db(seed: bool = True) -> None:
    conn = get_conn()
    with _lock:
        conn.executescript(SCHEMA)
        _migrate(conn)
        conn.commit()
        has_settings = conn.execute("SELECT COUNT(*) c FROM settings").fetchone()["c"]
    if seed and has_settings == 0:
        seed_database()


def seed_database() -> None:
    if not SEED_PATH.exists():
        for key, value in DEFAULT_SETTINGS.items():
            set_setting(key, value)
        return
    payload = json.loads(SEED_PATH.read_text(encoding="utf-8"))
    settings = payload.get("settings", {})
    for key, value in {**DEFAULT_SETTINGS, **settings}.items():
        set_setting(key, value)
    for index, category in enumerate(payload.get("categories", [])):
        upsert_category(
            slug=category["slug"],
            name=category["name"],
            blurb=category.get("blurb", ""),
            sort=category.get("sort", index),
            cover=category.get("cover", ""),
        )
    for index, product in enumerate(payload.get("products", [])):
        upsert_product(
            slug=product["slug"],
            name=product["name"],
            subtitle=product.get("subtitle", ""),
            description=product.get("description", ""),
            price=float(product.get("price") or 0),
            volume=product.get("volume", ""),
            category_slug=product.get("categorySlug", ""),
            badge=product.get("badge", ""),
            featured=bool(product.get("featured")),
            in_stock=product.get("inStock", True) is not False,
            coming_soon=bool(product.get("comingSoon")),
            sort=product.get("sort", index),
            images=product.get("images", []),
            collections=[],
            specs=product.get("specs", {}),
        )


# ------------------------------------------------------------------ helpers
def slugify(value: str) -> str:
    value = re.sub(r"[^a-zA-Z0-9\s-]", "", value or "").strip().lower()
    value = re.sub(r"[\s_-]+", "-", value)
    return value or "item"


def unique_slug(table: str, base: str) -> str:
    conn = get_conn()
    slug = base
    n = 2
    while conn.execute(f"SELECT 1 FROM {table} WHERE slug = ?", (slug,)).fetchone():
        slug = f"{base}-{n}"
        n += 1
    return slug


def _json(value: Any) -> str:
    return json.dumps(value, ensure_ascii=False)


def _loads(value: Any, fallback: Any) -> Any:
    try:
        return json.loads(value) if value else fallback
    except (TypeError, ValueError):
        return fallback


# ----------------------------------------------------------------- settings
def get_setting(key: str, default: Any = None) -> Any:
    conn = get_conn()
    row = conn.execute("SELECT value FROM settings WHERE key = ?", (key,)).fetchone()
    if not row:
        return DEFAULT_SETTINGS.get(key, default)
    return _loads(row["value"], row["value"])


def set_setting(key: str, value: Any) -> None:
    conn = get_conn()
    with _lock:
        conn.execute(
            "INSERT INTO settings(key, value) VALUES(?, ?) "
            "ON CONFLICT(key) DO UPDATE SET value = excluded.value",
            (key, _json(value)),
        )
        conn.commit()


def all_settings() -> dict[str, Any]:
    conn = get_conn()
    rows = conn.execute("SELECT key, value FROM settings").fetchall()
    result = dict(DEFAULT_SETTINGS)
    for row in rows:
        result[row["key"]] = _loads(row["value"], row["value"])
    return result


# --------------------------------------------------------------- categories
def list_categories() -> list[dict]:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM categories ORDER BY sort, id").fetchall()
    return [dict(r) for r in rows]


def upsert_category(slug: str, name: str, blurb: str = "", sort: int = 0, cover: str = "") -> int:
    conn = get_conn()
    with _lock:
        conn.execute(
            "INSERT INTO categories(slug, name, blurb, sort, cover) VALUES(?,?,?,?,?) "
            "ON CONFLICT(slug) DO UPDATE SET name=excluded.name, blurb=excluded.blurb, sort=excluded.sort, cover=excluded.cover",
            (slug, name, blurb, sort, cover or ""),
        )
        conn.commit()
        row = conn.execute("SELECT id FROM categories WHERE slug = ?", (slug,)).fetchone()
    return int(row["id"])


def delete_category(slug: str) -> None:
    conn = get_conn()
    with _lock:
        conn.execute("DELETE FROM categories WHERE slug = ?", (slug,))
        conn.execute("UPDATE products SET category_slug = '' WHERE category_slug = ?", (slug,))
        conn.commit()


# -------------------------------------------------------------- collections
def list_collections() -> list[dict]:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM collections ORDER BY sort, id").fetchall()
    return [dict(r) for r in rows]


def upsert_collection(
    slug: str,
    name: str,
    subtitle: str = "",
    description: str = "",
    image: str = "",
    sort: int = 0,
) -> int:
    conn = get_conn()
    with _lock:
        conn.execute(
            "INSERT INTO collections(slug, name, subtitle, description, image, sort) VALUES(?,?,?,?,?,?) "
            "ON CONFLICT(slug) DO UPDATE SET name=excluded.name, subtitle=excluded.subtitle, "
            "description=excluded.description, image=excluded.image, sort=excluded.sort",
            (slug, name, subtitle, description, image, sort),
        )
        conn.commit()
        row = conn.execute("SELECT id FROM collections WHERE slug = ?", (slug,)).fetchone()
    return int(row["id"])


def delete_collection(slug: str) -> None:
    conn = get_conn()
    with _lock:
        conn.execute("DELETE FROM collections WHERE slug = ?", (slug,))
        conn.commit()
    for product in list_products():
        if slug in product["collectionSlugs"]:
            set_product_collections(product["slug"], [s for s in product["collectionSlugs"] if s != slug])


# ----------------------------------------------------------------- products
def _product_to_dict(row: sqlite3.Row) -> dict:
    keys = row.keys()
    out = {
        "id": row["id"],
        "slug": row["slug"],
        "name": row["name"],
        "subtitle": row["subtitle"],
        "description": row["description"],
        "price": row["price"],
        "volume": row["volume"],
        "categorySlug": row["category_slug"],
        "collectionSlugs": _loads(row["collections"], []),
        "badge": row["badge"],
        "featured": bool(row["featured"]),
        "inStock": bool(row["in_stock"]),
        "sort": row["sort"],
        "images": _loads(row["images"], []),
        "specs": _loads(row["specs"], {}),
    }
    if "coming_soon" in keys and bool(row["coming_soon"]):
        out["comingSoon"] = True
    return out


def list_products() -> list[dict]:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM products ORDER BY sort, id").fetchall()
    return [_product_to_dict(r) for r in rows]


def get_product(slug: str) -> dict | None:
    conn = get_conn()
    row = conn.execute("SELECT * FROM products WHERE slug = ?", (slug,)).fetchone()
    return _product_to_dict(row) if row else None


def get_product_by_id(product_id: int) -> dict | None:
    conn = get_conn()
    row = conn.execute("SELECT * FROM products WHERE id = ?", (product_id,)).fetchone()
    return _product_to_dict(row) if row else None


def upsert_product(
    slug: str,
    name: str,
    subtitle: str = "",
    description: str = "",
    price: float = 0,
    volume: str = "",
    category_slug: str = "",
    badge: str = "",
    featured: bool = False,
    in_stock: bool = True,
    sort: int = 0,
    images: Iterable[str] | None = None,
    collections: Iterable[str] | None = None,
    specs: dict | None = None,
    coming_soon: bool = False,
) -> int:
    conn = get_conn()
    with _lock:
        conn.execute(
            """
            INSERT INTO products(slug, name, subtitle, description, price, volume, category_slug,
                                 badge, featured, in_stock, coming_soon, sort, images, collections, specs)
            VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            ON CONFLICT(slug) DO UPDATE SET
                name=excluded.name, subtitle=excluded.subtitle, description=excluded.description,
                price=excluded.price, volume=excluded.volume, category_slug=excluded.category_slug,
                badge=excluded.badge, featured=excluded.featured, in_stock=excluded.in_stock,
                coming_soon=excluded.coming_soon, sort=excluded.sort, images=excluded.images,
                collections=excluded.collections, specs=excluded.specs
            """,
            (
                slug,
                name,
                subtitle,
                description,
                price,
                volume,
                category_slug,
                badge,
                1 if featured else 0,
                1 if in_stock else 0,
                1 if coming_soon else 0,
                sort,
                _json(list(images or [])),
                _json(list(collections or [])),
                _json(specs or {}),
            ),
        )
        conn.commit()
        row = conn.execute("SELECT id FROM products WHERE slug = ?", (slug,)).fetchone()
    return int(row["id"])


def set_product_field(slug: str, field: str, value: Any) -> None:
    allowed = {
        "name",
        "subtitle",
        "description",
        "price",
        "volume",
        "category_slug",
        "badge",
        "featured",
        "in_stock",
        "sort",
        "images",
        "collections",
        "specs",
    }
    if field not in allowed:
        raise ValueError(f"Unsupported field {field}")
    if field in {"images", "collections", "specs"}:
        value = _json(value)
    if field in {"featured", "in_stock"}:
        value = 1 if value else 0
    conn = get_conn()
    with _lock:
        conn.execute(f"UPDATE products SET {field} = ? WHERE slug = ?", (value, slug))
        conn.commit()


def set_product_images(slug: str, images: list[str]) -> None:
    set_product_field(slug, "images", images)


def set_product_collections(slug: str, collections: list[str]) -> None:
    set_product_field(slug, "collections", collections)


def delete_product(slug: str) -> None:
    conn = get_conn()
    with _lock:
        conn.execute("DELETE FROM products WHERE slug = ?", (slug,))
        conn.commit()


def next_sort(kind: str) -> int:
    conn = get_conn()
    table = {"product": "products", "category": "categories", "collection": "collections"}[kind]
    row = conn.execute(f"SELECT COALESCE(MAX(sort), 0) AS m FROM {table}").fetchone()
    return int(row["m"]) + 1


# -------------------------------------------------------------------- staff
def list_staff() -> list[dict]:
    conn = get_conn()
    rows = conn.execute("SELECT * FROM staff ORDER BY granted_at DESC").fetchall()
    return [dict(r) for r in rows]


def grant_staff(user_id: int, username: str = "", full_name: str = "") -> None:
    conn = get_conn()
    with _lock:
        conn.execute(
            "INSERT INTO staff(user_id, username, full_name, granted_at) VALUES(?,?,?,?) "
            "ON CONFLICT(user_id) DO UPDATE SET username=excluded.username, full_name=excluded.full_name, "
            "granted_at=excluded.granted_at",
            (user_id, username or "", full_name or "", datetime.now(timezone.utc).isoformat(timespec="seconds")),
        )
        conn.commit()


def revoke_staff(user_id: int) -> None:
    conn = get_conn()
    with _lock:
        conn.execute("DELETE FROM staff WHERE user_id = ?", (user_id,))
        conn.commit()


def is_staff(user_id: int) -> bool:
    conn = get_conn()
    row = conn.execute("SELECT granted_at FROM staff WHERE user_id = ?", (user_id,)).fetchone()
    if not row:
        return False
    try:
        granted = datetime.fromisoformat(row["granted_at"])
    except ValueError:
        return False
    from settings import AUTH_TTL_HOURS

    age = datetime.now(timezone.utc) - granted
    if age.total_seconds() > AUTH_TTL_HOURS * 3600:
        revoke_staff(user_id)
        return False
    return True


# ----------------------------------------------------------------- requests
def next_reference() -> str:
    conn = get_conn()
    row = conn.execute("SELECT id FROM requests ORDER BY id DESC LIMIT 1").fetchone()
    number = 1042 + (int(row["id"]) if row else 0)
    return f"CE-{number}"


def create_request(payload: dict) -> dict:
    conn = get_conn()
    created = datetime.now(timezone.utc).isoformat(timespec="seconds")
    items = payload.get("items") or []
    with _lock:
        for _ in range(5):
            reference = next_reference()
            try:
                cur = conn.execute(
                    """INSERT INTO requests(reference, created_at, name, company, email, phone, country,
                                            city, address, tax_id, delivery, payment, shipping,
                                            note, items, total, currency, status)
                       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'new')""",
                    (
                        reference,
                        created,
                        payload.get("name", ""),
                        payload.get("company", ""),
                        payload.get("email", ""),
                        payload.get("phone", ""),
                        payload.get("country", ""),
                        payload.get("city", ""),
                        payload.get("address", ""),
                        payload.get("taxId", ""),
                        payload.get("delivery", ""),
                        payload.get("payment", ""),
                        float(payload.get("shipping") or 0),
                        payload.get("note", ""),
                        _json(items),
                        float(payload.get("total") or 0),
                        payload.get("currency", "AED"),
                    ),
                )
                conn.commit()
                row_id = cur.lastrowid
                break
            except sqlite3.IntegrityError:
                conn.rollback()
        else:
            raise RuntimeError("Could not allocate a request reference")
    return get_request(row_id)


def _request_to_dict(row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "reference": row["reference"],
        "createdAt": row["created_at"],
        "name": row["name"],
        "company": row["company"],
        "email": row["email"],
        "phone": row["phone"],
        "country": row["country"],
        "city": row["city"],
        "address": row["address"],
        "taxId": row["tax_id"],
        "delivery": row["delivery"],
        "payment": row["payment"],
        "shipping": row["shipping"],
        "note": row["note"],
        "items": _loads(row["items"], []),
        "total": row["total"],
        "currency": row["currency"],
        "status": row["status"],
    }


def get_request(request_id: int) -> dict | None:
    conn = get_conn()
    row = conn.execute("SELECT * FROM requests WHERE id = ?", (request_id,)).fetchone()
    return _request_to_dict(row) if row else None


def list_requests(status: str | None = None, limit: int = 30) -> list[dict]:
    conn = get_conn()
    if status and status != "all":
        rows = conn.execute(
            "SELECT * FROM requests WHERE status = ? ORDER BY id DESC LIMIT ?", (status, limit)
        ).fetchall()
    else:
        rows = conn.execute("SELECT * FROM requests ORDER BY id DESC LIMIT ?", (limit,)).fetchall()
    return [_request_to_dict(r) for r in rows]


def set_request_status(request_id: int, status: str) -> None:
    conn = get_conn()
    with _lock:
        conn.execute("UPDATE requests SET status = ? WHERE id = ?", (status, request_id))
        conn.commit()


def request_counts() -> dict[str, int]:
    conn = get_conn()
    rows = conn.execute("SELECT status, COUNT(*) c FROM requests GROUP BY status").fetchall()
    counts = {status: 0 for status in ORDER_STATUSES}
    for row in rows:
        counts[row["status"]] = row["c"]
    counts["total"] = sum(counts.values())
    return counts


# -------------------------------------------------------------- public feed
def get_content() -> dict:
    raw_settings = all_settings()
    settings = {k: v for k, v in raw_settings.items() if not str(k).startswith("_")}
    return {
        "version": 7,
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "settings": settings,
        "categories": [
            {
                "slug": c["slug"],
                "name": c["name"],
                "blurb": c["blurb"],
                "sort": c["sort"],
                **({"cover": c["cover"]} if c.get("cover") else {}),
            }
            for c in list_categories()
        ],
        "collections": [
            {
                "slug": c["slug"],
                "name": c["name"],
                "subtitle": c["subtitle"],
                "description": c["description"],
                "image": c["image"],
                "sort": c["sort"],
            }
            for c in list_collections()
        ],
        "products": list_products(),
    }
