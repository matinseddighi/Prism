# -*- coding: utf-8 -*-
"""
ShelfMaster Engine - Scenarios & Presets Module
Applies standardized shelf stocking presets and category scenarios
to proposal report goods while strictly enforcing SOP limits and invariants.
"""

from __future__ import annotations

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


PRESETS: dict[str, dict[str, Any]] = {
    "روغن و برنج": {
        "keywords": ["روغن", "برنج"],
        "default_min": 35,
        "default_max": 100,
        "description": "تنظیم کف و سقف اقلام اساسی روغن و برنج",
    },
    "شوینده و بهداشتی": {
        "keywords": ["مايع", "مایع", "دستمال", "پودر", "شامپو", "صابون"],
        "default_min": 25,
        "default_max": 80,
        "description": "تنظیم کف و سقف محصولات شوینده و بهداشتی",
    },
    "ماکارونی و غلات": {
        "keywords": ["ماکاروني", "ماکارونی", "رشته", "لازانیا", "لازانيا"],
        "default_min": 30,
        "default_max": 150,
        "description": "تنظیم کف و سقف ماکارونی، رشته و لازانیا",
    },
    "قند و چای": {
        "keywords": ["قند", "چاي", "چای", "شکر"],
        "default_min": 30,
        "default_max": 150,
        "description": "تنظیم کف و سقف اقلام قند، شکر و چای",
    },
    "صفر کردن اقلام خاص": {
        "keywords": [],
        "default_min": 0,
        "default_max": 0,
        "description": "صفر کردن کف و سقف اقلام غیرفعال یا مشمول بند ۵ دستورالعمل SOP",
    },
}


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


def _find_preset(preset_name: str) -> tuple[str, dict[str, Any]] | None:
    """Resolve preset by direct key or normalized name."""
    if preset_name in PRESETS:
        return preset_name, PRESETS[preset_name]

    norm_target = normalize_persian_text(preset_name)
    for name, conf in PRESETS.items():
        if normalize_persian_text(name) == norm_target:
            return name, conf

    # Partial / keyword containment
    for name, conf in PRESETS.items():
        if norm_target in normalize_persian_text(name):
            return name, conf

    return None


def apply_preset(
    preset_name: str,
    rows: list[dict[str, Any]],
    store_name: str | None = None,
) -> list[dict[str, Any]]:
    """
    Apply a named stocking preset to eligible goods in rows.

    Parameters:
        preset_name: Key from PRESETS (e.g. 'روغن و برنج', 'شوینده و بهداشتی', etc.)
        rows: List of item dictionaries (from proposal report).
        store_name: Optional store filter query.

    Returns:
        list[dict]: List of updated item dictionaries with `new_min`, `new_max`,
                    and `note` ready for convert file export.
    """
    resolved = _find_preset(preset_name)
    if not resolved:
        valid_keys = ", ".join(PRESETS.keys())
        raise ValueError(f"سناریوی نامعتبر '{preset_name}'. سناریوهای معتبر: {valid_keys}")

    canonical_name, preset = resolved
    keywords = preset.get("keywords", [])
    norm_keywords = [normalize_persian_text(k) for k in keywords if k]

    default_min = _safe_int(preset.get("default_min", 0))
    default_max = _safe_int(preset.get("default_max", 0))

    modified_items: list[dict[str, Any]] = []

    # Check if this is the zeroing preset
    is_zero_preset = (default_min == 0 and default_max == 0) or ("صفر" in canonical_name)

    # If zero preset with no keywords, determine if we match zero-mandated or all passed rows
    has_any_mandated = any(
        is_zero_mandated(r.get("code", 0), r.get("name", ""))
        for r in rows
    )

    for r in rows:
        wh = str(r.get("wh_name", "")).strip()

        # Filter by store if requested
        if store_name and not is_store_match(store_name, wh):
            continue

        code = _safe_int(r.get("code", 0))
        name = str(r.get("name", ""))
        norm_name = normalize_persian_text(name)
        batch = _safe_float(r.get("batch", 1.0), default=1.0)
        if batch <= 0:
            batch = 1.0

        is_sop_zero = is_zero_mandated(code, name)

        # Match check
        matched = False
        if is_zero_preset:
            if norm_keywords:
                matched = any(kw in norm_name for kw in norm_keywords)
            else:
                # If inventory contains zero-mandated items, match those; otherwise match all filtered rows
                matched = is_sop_zero or (not has_any_mandated)
        else:
            if norm_keywords:
                matched = any(kw in norm_name for kw in norm_keywords)

        if not matched:
            continue

        prev_min = _safe_float(r.get("min", 0.0))
        prev_max = _safe_float(r.get("max", 0.0))
        shelf_qty = _safe_float(r.get("shelf_qty", 0.0))
        free_qty = _safe_float(r.get("free_qty", 0.0))
        status = str(r.get("status", ""))
        store_code = get_store_warehouse_code(wh)

        # Apply SOP Section 5 overriding rule: zero-mandated items must always stay 0
        if is_sop_zero or is_zero_preset:
            new_min = 0
            new_max = 0
            note = f"اعمال سناریوی '{canonical_name}' (کف و سقف صفر الزامی)"
        else:
            # Enforce Max > Min and slow-moving restrictions
            adj_min, adj_max, adj_note = validate_and_adjust_limits(
                default_min,
                default_max,
                batch,
                is_slow_moving=bool(r.get("is_slow_moving", False)),
            )
            new_min = adj_min
            new_max = adj_max
            note = f"اعمال سناریوی '{canonical_name}' ({new_min}/{new_max})"

        item_record: dict[str, Any] = {
            "wh_name": wh,
            "store_code": store_code,
            "code": code,
            "name": name,
            "prev_min": prev_min,
            "prev_max": prev_max,
            "min": prev_min,
            "max": prev_max,
            "new_min": new_min,
            "new_max": new_max,
            "batch": batch,
            "shelf_qty": shelf_qty,
            "free_qty": free_qty,
            "status": status,
            "note": note,
            "preset": canonical_name,
        }
        modified_items.append(item_record)

    return modified_items
