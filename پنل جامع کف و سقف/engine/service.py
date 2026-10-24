# -*- coding: utf-8 -*-
"""
ShelfMaster Engine - Shared service layer
Everything both servers need (the standalone floor/ceiling panel on 8900 and the «کف و سقف» tab of the
monitoring panel on 8800): Jalali date, report discovery, warehouse-code guard, store items and the
export / ERP-copy / audit-fix / preset / custom-Excel / AI operations. Keeping it here means one set of rules.
"""

from __future__ import annotations

import base64
import datetime
import os
import sys
from typing import Any, Callable

try:
    from .rules import get_store_warehouse_code, normalize_persian_text
    from .reader import parse_send_report, get_store_records
    from .convert import generate_convert_file, generate_tsv_clipboard, default_output_dirs
    from .audit import run_audit, generate_auto_fix_items
    from .presets import PRESETS, apply_preset
    from .ai_assistant import (
        DEFAULT_SYSTEM_PROMPT,
        extract_json_from_response,
        match_parsed_items_with_db,
    )
except (ImportError, ValueError):
    from rules import get_store_warehouse_code, normalize_persian_text
    from reader import parse_send_report, get_store_records
    from convert import generate_convert_file, generate_tsv_clipboard, default_output_dirs
    from audit import run_audit, generate_auto_fix_items
    from presets import PRESETS, apply_preset
    from ai_assistant import (
        DEFAULT_SYSTEM_PROMPT,
        extract_json_from_response,
        match_parsed_items_with_db,
    )

ALL_STORE_WORDS = ("ALL", "کل", "کل شعب", "همه")


class ServiceError(Exception):
    """A user-facing error (Persian message) — servers answer it with HTTP 400."""


# ─────────────────────────────── تاریخ ───────────────────────────────

def gregorian_to_jalali(gy: int, gm: int, gd: int) -> tuple[int, int, int]:
    """تبدیل تاریخ میلادی به شمسی (الگوریتم استاندارد jdf)."""
    g_d_m = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    gy2 = gy + 1 if gm > 2 else gy
    days = (355666 + 365 * gy + (gy2 + 3) // 4 - (gy2 + 99) // 100
            + (gy2 + 399) // 400 + gd + g_d_m[gm - 1])
    jy = -1595 + 33 * (days // 12053)
    days %= 12053
    jy += 4 * (days // 1461)
    days %= 1461
    if days > 365:
        jy += (days - 1) // 365
        days = (days - 1) % 365
    if days < 186:
        jm, jd = 1 + days // 31, 1 + days % 31
    else:
        jm, jd = 7 + (days - 186) // 30, 1 + (days - 186) % 30
    return jy, jm, jd


def today_jalali() -> str:
    """تاریخ شمسی امروز با قالب 1405.08.01"""
    d = datetime.date.today()
    jy, jm, jd = gregorian_to_jalali(d.year, d.month, d.day)
    return f"{jy}.{jm:02d}.{jd:02d}"


def resolve_target_date(conf: dict[str, Any] | None, requested: Any = None) -> str:
    """تاریخ فایل کانورت: مقدار ارسالی، یا مقدار ثابت config، یا (پیش‌فرض) امروز."""
    for val in (requested, (conf or {}).get("target_date")):
        s = str(val or "").strip()
        if s and s.lower() != "auto":
            return s
    return today_jalali()


# ─────────────────────────── پیدا کردن گزارش ───────────────────────────

def is_proposal_name(entry: str) -> bool:
    """Full shipment-proposal report? (not discount reports, not convert outputs, not filtered extracts «... - ...»)."""
    if entry.startswith("~$") or entry.startswith(".") or not entry.lower().endswith(".xlsx"):
        return False
    norm_name = normalize_persian_text(entry)
    if "تخفیف" in norm_name or "کانورت" in norm_name:
        return False
    # گزارش‌های فیلترشده/جزئی (مثل «... - ماکارونی رحمت») نسخه کامل نیستند
    if " - " in norm_name:
        return False
    return ("پیشنهاد" in norm_name and "ارسال" in norm_name) or "pishnahad" in entry.lower()


def scan_into(base: str, recursive: bool, matched: dict[str, float]) -> None:
    if not base or not os.path.isdir(base):
        return
    try:
        for dirpath, dirnames, filenames in os.walk(base):
            # پوشه‌های «_…» (مثل «_تکراری») و مخفی کنار گذاشته می‌شوند
            dirnames[:] = [d for d in dirnames if not d.startswith(("_", "."))] if recursive else []
            for entry in filenames:
                if not is_proposal_name(entry):
                    continue
                full_path = os.path.join(dirpath, entry)
                try:
                    matched[os.path.abspath(full_path)] = os.path.getmtime(full_path)
                except OSError:
                    continue
    except Exception as e:
        print(f"[Warning] Error scanning folder {base}: {e}", file=sys.stderr)


def scan_folders(folders: list[tuple[str, bool]]) -> list[str]:
    """[(folder, recursive), ...] → full proposal reports, newest (mtime) first."""
    matched: dict[str, float] = {}
    for base, recursive in folders:
        scan_into(base, recursive, matched)
    return [p for p, _ in sorted(matched.items(), key=lambda x: x[1], reverse=True)]


# ─────────────────────────── کد انبار ───────────────────────────

def is_all_stores(store: str | None) -> bool:
    return bool(store) and str(store).strip().upper() in ALL_STORE_WORDS


def _int_or_zero(val: Any) -> int:
    try:
        return int(round(float(str(val).strip())))
    except (ValueError, TypeError):
        return 0


def row_store_code(it: dict[str, Any], fallback: int) -> int:
    """کد انبار هر ردیف: کد خود ردیف، سپس نام شعبه ردیف، سپس کد شعبه انتخاب‌شده."""
    for k in ("store_code", "wh_code", "کد انبار(*)", "کد انبار"):
        c = _int_or_zero(it.get(k))
        if c > 0:
            return c
    for k in ("wh_name", "store"):
        if it.get(k):
            c = get_store_warehouse_code(str(it[k]))
            if c > 0:
                return c
    return fallback


def store_code_of(store: str | None) -> int:
    if not store:
        return 0
    c = get_store_warehouse_code(store)
    return c if c > 0 else _int_or_zero(store)


def missing_code_error(items: list[dict[str, Any]], fallback: int) -> str | None:
    """اگر کد انبار حتی یک ردیف نامشخص باشد، پیام خطا برمی‌گرداند (فایل ERP بدون کد انبار ساخته نشود)."""
    bad = [it for it in items if row_store_code(it, fallback) <= 0]
    if not bad:
        return None
    sample = "، ".join(str(it.get("code", "?")) for it in bad[:5])
    return f"کد انبار {len(bad)} ردیف مشخص نیست (نمونه کد کالا: {sample}). لطفاً شعبه را انتخاب کنید."


# ─────────────────────────── داده‌ها ───────────────────────────

def calculate_feasibility(free_qty: float, shelf_qty: float, max_qty: float) -> str:
    """red: no central stock · yellow: central stock below the shelf deficit · green: enough."""
    if free_qty <= 0:
        return "red"
    deficit = max_qty - shelf_qty
    if deficit > 0 and free_qty < deficit:
        return "yellow"
    return "green"


def enrich(it: dict[str, Any]) -> dict[str, Any]:
    d = dict(it)
    d["feasibility"] = calculate_feasibility(
        float(d.get("free_qty", 0.0) or 0.0), float(d.get("shelf_qty", 0.0) or 0.0), float(d.get("max", 0.0) or 0.0)
    )
    d["store_code"] = get_store_warehouse_code(d.get("wh_name", ""))
    return d


def store_items(data: dict[str, Any] | None, store: str | None) -> list[dict[str, Any]]:
    if not data:
        return []
    raw = data.get("rows", []) if (not store or is_all_stores(store)) else get_store_records(data, store)
    return [enrich(it) for it in raw]


def item_rows(data: dict[str, Any] | None, code: Any) -> list[dict[str, Any]]:
    """All stores' rows of one product."""
    c = _int_or_zero(code)
    if not data or c <= 0:
        return []
    return [enrich(r) for r in data.get("rows", []) if r.get("code") == c]


# ─────────────────────────── عملیات ───────────────────────────

def export_convert(data: dict[str, Any] | None, store: str, items: list[dict[str, Any]] | None,
                   target_date: str, file_label: str | None = None) -> dict[str, Any]:
    """Convert Excel (+ TSV). store == ALL → one file per store. Raises ServiceError for bad input."""
    store = (store or "").strip()
    items = list(items or [])
    if not items and data:
        items = data.get("rows", []) if (not store or is_all_stores(store)) else get_store_records(data, store)
    if not items:
        raise ServiceError("هیچ کالایی برای تولید فایل کانورت ارسال نشده است.")

    if is_all_stores(store):
        grouped: dict[str, list[dict[str, Any]]] = {}
        for it in items:
            st_name = str(it.get("wh_name") or it.get("store") or "نامشخص").strip()
            grouped.setdefault(st_name, []).append(it)
        for st_name, st_items in grouped.items():
            err = missing_code_error(st_items, store_code_of(st_name))
            if err:
                raise ServiceError(f"شعبه «{st_name}»: {err}")
        paths: list[str] = []
        tsv_parts: list[str] = []
        for st_name, st_items in grouped.items():
            res = generate_convert_file(st_name, st_items, target_date=target_date)
            paths.extend(res.get("paths", []))
            if res.get("tsv"):
                tsv_parts.append(res["tsv"])
        return {"ok": True, "filename": f"کانورت تمام شعب ({target_date}).xlsx", "paths": paths,
                "tsv": "\n".join(tsv_parts), "count": len(items), "files": len(grouped)}

    err = missing_code_error(items, store_code_of(store))
    if err:
        raise ServiceError(err)
    res = generate_convert_file(store, items, target_date=target_date, file_label=file_label)
    return {"ok": True, "filename": res.get("filename", ""), "paths": res.get("paths", []), "tsv": res.get("tsv", ""),
            "count": res.get("count", len(items)), "store_code": res.get("store_code", 0)}


def copy_erp(store: str, items: list[dict[str, Any]]) -> dict[str, Any]:
    store_code = store_code_of((store or "").strip())
    err = missing_code_error(items or [], store_code)
    if err:
        raise ServiceError(err)
    return {"ok": True, "tsv": generate_tsv_clipboard(items, store_code), "count": len(items), "store_code": store_code}


def audit(data: dict[str, Any] | None) -> dict[str, Any]:
    if not data or not data.get("rows"):
        return {"total_anomalies": 0, "categories": {}, "counts": {"total": 0}, "by_store": {},
                "pish_over_max": [], "round_over_max": [], "min_ge_max": [], "blank_or_zero_active": [], "sop_violations": []}
    return run_audit(data["rows"])


def audit_fix(data: dict[str, Any] | None, store: str | None, target_date: str,
              categories: list[str] | None = None, write: bool = True) -> dict[str, Any]:
    """Auto-fix items (optionally only some categories); write=False = preview without a file."""
    if not data or not data.get("rows"):
        raise ServiceError("داده‌های پیشنهاد ارسال بارگذاری نشده است.")
    res = run_audit(data["rows"])
    if categories:
        keep = set(categories)
        res = dict(res)
        res["categories"] = {k: (v if k in keep else []) for k, v in res.get("categories", {}).items()}
        for k in ("pish_over_max", "round_over_max", "min_ge_max", "blank_or_zero_active", "sop_violations"):
            if k not in keep:
                res[k] = []
    store_filter = store if store and not is_all_stores(store) else None
    items = generate_auto_fix_items(res, store_name=store_filter)
    out: dict[str, Any] = {"ok": True, "count": len(items), "items": items, "tsv": "", "filename": "", "paths": []}
    if not items:
        out["message"] = "هیچ مغایرتی برای اصلاح یافت نشد."
        return out
    if write:
        conv = generate_convert_file(store_filter or "اصلاح مغایرت‌ها", items, target_date=target_date)
        out.update({"filename": conv.get("filename", ""), "paths": conv.get("paths", []), "tsv": conv.get("tsv", "")})
    return out


def preset(data: dict[str, Any] | None, name: str, store: str | None) -> dict[str, Any]:
    if not data or not data.get("rows"):
        raise ServiceError("داده‌های پیشنهاد ارسال بارگذاری نشده است.")
    store_filter = store if store and not is_all_stores(store) else None
    try:
        items = apply_preset((name or "").strip(), data["rows"], store_name=store_filter)
    except ValueError as e:
        raise ServiceError(str(e))
    return {"ok": True, "preset": name, "store": store, "count": len(items), "items": items,
            "tsv": generate_tsv_clipboard(items, store_code_of(store))}


def custom_excel(file_b64: str | None, file_path: str | None, store: str | None, target_date: str) -> dict[str, Any]:
    try:
        from .custom_excel import inspect_and_convert_custom_excel
    except (ImportError, ValueError):
        from custom_excel import inspect_and_convert_custom_excel
    if file_b64:
        try:
            raw = file_b64.split(",", 1)[1] if "," in file_b64 else file_b64
            src: Any = base64.b64decode(raw)
        except Exception as e:
            raise ServiceError(f"خطا در دیکود فایل اکسل: {e}")
    elif file_path:
        if not os.path.isfile(file_path):
            raise ServiceError(f"فایل اکسل در مسیر مشخص شده یافت نشد: {file_path}")
        src = file_path
    else:
        raise ServiceError("هیچ فایل یا مسیری ارسال نشده است.")
    try:
        return inspect_and_convert_custom_excel(src, override_store=(store or None), target_date=target_date)
    except Exception as e:
        raise ServiceError(f"خطا در پردازش فایل اکسل سفارشی: {e}")


def gemini_payload(text: str | None, image_b64: str | None) -> dict[str, Any] | None:
    """Request body for Gemini generateContent (same prompt as the standalone panel)."""
    parts: list[dict[str, Any]] = []
    if text and str(text).strip():
        parts.append({"text": str(text).strip()})
    if image_b64:
        raw = image_b64.split(",", 1)[1] if "," in image_b64 else image_b64
        try:
            data = base64.b64decode(raw.strip())
        except Exception:
            data = b""
        if data:
            mime = ("image/png" if data.startswith(b"\x89PNG") else "image/gif" if data.startswith(b"GIF")
                    else "image/webp" if data.startswith(b"RIFF") and b"WEBP" in data[:16] else "image/jpeg")
            parts.append({"inline_data": {"mime_type": mime, "data": base64.b64encode(data).decode("ascii")}})
    if not parts:
        return None
    return {"system_instruction": {"parts": [{"text": DEFAULT_SYSTEM_PROMPT}]},
            "contents": [{"parts": parts}], "generationConfig": {"temperature": 0.1}}


def ai_items(data: dict[str, Any] | None, parsed: list[dict[str, Any]], store: str | None) -> dict[str, Any]:
    """Match AI-parsed items with the report and enforce the SOP rules."""
    db = data.get("rows", []) if data else []
    enriched = match_parsed_items_with_db(parsed or [], db, default_store=store or None)
    sc = store_code_of(store)
    warning = ""
    if not parsed:
        warning = "از Gemini پاسخ قابل‌استفاده‌ای دریافت نشد."
    elif not sc and any(not it.get("store_code") for it in enriched):
        warning = "شعبه مقصد انتخاب نشده است؛ برای کپی یا ذخیره ERP ابتدا شعبه را انتخاب کنید."
    return {"ok": True, "count": len(enriched), "items": enriched, "tsv": generate_tsv_clipboard(enriched, sc),
            "raw_parsed": parsed, "warning": warning}


def ai_parse_with(call: Callable[[dict[str, Any]], tuple[int, dict[str, Any]]], data: dict[str, Any] | None,
                  text: str | None, image_b64: str | None, store: str | None) -> dict[str, Any]:
    """AI parse through a caller-provided Gemini transport: call(payload) → (http_status, json)."""
    payload = gemini_payload(text, image_b64)
    if payload is None:
        raise ServiceError("لطفاً متن دستور یا تصویر را بدهید.")
    code, j = call(payload)
    if code != 200:
        raise ServiceError(str((j or {}).get("error") or f"خطای Gemini ({code})"))
    raw = ""
    try:
        raw = j["candidates"][0]["content"]["parts"][0].get("text", "")
    except (KeyError, IndexError, TypeError):
        raw = ""
    return ai_items(data, extract_json_from_response(raw), store)


def today_output_dir(target_date: str) -> str | None:
    """Folder where today's convert files go (for «open folder»): the daily folder, else its parent."""
    for d in default_output_dirs(target_date):
        for cand in (d, os.path.dirname(d)):
            if cand and os.path.isdir(cand):
                return cand
    return None
