# -*- coding: utf-8 -*-
"""
ShelfMaster Engine - Fast Streaming Proposal Report Reader
High-speed streaming parser for ERP Proposal Report XLSX files using zipfile and xml.etree.ElementTree.
"""

from __future__ import annotations

import os
import re
import json
import hashlib
import zipfile
import xml.etree.ElementTree as ET
from typing import Any

try:
    from .rules import normalize_persian_text, get_store_warehouse_code
except (ImportError, ValueError):
    from rules import normalize_persian_text, get_store_warehouse_code


# 1. Canonical ERP Report Header Mappings
CANONICAL_HEADERS: dict[str, str] = {
    "نام فروشگاه": "wh_name",
    "کد کالا": "code",
    "نام کالا": "name",
    "کف فعلی قفسه": "min",
    "سقف فعلی قفسه": "max",
    "تعداد بچ مادر": "batch",
    "موجودی انبار قفسه": "shelf_qty",
    "موجودی قابل ارسال": "free_qty",
    "وضعیت کالا در فروشگاه": "status",
    "پیشنهاد ارسال گرد شده به بالا/پایین": "pish_round",
    "پیشنهاد ارسال": "pish_raw",
}

# 2. Secondary Synonyms / Fallback Header Mappings
SECONDARY_HEADERS: dict[str, str] = {
    "فروشگاه": "wh_name",
    "نام انبار": "wh_name",
    "کد": "code",
    "شرح کالا": "name",
    "عنوان کالا": "name",
    "کف قفسه": "min",
    "کف": "min",
    "سقف قفسه": "max",
    "سقف": "max",
    "بچ مادر": "batch",
    "تعداد در کارتن": "batch",
    "بچ": "batch",
    "موجودی قفسه": "shelf_qty",
    "موجودی آزاد": "free_qty",
    "وضعیت کالا": "status",
    "وضعیت": "status",
    "پیشنهاد ارسال گرد شده": "pish_round",
    "پیشنهاد گرد شده": "pish_round",
    "پیشنهاد ارسال خام": "pish_raw",
}


def _clean_header_text(text: Any) -> str:
    """Normalize header text for robust comparison."""
    if text is None:
        return ""
    t = str(text)
    t = t.replace("ي", "ی").replace("ك", "ک").replace("ة", "ه")
    t = t.replace("\u200c", " ")
    t = re.sub(r"\s+", " ", t)
    return t.strip().lower()


def _col_from_ref(ref: str | None, fallback_idx: int = 1) -> str:
    """Extract column letters from cell reference (e.g. 'AN93742' -> 'AN')."""
    if ref:
        letters = []
        for ch in ref:
            if ch.isalpha():
                letters.append(ch.upper())
            else:
                break
        if letters:
            return "".join(letters)
    
    # Fallback 1-based index to Excel column name
    n = fallback_idx
    result = []
    while n > 0:
        n, remainder = divmod(n - 1, 26)
        result.append(chr(65 + remainder))
    return "".join(reversed(result))


def _extract_shared_strings(zf: zipfile.ZipFile) -> list[str]:
    """Stream xl/sharedStrings.xml into a list of strings."""
    shared_strings: list[str] = []
    if "xl/sharedStrings.xml" not in zf.namelist():
        return shared_strings

    with zf.open("xl/sharedStrings.xml") as f:
        context = ET.iterparse(f, events=("start", "end"))
        _, root = next(context)
        for event, elem in context:
            if event == "end" and elem.tag.endswith("si"):
                # Captures direct <t> and formatted rich-text <r><t>
                text = "".join(elem.itertext())
                shared_strings.append(text)
                elem.clear()
                root.clear()

    return shared_strings


def _find_target_sheet(zf: zipfile.ZipFile) -> str:
    """Locate sheet1.xml or first available worksheet in the package."""
    namelist = zf.namelist()
    if "xl/worksheets/sheet1.xml" in namelist:
        return "xl/worksheets/sheet1.xml"

    # Search for any worksheet xml
    sheets = [n for n in namelist if n.startswith("xl/worksheets/") and n.endswith(".xml")]
    if sheets:
        sheets.sort()
        return sheets[0]

    raise FileNotFoundError("No worksheet found in Excel package.")


def _parse_cell_value(c_elem: ET.Element, shared_strings: list[str]) -> Any:
    """
    Extract cell value taking into account cell types:
    - 's': shared string
    - 'is' / 'inlineStr': inline string
    - 'b': boolean
    - 'n' or empty: number or raw value
    """
    cell_type = c_elem.get("t", "")
    val_text: str | None = None
    is_text: str | None = None

    for child in c_elem:
        local_tag = child.tag.split("}")[-1]
        if local_tag == "v":
            val_text = child.text
        elif local_tag == "is":
            is_text = "".join(child.itertext())

    if cell_type == "s":
        if val_text is not None and val_text.strip():
            try:
                idx = int(val_text.strip())
                if 0 <= idx < len(shared_strings):
                    return shared_strings[idx]
            except ValueError:
                return ""
        return ""

    if cell_type in ("inlineStr", "is"):
        if is_text is not None:
            return is_text
        return val_text or ""

    if cell_type == "b":
        return val_text == "1"

    if cell_type == "e":
        return ""

    return val_text if val_text is not None else ""


def _to_int(val: Any) -> int:
    """Safely convert value to int."""
    if val is None or val == "":
        return 0
    try:
        return int(float(str(val).strip()))
    except (ValueError, TypeError):
        return 0


def _to_float(val: Any, default: float = 0.0) -> float:
    """Safely convert value to float."""
    if val is None or val == "":
        return default
    try:
        return float(str(val).strip())
    except (ValueError, TypeError):
        return default


def _to_str(val: Any) -> str:
    """Safely convert value to stripped string."""
    if val is None:
        return ""
    return str(val).strip()


# Global In-Memory Cache for ultra-fast repeated loads (< 0.001s)
_MEMORY_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}


def clear_memory_cache() -> None:
    """Clear in-memory cache."""
    _MEMORY_CACHE.clear()


def parse_send_report(file_path: str, cache_dir: str | None = None) -> dict[str, Any]:
    """
    Streaming parser for proposal report XLSX file.
    
    Parameters:
        file_path (str): Path to XLSX proposal report file.
        cache_dir (str | None): Directory to store/retrieve JSON cache.
        
    Returns:
        dict: {
            "source_file": file_path,
            "goods_count": len(rows),
            "stores": sorted(stores),
            "rows": rows
        }
    """
    if not os.path.isfile(file_path):
        raise FileNotFoundError(f"File not found: {file_path}")

    abs_path = os.path.abspath(file_path)
    file_mtime = os.path.getmtime(abs_path)
    file_size = os.path.getsize(abs_path)

    # 1. Check in-memory cache first for instant retrieval (< 0.001s)
    if abs_path in _MEMORY_CACHE:
        cached_mtime, cached_data = _MEMORY_CACHE[abs_path]
        if cached_mtime == file_mtime:
            return cached_data

    cache_file_path: str | None = None

    # 2. Check JSON disk cache if cache_dir is specified
    if cache_dir:
        abs_cache_dir = os.path.abspath(cache_dir)
        os.makedirs(abs_cache_dir, exist_ok=True)
        hash_id = hashlib.sha256(f"{abs_path}_{file_size}".encode("utf-8")).hexdigest()[:12]
        base_name = re.sub(r"[^a-zA-Z0-9_\-\.]", "_", os.path.splitext(os.path.basename(file_path))[0])
        cache_file_path = os.path.join(abs_cache_dir, f"{base_name}_{hash_id}.cache.json")

        if os.path.isfile(cache_file_path):
            try:
                with open(cache_file_path, "r", encoding="utf-8") as cf:
                    cached_obj = json.load(cf)
                if cached_obj.get("mtime") == file_mtime:
                    payload = cached_obj["payload"]
                    _MEMORY_CACHE[abs_path] = (file_mtime, payload)
                    return payload
            except Exception:
                # Corrupted or unreadable cache - re-parse
                pass

    # Streaming parsing via zipfile + iterparse
    with zipfile.ZipFile(abs_path, "r") as zf:
        shared_strings = _extract_shared_strings(zf)
        sheet_path = _find_target_sheet(zf)

        # Mappings: column letter -> target field name
        col_to_field: dict[str, str] = {}
        headers_parsed = False

        norm_canonical = {_clean_header_text(k): v for k, v in CANONICAL_HEADERS.items()}
        norm_secondary = {_clean_header_text(k): v for k, v in SECONDARY_HEADERS.items()}

        rows: list[dict[str, Any]] = []
        stores: set[str] = set()

        with zf.open(sheet_path) as sheet_f:
            context = ET.iterparse(sheet_f, events=("start", "end"))
            _, root = next(context)

            for event, elem in context:
                if event == "end" and elem.tag.endswith("row"):
                    # Process header row (first row encountered)
                    if not headers_parsed:
                        raw_headers: dict[str, str] = {}
                        col_idx = 0
                        for child in elem:
                            if child.tag.endswith("c"):
                                col_idx += 1
                                col = _col_from_ref(child.get("r"), col_idx)
                                val = _to_str(_parse_cell_value(child, shared_strings))
                                if val:
                                    raw_headers[col] = val

                        # Match headers: Primary exact normalized matching first
                        matched_fields: set[str] = set()
                        for col, raw_text in raw_headers.items():
                            cleaned = _clean_header_text(raw_text)
                            if cleaned in norm_canonical:
                                target_field = norm_canonical[cleaned]
                                if target_field not in matched_fields:
                                    col_to_field[col] = target_field
                                    matched_fields.add(target_field)

                        # Match remaining unmapped headers via Secondary synonyms
                        for col, raw_text in raw_headers.items():
                            if col in col_to_field:
                                continue
                            cleaned = _clean_header_text(raw_text)
                            if cleaned in norm_secondary:
                                target_field = norm_secondary[cleaned]
                                if target_field not in matched_fields:
                                    col_to_field[col] = target_field
                                    matched_fields.add(target_field)

                        headers_parsed = True
                        elem.clear()
                        root.clear()
                        continue

                    # Process data row
                    row_data: dict[str, Any] = {
                        "wh_name": "",
                        "code": 0,
                        "name": "",
                        "min": 0.0,
                        "max": 0.0,
                        "batch": 1.0,
                        "shelf_qty": 0.0,
                        "free_qty": 0.0,
                        "status": "",
                        "pish_round": 0.0,
                        "pish_raw": 0.0,
                    }

                    col_idx = 0
                    for child in elem:
                        if child.tag.endswith("c"):
                            col_idx += 1
                            col = _col_from_ref(child.get("r"), col_idx)
                            if col in col_to_field:
                                field = col_to_field[col]
                                val = _parse_cell_value(child, shared_strings)
                                row_data[field] = val

                    # Validate code: must be a positive integer
                    code_int = _to_int(row_data["code"])
                    if code_int <= 0:
                        elem.clear()
                        root.clear()
                        continue

                    batch_val = _to_float(row_data["batch"], default=1.0)
                    if batch_val <= 0:
                        batch_val = 1.0

                    wh_name = _to_str(row_data["wh_name"])

                    record = {
                        "wh_name": wh_name,
                        "code": code_int,
                        "name": _to_str(row_data["name"]),
                        "min": _to_float(row_data["min"]),
                        "max": _to_float(row_data["max"]),
                        "batch": batch_val,
                        "shelf_qty": _to_float(row_data["shelf_qty"]),
                        "free_qty": _to_float(row_data["free_qty"]),
                        "status": _to_str(row_data["status"]),
                        "pish_round": _to_float(row_data["pish_round"]),
                        "pish_raw": _to_float(row_data["pish_raw"]),
                    }

                    if wh_name:
                        stores.add(wh_name)

                    rows.append(record)

                    elem.clear()
                    root.clear()

    result: dict[str, Any] = {
        "source_file": file_path,
        "goods_count": len(rows),
        "stores": sorted(stores),
        "rows": rows,
    }

    # Save to in-memory cache
    _MEMORY_CACHE[abs_path] = (file_mtime, result)

    # Write cache if enabled
    if cache_file_path:
        try:
            with open(cache_file_path, "w", encoding="utf-8") as cf:
                json.dump({"mtime": file_mtime, "payload": result}, cf, ensure_ascii=False)
        except Exception:
            pass

    return result


def is_store_match(query: str, candidate: str) -> bool:
    """
    Determine if store query matches candidate name with alias tolerance.
    Handles exact, normalized glyphs, warehouse code matching, and substring overlap.
    """
    if not query or not candidate:
        return False

    q_str = str(query).strip()
    c_str = str(candidate).strip()
    if q_str == c_str:
        return True

    norm_q = normalize_persian_text(q_str)
    norm_c = normalize_persian_text(c_str)
    if norm_q == norm_c:
        return True

    # 4-Digit Warehouse Code Match (e.g. 'فردوسی' and 'فردوسی شمالی' both have code 3601)
    code_q = get_store_warehouse_code(q_str)
    code_c = get_store_warehouse_code(c_str)
    if code_q > 0 and code_c > 0 and code_q == code_c:
        return True

    # Substring / Token containment fallback
    if norm_q in norm_c or norm_c in norm_q:
        return True

    return False


def get_store_records(data: dict[str, Any], store_name: str) -> list[dict[str, Any]]:
    """
    Filter data["rows"] for the given store name with alias tolerance.
    
    Parameters:
        data (dict): Parsed proposal report dictionary containing 'rows' and 'stores'.
        store_name (str): Store name query (e.g. 'فردوسی', 'فضل', 'بوژان').
        
    Returns:
        list[dict]: List of matching goods records for the specified store.
    """
    if not data or not store_name:
        return []

    rows: list[dict[str, Any]] = data.get("rows", [])
    if not rows:
        return []

    stores: list[str] = data.get("stores", [])
    # Find candidate stores from aggregated stores list
    matched_stores = {s for s in stores if is_store_match(store_name, s)}

    if matched_stores:
        return [r for r in rows if r.get("wh_name") in matched_stores]

    # Fallback if data["stores"] was not populated
    return [r for r in rows if is_store_match(store_name, r.get("wh_name", ""))]
