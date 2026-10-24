# -*- coding: utf-8 -*-
"""
ShelfMaster Engine - Diff Tracker & History Comparison Module
Tracks limit modifications, additions, deletions, and status toggles between proposal reports,
and generates formatted Persian Telegram / WhatsApp briefing notifications.
"""

from __future__ import annotations

from typing import Any

try:
    from .rules import normalize_persian_text
    from .audit import is_active_status
except (ImportError, ValueError):
    from rules import normalize_persian_text
    from audit import is_active_status


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


def compare_reports(
    prev_rows: list[dict[str, Any]],
    curr_rows: list[dict[str, Any]],
) -> dict[str, Any]:
    """
    Compare two proposal report snapshots to track min, max, and status changes.

    Matches goods by composite key (wh_name, code).

    Parameters:
        prev_rows: List of item dictionaries from earlier report.
        curr_rows: List of item dictionaries from current/newer report.

    Returns:
        dict: {
            "changes": list[dict],
            "added": list[dict],
            "removed": list[dict],
            "counts": {
                "total_changes": int,
                "min_changes": int,
                "max_changes": int,
                "status_changes": int,
                "added": int,
                "removed": int,
            },
            "summary": { ... }
        }
    """
    # Index previous rows by (normalized wh_name, code)
    prev_map: dict[tuple[str, int], dict[str, Any]] = {}
    for r in prev_rows:
        wh = normalize_persian_text(str(r.get("wh_name", "")))
        code = _safe_int(r.get("code", 0))
        if code > 0:
            prev_map[(wh, code)] = r

    # Index current rows by (normalized wh_name, code)
    curr_map: dict[tuple[str, int], dict[str, Any]] = {}
    for r in curr_rows:
        wh = normalize_persian_text(str(r.get("wh_name", "")))
        code = _safe_int(r.get("code", 0))
        if code > 0:
            curr_map[(wh, code)] = r

    changes: list[dict[str, Any]] = []
    min_changes_count = 0
    max_changes_count = 0
    status_changes_count = 0

    # Detect modifications for common items
    for key, curr in curr_map.items():
        if key in prev_map:
            prev = prev_map[key]

            prev_min = _safe_float(prev.get("min", 0.0))
            curr_min = _safe_float(curr.get("min", 0.0))
            prev_max = _safe_float(prev.get("max", 0.0))
            curr_max = _safe_float(curr.get("max", 0.0))

            prev_status = str(prev.get("status", "")).strip()
            curr_status = str(curr.get("status", "")).strip()

            min_changed = abs(prev_min - curr_min) > 1e-4
            max_changed = abs(prev_max - curr_max) > 1e-4

            # Compare status normalized
            norm_prev_status = normalize_persian_text(prev_status)
            norm_curr_status = normalize_persian_text(curr_status)
            status_changed = norm_prev_status != norm_curr_status

            if min_changed or max_changed or status_changed:
                change_types: list[str] = []
                summary_parts: list[str] = []

                if min_changed:
                    min_changes_count += 1
                    change_types.append("min")
                    summary_parts.append(f"کف: {int(prev_min)} -> {int(curr_min)}")

                if max_changed:
                    max_changes_count += 1
                    change_types.append("max")
                    summary_parts.append(f"سقف: {int(prev_max)} -> {int(curr_max)}")

                if status_changed:
                    status_changes_count += 1
                    change_types.append("status")
                    summary_parts.append(f"وضعیت: {prev_status} -> {curr_status}")

                change_record: dict[str, Any] = {
                    "wh_name": curr.get("wh_name", prev.get("wh_name", "")),
                    "code": key[1],
                    "name": curr.get("name", prev.get("name", "")),
                    "batch": _safe_float(curr.get("batch", prev.get("batch", 1.0))),
                    "prev_min": prev_min,
                    "curr_min": curr_min,
                    "min_changed": min_changed,
                    "prev_max": prev_max,
                    "curr_max": curr_max,
                    "max_changed": max_changed,
                    "prev_status": prev_status,
                    "curr_status": curr_status,
                    "status_changed": status_changed,
                    "change_types": change_types,
                    "summary_text": " | ".join(summary_parts),
                }
                changes.append(change_record)

    # Added items (in curr but not prev)
    added: list[dict[str, Any]] = [
        curr for key, curr in curr_map.items() if key not in prev_map
    ]

    # Removed items (in prev but not curr)
    removed: list[dict[str, Any]] = [
        prev for key, prev in prev_map.items() if key not in curr_map
    ]

    counts = {
        "total_changes": len(changes),
        "min_changes": min_changes_count,
        "max_changes": max_changes_count,
        "status_changes": status_changes_count,
        "added": len(added),
        "removed": len(removed),
    }

    return {
        "changes": changes,
        "added": added,
        "removed": removed,
        "counts": counts,
        "summary": counts,
    }


def generate_telegram_summary(
    store_name: str,
    changes: list[dict[str, Any]],
    target_date: str = "1405.07.29",
) -> str:
    """
    Format a concise, elegant Persian Telegram/WhatsApp summary message for store managers.

    Parameters:
        store_name: Persian store name (e.g. 'فضل', 'بوژان', 'فردوسی شمالی').
        changes: List of change dictionaries.
        target_date: Shamsi date of the modifications.

    Returns:
        str: Ready-to-send Persian formatted text message.
    """
    clean_store = store_name.strip() if store_name else "کل شعب"

    if not changes:
        return (
            f"✅ **پیام سامانه ShelfMaster**\n"
            f"🏪 **شعبه:** {clean_store}\n"
            f"📅 **تاریخ:** {target_date}\n\n"
            f"هیچ تغییری در کف و سقف اقلام این شعبه ثبت نشده است."
        )

    lines: list[str] = [
        f"📊 **گزارش تغییرات کف و سقف قفسه**",
        f"🏪 **شعبه:** {clean_store}",
        f"📅 **تاریخ اعمال:** {target_date}",
        f"📦 **تعداد اقلام اصلاح‌شده:** {len(changes)} کالا",
        "────────────────────",
    ]

    for idx, item in enumerate(changes, start=1):
        code = item.get("code", 0)
        name = str(item.get("name", "نامشخص")).strip()

        # Format min/max display
        prev_min = int(round(_safe_float(item.get("prev_min", item.get("min", 0)))))
        curr_min = int(round(_safe_float(item.get("curr_min", item.get("new_min", 0)))))
        prev_max = int(round(_safe_float(item.get("prev_max", item.get("max", 0)))))
        curr_max = int(round(_safe_float(item.get("curr_max", item.get("new_max", 0)))))

        min_part = f"کف: {prev_min} ⬅️ {curr_min}"
        max_part = f"سقف: {prev_max} ⬅️ {curr_max}"

        lines.append(f"{idx}. 🔹 **کد {code}** | {name}")
        lines.append(f"   ▫️ {min_part} | {max_part}")

        if item.get("status_changed"):
            p_st = item.get("prev_status", "")
            c_st = item.get("curr_status", "")
            lines.append(f"   ▫️ وضعیت: {p_st} ⬅️ {c_st}")

    lines.append("────────────────────")
    lines.append("✨ *سامانه هوشمند ShelfMaster - کنترل موجودی قفسه*")

    return "\n".join(lines)
