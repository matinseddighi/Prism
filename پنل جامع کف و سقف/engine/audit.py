# -*- coding: utf-8 -*-
"""
ShelfMaster Engine - Audit & Anomaly Detection Module
Scans ERP proposal report records for discrepancies, invariant violations,
and SOP infractions, with automated fix generation.
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


def is_active_status(status: Any) -> bool:
    """Check if item status indicates active in store."""
    if status is None:
        return False
    s = str(status).strip()
    if not s:
        return False
    norm = normalize_persian_text(s)
    if "غیرفعال" in norm or "غیر فعال" in norm or "inactive" in norm or norm == "0":
        return False
    if "فعال" in norm or "active" in norm or norm == "1" or norm == "true":
        return True
    return False


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


def run_audit(rows: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Run comprehensive audit on proposal report rows to detect anomalies.

    Categories:
    - pish_over_max: rows where pish_raw > max > 0 (uncapped 7-day sales proposal bug)
    - round_over_max: rows where pish_round > max > 0 (carton rounding exceeded max bug)
    - min_ge_max: rows where min >= max > 0 or (min > 0 and max == 0) (ERP limit invariant violation)
    - blank_or_zero_active: active items with min == 0 and max == 0 (excluding permanent SOP zero items)
    - sop_violations: items matching is_zero_mandated but having min > 0 or max > 0

    Returns:
        dict: {
            "total_anomalies": int,
            "categories": { ... },
            "counts": { ... },
            "by_store": { ... },
            "store_breakdown": { ... },
            "pish_over_max": list,
            "round_over_max": list,
            "min_ge_max": list,
            "blank_or_zero_active": list,
            "sop_violations": list,
        }
    """
    pish_over_max: list[dict[str, Any]] = []
    round_over_max: list[dict[str, Any]] = []
    min_ge_max: list[dict[str, Any]] = []
    blank_or_zero_active: list[dict[str, Any]] = []
    sop_violations: list[dict[str, Any]] = []

    store_stats: dict[str, dict[str, int]] = {}

    def _ensure_store(wh: str) -> dict[str, int]:
        name = wh if wh else "نامشخص"
        if name not in store_stats:
            store_stats[name] = {
                "total": 0,
                "pish_over_max": 0,
                "round_over_max": 0,
                "min_ge_max": 0,
                "blank_or_zero_active": 0,
                "sop_violations": 0,
            }
        return store_stats[name]

    for r in rows:
        code = _safe_int(r.get("code", 0))
        name = str(r.get("name", ""))
        wh = str(r.get("wh_name", "")).strip()

        min_val = _safe_float(r.get("min", 0.0))
        max_val = _safe_float(r.get("max", 0.0))
        pish_raw = _safe_float(r.get("pish_raw", 0.0))
        pish_round = _safe_float(r.get("pish_round", 0.0))
        status = r.get("status", "")

        is_sop_zero = is_zero_mandated(code, name)
        active = is_active_status(status)

        row_anomalies: list[str] = []

        # 1. SOP Violations: zero-mandated item with min > 0 or max > 0
        if is_sop_zero:
            if min_val > 0 or max_val > 0:
                row_copy = dict(r)
                row_copy["anomaly_reason"] = "تخلف از الزامات بخش ۵ SOP (اقلام با کف و سقف دائمی صفر)"
                sop_violations.append(row_copy)
                row_anomalies.append("sop_violations")
                st = _ensure_store(wh)
                st["sop_violations"] += 1
        else:
            # 2. Blank or zero active: active shelf item with min=0 and max=0 (excluding SOP zero)
            if active and min_val == 0 and max_val == 0:
                row_copy = dict(r)
                row_copy["anomaly_reason"] = "کالای فعال در شلف بدون کف و سقف مجاز (Min=0, Max=0)"
                blank_or_zero_active.append(row_copy)
                row_anomalies.append("blank_or_zero_active")
                st = _ensure_store(wh)
                st["blank_or_zero_active"] += 1

            # 3. ERP Limit Invariant Violation: min >= max > 0 or (min > 0 and max == 0)
            if (min_val >= max_val and max_val > 0) or (min_val > 0 and max_val == 0):
                row_copy = dict(r)
                row_copy["anomaly_reason"] = f"نقض شرط سلامت ERP (کف: {min_val} >= سقف: {max_val})"
                min_ge_max.append(row_copy)
                row_anomalies.append("min_ge_max")
                st = _ensure_store(wh)
                st["min_ge_max"] += 1

            # 4. pish_raw > max > 0 (uncapped proposal bug)
            if max_val > 0 and pish_raw > max_val:
                row_copy = dict(r)
                row_copy["anomaly_reason"] = f"پیشنهاد ارسال خام بیش از سقف (پیشنهاد: {pish_raw} > سقف: {max_val})"
                pish_over_max.append(row_copy)
                row_anomalies.append("pish_over_max")
                st = _ensure_store(wh)
                st["pish_over_max"] += 1

            # 5. pish_round > max > 0 (carton rounding over max bug)
            if max_val > 0 and pish_round > max_val:
                row_copy = dict(r)
                row_copy["anomaly_reason"] = f"پیشنهاد ارسال گرد شده بیش از سقف (پیشنهاد: {pish_round} > سقف: {max_val})"
                round_over_max.append(row_copy)
                row_anomalies.append("round_over_max")
                st = _ensure_store(wh)
                st["round_over_max"] += 1

        if row_anomalies:
            st = _ensure_store(wh)
            st["total"] += len(row_anomalies)

    total_count = (
        len(pish_over_max)
        + len(round_over_max)
        + len(min_ge_max)
        + len(blank_or_zero_active)
        + len(sop_violations)
    )

    categories = {
        "pish_over_max": pish_over_max,
        "round_over_max": round_over_max,
        "min_ge_max": min_ge_max,
        "blank_or_zero_active": blank_or_zero_active,
        "sop_violations": sop_violations,
    }

    counts = {
        "pish_over_max": len(pish_over_max),
        "round_over_max": len(round_over_max),
        "min_ge_max": len(min_ge_max),
        "blank_or_zero_active": len(blank_or_zero_active),
        "sop_violations": len(sop_violations),
        "total": total_count,
    }

    return {
        "total_anomalies": total_count,
        "categories": categories,
        "counts": counts,
        "by_store": store_stats,
        "store_breakdown": store_stats,
        "pish_over_max": pish_over_max,
        "round_over_max": round_over_max,
        "min_ge_max": min_ge_max,
        "blank_or_zero_active": blank_or_zero_active,
        "sop_violations": sop_violations,
    }


def generate_auto_fix_items(
    audit_results: dict[str, Any],
    store_name: str | None = None,
) -> list[dict[str, Any]]:
    """
    Produce a corrected list of items ready for convert export from audit results.

    Deduplicates items, fixes invariant violations, zeros SOP violations,
    and bumps limits safely according to carton size and proposal demands.

    Parameters:
        audit_results: Return dict from `run_audit`.
        store_name: Optional store filter query.

    Returns:
        list[dict]: List of items with `new_min`, `new_max`, `note` ready for convert file generation.
    """
    # Collect all anomalous items across categories
    categories = audit_results.get("categories", {})
    all_anomalous: list[tuple[str, dict[str, Any]]] = []

    cat_keys = [
        "sop_violations",
        "min_ge_max",
        "round_over_max",
        "pish_over_max",
        "blank_or_zero_active",
    ]

    for cat in cat_keys:
        items = categories.get(cat, audit_results.get(cat, []))
        for it in items:
            all_anomalous.append((cat, it))

    # Deduplicate by (wh_name, code)
    seen_keys: set[tuple[str, int]] = set()
    deduped_items: list[tuple[list[str], dict[str, Any]]] = []
    item_map: dict[tuple[str, int], int] = {}

    for cat, it in all_anomalous:
        wh = str(it.get("wh_name", "")).strip()
        code = _safe_int(it.get("code", 0))
        key = (wh, code)

        if store_name:
            if not is_store_match(store_name, wh):
                continue

        if key in item_map:
            idx = item_map[key]
            if cat not in deduped_items[idx][0]:
                deduped_items[idx][0].append(cat)
        else:
            item_map[key] = len(deduped_items)
            deduped_items.append(([cat], it))

    fixed_items: list[dict[str, Any]] = []

    for issue_types, it in deduped_items:
        code = _safe_int(it.get("code", 0))
        name = str(it.get("name", ""))
        wh = str(it.get("wh_name", ""))
        prev_min = _safe_float(it.get("min", 0.0))
        prev_max = _safe_float(it.get("max", 0.0))
        batch = _safe_float(it.get("batch", 1.0), default=1.0)
        if batch <= 0:
            batch = 1.0

        pish_raw = _safe_float(it.get("pish_raw", 0.0))
        pish_round = _safe_float(it.get("pish_round", 0.0))
        shelf_qty = _safe_float(it.get("shelf_qty", 0.0))
        free_qty = _safe_float(it.get("free_qty", 0.0))
        status = str(it.get("status", ""))
        store_code = get_store_warehouse_code(wh)

        # 1. SOP Violations: Absolute priority to zero out
        if is_zero_mandated(code, name) or "sop_violations" in issue_types:
            new_min = 0
            new_max = 0
            note = "اصلاح مغایرت SOP (صفر کردن قطعی کف و سقف)"
        # 2. Blank or zero active: set standard minimum facing and batch ceiling
        elif "blank_or_zero_active" in issue_types and prev_min == 0 and prev_max == 0:
            new_min = 2
            calc_max = max(int(round(batch)), 4, new_min * 2)
            adj_min, adj_max, adj_note = validate_and_adjust_limits(
                new_min, calc_max, batch, is_slow_moving=bool(it.get("is_slow_moving", False))
            )
            new_min = adj_min
            new_max = adj_max
            note = f"تعیین کف و سقف اولیه کالای فعال ({new_min}/{new_max})"
        # 3. Limit anomalies (min_ge_max, round_over_max, pish_over_max)
        else:
            new_min = int(round(prev_min))
            candidate_max = int(round(prev_max))

            # If proposal exceeded max, elevate candidate max to cover proposal
            max_pish = int(round(max(pish_round, pish_raw)))
            if max_pish > candidate_max:
                candidate_max = max_pish

            adj_min, adj_max, adj_note = validate_and_adjust_limits(
                new_min, candidate_max, batch, is_slow_moving=bool(it.get("is_slow_moving", False))
            )
            new_min = adj_min
            new_max = adj_max

            reasons: list[str] = []
            if "min_ge_max" in issue_types:
                reasons.append("اصلاح سقف <= کف")
            if "pish_over_max" in issue_types or "round_over_max" in issue_types:
                reasons.append(f"تطبیق با پیشنهاد ({max_pish})")
            if not reasons:
                reasons.append(adj_note)

            note = " | ".join(reasons)

        fixed_record: dict[str, Any] = {
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
            "anomalies": issue_types,
        }
        fixed_items.append(fixed_record)

    return fixed_items
