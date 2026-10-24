# -*- coding: utf-8 -*-
"""
ShelfMaster Engine - Gemini AI Assistant Module
Parses goods limits and store information from text commands or invoice images,
extracts structured JSON arrays, and enriches items against the proposal report database
with strict SOP rule enforcement.
"""

from __future__ import annotations

import os
import re
import json
import base64
import urllib.request
import urllib.error
import socket
from typing import Any

try:
    from .rules import (
        is_zero_mandated,
        validate_and_adjust_limits,
        get_store_warehouse_code,
        normalize_persian_text,
    )
    from .reader import is_store_match
except (ImportError, ValueError):
    from rules import (
        is_zero_mandated,
        validate_and_adjust_limits,
        get_store_warehouse_code,
        normalize_persian_text,
    )
    from reader import is_store_match

DEFAULT_SYSTEM_PROMPT: str = (
    "تو یک دستیار استخراج داده برای سیستم کف و سقف و پیشنهاد ارسال فروشگاه زنجیره‌ای هستی. "
    "وظیفه تو استخراج کد کالا، نام محصول، کف تعیین‌شده، سقف تعیین‌شده و نام فروشگاه از روی متن دستور یا تصویر فاکتور/لیست ارسالی است. "
    "خروجی باید فقط و فقط یک آرایه JSON معتبر شامل فیلدهای code (عدد صحیح یا null)، name (رشته)، min (عدد)، max (عدد) و store (رشته یا null) باشد. "
    "هیچ توضیح اضافه‌ای ننویس."
)


def _safe_float(val: Any, default: float = 0.0) -> float:
    """Safely convert value to float."""
    if val is None or val == "":
        return default
    try:
        return float(str(val).strip())
    except (ValueError, TypeError):
        return default


def _safe_int(val: Any, default: int = 0) -> int:
    """Safely convert value to int."""
    if val is None or val == "":
        return default
    try:
        return int(round(float(str(val).strip())))
    except (ValueError, TypeError):
        return default


def _get_item_val(it: dict[str, Any], keys: list[str], default: Any = None) -> Any:
    """Retrieve first matching non-null value from dict across aliases."""
    for k in keys:
        if k in it and it[k] is not None:
            return it[k]
    return default


def _tokenize_persian(text: str) -> list[str]:
    """Tokenize Persian text into normalized search keywords."""
    if not text:
        return []
    norm = normalize_persian_text(str(text))
    cleaned = re.sub(r"[^\w\s]", " ", norm)
    tokens = [w.strip() for w in cleaned.split() if len(w.strip()) >= 2]
    stopwords = {
        "و", "در", "با", "از", "برای", "به", "این", "آن", "ها", "های",
        "را", "یک", "عدد", "بسته", "گرم", "کیلو", "کیلوگرم", "میل", "میلی", "لیتر"
    }
    return [t for t in tokens if t not in stopwords]


def extract_json_from_response(raw_text: str | None) -> list[dict[str, Any]]:
    """
    Robust JSON extractor and parser from LLM response.
    Handles markdown code fences (```json ... ```), extra whitespace,
    conversational preambles/postambles, single dict or list of dicts,
    Persian/Arabic numerals, and trailing commas.

    Parameters:
        raw_text: Raw string output returned by LLM or user text.

    Returns:
        list[dict]: Extracted list of dictionary objects. Returns [] if parsing fails.
    """
    if not raw_text or not isinstance(raw_text, str):
        return []

    text = raw_text.strip()
    if not text:
        return []

    # 1. Normalize Persian/Arabic numerals to ASCII digits
    persian_arabic_digits = {
        '۰': '0', '۱': '1', '۲': '2', '۳': '3', '۴': '4',
        '۵': '5', '۶': '6', '۷': '7', '۸': '8', '۹': '9',
        '٠': '0', '١': '1', '٢': '2', '٣': '3', '٤': '4',
        '٥': '5', '٦': '6', '٧': '7', '٨': '8', '٩': '9',
    }
    for p_digit, a_digit in persian_arabic_digits.items():
        text = text.replace(p_digit, a_digit)

    # 2. Extract content from markdown code fences if present
    fence_pattern = re.compile(r"```(?:json)?\s*([\s\S]*?)\s*```", re.IGNORECASE)
    matches = fence_pattern.findall(text)
    candidates_to_try: list[str] = []
    if matches:
        candidates_to_try.extend(matches)

    candidates_to_try.append(text)

    def _try_parse(s: str) -> Any:
        cleaned_str = s.strip()
        # Clean trailing commas before closing braces or brackets
        cleaned_str = re.sub(r",\s*([\]\}])", r"\1", cleaned_str)
        try:
            return json.loads(cleaned_str)
        except Exception:
            # Try finding outermost JSON array [ ... ]
            bracket_match = re.search(r"\[\s*\{[\s\S]*\}\s*\]", cleaned_str)
            if bracket_match:
                try:
                    c_b = re.sub(r",\s*([\]\}])", r"\1", bracket_match.group(0))
                    return json.loads(c_b)
                except Exception:
                    pass
            # Try finding outermost JSON object { ... }
            curly_match = re.search(r"\{[\s\S]*\}", cleaned_str)
            if curly_match:
                try:
                    c_c = re.sub(r",\s*([\]\}])", r"\1", curly_match.group(0))
                    return json.loads(c_c)
                except Exception:
                    pass
        return None

    parsed_obj: Any = None
    for cand in candidates_to_try:
        res = _try_parse(cand)
        if res is not None:
            parsed_obj = res
            break

    if parsed_obj is None:
        return []

    # 3. Standardize to list of dicts
    if isinstance(parsed_obj, list):
        return [it for it in parsed_obj if isinstance(it, dict)]
    elif isinstance(parsed_obj, dict):
        for key in ["items", "goods", "data", "products", "rows", "result", "list"]:
            if key in parsed_obj and isinstance(parsed_obj[key], list):
                return [it for it in parsed_obj[key] if isinstance(it, dict)]
        return [parsed_obj]

    return []


def parse_instruction_or_image(
    text_prompt: str | None = None,
    image_bytes: bytes | None = None,
    api_key: str | None = None,
    model: str = "gemini-flash-latest",
) -> list[dict[str, Any]]:
    """
    Call Google Generative Language REST API to parse goods limits and store information
    from text instructions or invoice/list images.

    Parameters:
        text_prompt: User instruction or extracted text.
        image_bytes: Raw bytes of an image (JPEG, PNG, WEBP, GIF).
        api_key: Google Gemini API key (defaults to os.environ["GEMINI_API_KEY"]).
        model: Model identifier (defaults to "gemini-flash-latest").

    Returns:
        list[dict]: List of parsed product dicts with keys (code, name, min, max, store).
                    Returns [] on error, missing key, or network failure.
    """
    key = (api_key or os.environ.get("GEMINI_API_KEY", "")).strip()
    if not key:
        return []

    parts: list[dict[str, Any]] = []

    if text_prompt and str(text_prompt).strip():
        parts.append({"text": str(text_prompt).strip()})

    if image_bytes and isinstance(image_bytes, bytes) and len(image_bytes) > 0:
        if image_bytes.startswith(b"\x89PNG"):
            mime_type = "image/png"
        elif image_bytes.startswith(b"\xff\xd8"):
            mime_type = "image/jpeg"
        elif image_bytes.startswith(b"GIF"):
            mime_type = "image/gif"
        elif image_bytes.startswith(b"RIFF") and b"WEBP" in image_bytes[:16]:
            mime_type = "image/webp"
        else:
            mime_type = "image/jpeg"

        b64_img = base64.b64encode(image_bytes).decode("ascii")
        parts.append({
            "inline_data": {
                "mime_type": mime_type,
                "data": b64_img,
            }
        })

    if not parts:
        return []

    payload = {
        "system_instruction": {
            "parts": [{"text": DEFAULT_SYSTEM_PROMPT}]
        },
        "contents": [
            {
                "parts": parts
            }
        ],
        "generationConfig": {
            "temperature": 0.1,
        }
    }

    url = f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent?key={key}"
    req_body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(
        url=url,
        data=req_body,
        headers={
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
        method="POST",
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            resp_bytes = resp.read()
            res_data = json.loads(resp_bytes.decode("utf-8"))

            candidates = res_data.get("candidates", [])
            if candidates and isinstance(candidates, list):
                content = candidates[0].get("content", {})
                c_parts = content.get("parts", [])
                if c_parts and isinstance(c_parts, list):
                    raw_text = c_parts[0].get("text", "")
                    return extract_json_from_response(raw_text)
            return []
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError, socket.timeout, Exception):
        return []


def match_parsed_items_with_db(
    parsed_items: list[dict[str, Any]],
    db_goods: list[dict[str, Any]],
    default_store: str | None = None,
) -> list[dict[str, Any]]:
    """
    Match parsed items against database records:
    - If `code` exists and matches, enriches with name, batch, status, shelf_qty, free_qty, old_min, old_max.
    - If `code` is None or 0, searches `db_goods` by Persian token keywords in `name` to find best candidate.
    - Enforces SOP rules via `validate_and_adjust_limits` and `is_zero_mandated`.

    Parameters:
        parsed_items: List of raw items parsed from text or image.
        db_goods: List of database/proposal report records.
        default_store: Fallback store name if not specified in parsed item.

    Returns:
        list[dict]: Enriched items ready for convert file and TSV generation.
    """
    if not parsed_items:
        return []

    # 1. Index db_goods by code
    db_by_code: dict[int, list[dict[str, Any]]] = {}
    db_name_candidates: list[tuple[dict[str, Any], str, set[str]]] = []

    for g in (db_goods or []):
        c_val = _get_item_val(g, ["code", "کد کالا", "کد", "کد کالا(*)"])
        if c_val is not None:
            c_int = _safe_int(c_val)
            if c_int > 0:
                if c_int not in db_by_code:
                    db_by_code[c_int] = []
                db_by_code[c_int].append(g)

        g_name = _get_item_val(g, ["name", "نام محصول", "نام کالا", "شرح کالا", "عنوان کالا"])
        if g_name:
            norm_n = normalize_persian_text(str(g_name))
            tokens = set(_tokenize_persian(norm_n))
            db_name_candidates.append((g, norm_n, tokens))

    enriched_items: list[dict[str, Any]] = []

    for it in parsed_items:
        target_store = _get_item_val(it, ["store", "wh_name", "فروشگاه", "نام فروشگاه"], default_store)
        code_val = _get_item_val(it, ["code", "کد کالا", "کد", "کد کالا(*)"])
        code_int = _safe_int(code_val, default=0) if code_val is not None else 0

        g_match: dict[str, Any] | None = None

        # A. Exact Match by Code
        if code_int > 0 and code_int in db_by_code:
            matches = db_by_code[code_int]
            if target_store:
                store_match = next((m for m in matches if is_store_match(target_store, m.get("wh_name", ""))), None)
                g_match = store_match if store_match is not None else matches[0]
            else:
                g_match = matches[0]

        # B. Fuzzy / Keyword Match by Name if code is 0 or not found
        if g_match is None:
            item_name = _get_item_val(it, ["name", "نام محصول", "نام کالا", "شرح کالا", "عنوان کالا"])
            if item_name:
                norm_p = normalize_persian_text(str(item_name))
                p_tokens = set(_tokenize_persian(norm_p))
                if not p_tokens:
                    p_tokens = set(norm_p.split())

                best_score = -1.0
                best_candidate: dict[str, Any] | None = None

                for cand_g, norm_g, g_tokens in db_name_candidates:
                    score = 0.0
                    if norm_p == norm_g:
                        score = 10000.0
                    elif norm_p in norm_g:
                        score = 5000.0 + len(norm_p)
                    elif norm_g in norm_p:
                        score = 4000.0 + len(norm_g)
                    else:
                        common = p_tokens.intersection(g_tokens)
                        if common:
                            score = len(common) * 100.0 + (len(common) / max(1, len(p_tokens))) * 50.0

                    if score > 0 and target_store and is_store_match(target_store, cand_g.get("wh_name", "")):
                        score += 50.0

                    if score > best_score:
                        best_score = score
                        best_candidate = cand_g

                if best_score > 0 and best_candidate is not None:
                    g_match = best_candidate
                    if code_int == 0:
                        code_int = _safe_int(_get_item_val(g_match, ["code", "کد کالا", "کد", "کد کالا(*)"], 0))

        # C. Extract values from matched record or fallback to item
        if g_match is not None:
            resolved_name = str(_get_item_val(g_match, ["name", "نام محصول", "نام کالا", "شرح کالا"], it.get("name", "")))
            batch = _safe_float(_get_item_val(g_match, ["batch", "carton", "تعداد بچ مادر", "بچ مادر", "بچ"], 1.0), default=1.0)
            status = str(_get_item_val(g_match, ["status", "وضعیت کالا", "وضعیت کالا در فروشگاه", "وضعیت"], "فعال"))
            shelf_qty = _safe_float(_get_item_val(g_match, ["shelf_qty", "موجودی انبار قفسه", "موجودی قفسه شعبه", "موجودی قفسه"], 0.0))
            free_qty = _safe_float(_get_item_val(g_match, ["free_qty", "موجودی قابل ارسال", "موجودی آزاد"], 0.0))
            old_min = _safe_int(_get_item_val(g_match, ["min", "کف", "کف فعلی قفسه", "کف قبلی", "old_min"], 0))
            old_max = _safe_int(_get_item_val(g_match, ["max", "سقف", "سقف فعلی قفسه", "سقف قبلی", "old_max"], 0))
        else:
            resolved_name = str(it.get("name", ""))
            batch = _safe_float(_get_item_val(it, ["batch", "carton", "تعداد بچ مادر", "بچ"], 1.0), default=1.0)
            status = str(it.get("status", "فعال"))
            shelf_qty = _safe_float(it.get("shelf_qty", 0.0))
            free_qty = _safe_float(it.get("free_qty", 0.0))
            old_min = _safe_int(_get_item_val(it, ["old_min", "کف قبلی"], 0))
            old_max = _safe_int(_get_item_val(it, ["old_max", "سقف قبلی"], 0))

        if batch <= 0:
            batch = 1.0

        # D. Limit Resolution (Preserve old_max if new_max is not specified)
        raw_min_in = _get_item_val(it, ["min", "new_min", "کف", "کف جدید"])
        raw_max_in = _get_item_val(it, ["max", "new_max", "سقف", "سقف جدید"])

        has_min = raw_min_in is not None and str(raw_min_in).strip() != ""
        has_max = raw_max_in is not None and str(raw_max_in).strip() != ""

        target_min = _safe_float(raw_min_in) if has_min else float(old_min)
        target_max = _safe_float(raw_max_in) if has_max else float(old_max)

        # E. SOP Enforcement
        is_zero = is_zero_mandated(code_int, resolved_name)
        if is_zero:
            adj_min = 0
            adj_max = 0
            change_note = "الزام سقف و کف صفر طبق SOP (اقلام صنعتی/شوینده ۱۰ لیتری/سبد)"
        else:
            is_slow = bool(it.get("is_slow_moving") or (g_match.get("is_slow_moving") if g_match else False))
            adj_min, adj_max, change_note = validate_and_adjust_limits(
                target_min, target_max, batch, is_slow_moving=is_slow
            )

        store_code = get_store_warehouse_code(target_store) if target_store else 0

        enriched_record: dict[str, Any] = {
            "code": code_int,
            "name": resolved_name,
            "store": target_store,
            "store_code": store_code,
            "min": adj_min,
            "max": adj_max,
            "new_min": adj_min,
            "new_max": adj_max,
            "old_min": old_min,
            "old_max": old_max,
            "batch": int(round(batch)) if batch == int(round(batch)) else round(batch, 2),
            "status": status,
            "shelf_qty": shelf_qty,
            "free_qty": free_qty,
            "change_note": change_note,
            "is_zero_mandated": is_zero,
        }
        enriched_items.append(enriched_record)

    return enriched_items
