# -*- coding: utf-8 -*-
"""
Tests for ShelfMaster Audit, Diff Tracker, and Presets Modules
Verifies anomaly classification, auto-fixing, report comparison,
Telegram summary formatting, and category preset applications.
"""

import os
import sys
import pytest

# Ensure ShelfMaster root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from engine.audit import (
    run_audit,
    generate_auto_fix_items,
    is_active_status,
)
from engine.diff_tracker import (
    compare_reports,
    generate_telegram_summary,
)
from engine.presets import (
    PRESETS,
    apply_preset,
)
from engine.convert import (
    generate_tsv_clipboard,
    generate_convert_file,
)


@pytest.fixture
def sample_audit_rows():
    """Sample dataset covering normal rows and all 5 anomaly categories."""
    return [
        # Normal item
        {
            "wh_name": "فضل",
            "code": 1001,
            "name": "چیپس سیب زمینی چی توز 100 گرم",
            "min": 10.0,
            "max": 30.0,
            "batch": 12.0,
            "shelf_qty": 15.0,
            "free_qty": 50.0,
            "status": "فعال",
            "pish_round": 12.0,
            "pish_raw": 8.5,
        },
        # 1. pish_over_max (pish_raw > max > 0)
        {
            "wh_name": "فضل",
            "code": 1002,
            "name": "بیسکویت ساقه طلایی مینو",
            "min": 10.0,
            "max": 20.0,
            "batch": 24.0,
            "shelf_qty": 5.0,
            "free_qty": 100.0,
            "status": "فعال",
            "pish_round": 24.0,
            "pish_raw": 28.0,  # 28.0 > max 20.0
        },
        # 2. round_over_max (pish_round > max > 0, while pish_raw <= max)
        {
            "wh_name": "فضل",
            "code": 1003,
            "name": "شکلات تلخ پارمیدا",
            "min": 5.0,
            "max": 15.0,
            "batch": 20.0,
            "shelf_qty": 2.0,
            "free_qty": 40.0,
            "status": "فعال",
            "pish_round": 20.0,  # 20.0 > max 15.0
            "pish_raw": 12.0,   # <= max 15.0
        },
        # 3. min_ge_max (min >= max > 0)
        {
            "wh_name": "بوژان",
            "code": 1004,
            "name": "رب گوجه فرنگی 800 گرم طبیعت",
            "min": 24.0,
            "max": 12.0,  # min 24 >= max 12
            "batch": 12.0,
            "shelf_qty": 10.0,
            "free_qty": 200.0,
            "status": "فعال",
            "pish_round": 12.0,
            "pish_raw": 10.0,
        },
        # 4. blank_or_zero_active (active item with min=0, max=0, not SOP zero)
        {
            "wh_name": "بوژان",
            "code": 1005,
            "name": "روغن سرخ کردنی 1.5 لیتری اویلا",
            "min": 0.0,
            "max": 0.0,
            "batch": 6.0,
            "shelf_qty": 10.0,
            "free_qty": 80.0,
            "status": "فعال",  # Active but has 0/0 limits
            "pish_round": 0.0,
            "pish_raw": 0.0,
        },
        # Normal inactive item with 0/0 (not an anomaly)
        {
            "wh_name": "بوژان",
            "code": 1006,
            "name": "محصول از رده خارج",
            "min": 0.0,
            "max": 0.0,
            "batch": 1.0,
            "shelf_qty": 0.0,
            "free_qty": 0.0,
            "status": "غیرفعال",
            "pish_round": 0.0,
            "pish_raw": 0.0,
        },
        # 5. sop_violations (zero-mandated item having positive limits)
        {
            "wh_name": "فضل",
            "code": 9900910,  # مایع دستشویی ۱۰ لیتری گلرنگ
            "name": "مایع دستشویی 10 لیتری گلرنگ",
            "min": 5.0,  # Should be 0
            "max": 10.0,  # Should be 0
            "batch": 1.0,
            "shelf_qty": 2.0,
            "free_qty": 10.0,
            "status": "فعال",
            "pish_round": 0.0,
            "pish_raw": 0.0,
        },
        # SOP item correctly set to 0/0 (not an anomaly)
        {
            "wh_name": "فضل",
            "code": 9902937,  # سبد سفید ۲۵ کیلویی پالود پلاست
            "name": "سبد سفید 25 کیلویی پالود پلاست",
            "min": 0.0,
            "max": 0.0,
            "batch": 1.0,
            "shelf_qty": 0.0,
            "free_qty": 0.0,
            "status": "فعال",
            "pish_round": 0.0,
            "pish_raw": 0.0,
        },
    ]


# ==============================================================================
# 1. Tests for audit.py
# ==============================================================================

def test_is_active_status():
    """Verify active status detection with Persian and normalized variations."""
    assert is_active_status("فعال") is True
    assert is_active_status("کالای فعال") is True
    assert is_active_status("active") is True
    assert is_active_status("1") is True
    assert is_active_status("غیرفعال") is False
    assert is_active_status("غیر فعال") is False
    assert is_active_status("inactive") is False
    assert is_active_status("0") is False
    assert is_active_status("") is False
    assert is_active_status(None) is False


def test_run_audit_all_five_categories(sample_audit_rows):
    """Test that run_audit correctly classifies all 5 anomaly types."""
    results = run_audit(sample_audit_rows)

    # 1. Check pish_over_max
    pish_codes = [r["code"] for r in results["pish_over_max"]]
    assert 1002 in pish_codes
    assert len(results["pish_over_max"]) == 1

    # 2. Check round_over_max
    # Note: 1002 has pish_round (24) > max (20) AND pish_raw (28) > max (20),
    # while 1003 has pish_round (20) > max (15). Both have round_over_max!
    round_codes = [r["code"] for r in results["round_over_max"]]
    assert 1002 in round_codes
    assert 1003 in round_codes

    # 3. Check min_ge_max
    min_ge_max_codes = [r["code"] for r in results["min_ge_max"]]
    assert 1004 in min_ge_max_codes
    assert 1001 not in min_ge_max_codes

    # 4. Check blank_or_zero_active
    blank_codes = [r["code"] for r in results["blank_or_zero_active"]]
    assert 1005 in blank_codes
    assert 1006 not in blank_codes  # Inactive item, should NOT be flagged

    # 5. Check sop_violations
    sop_codes = [r["code"] for r in results["sop_violations"]]
    assert 9900910 in sop_codes
    assert 9902937 not in sop_codes  # Correctly 0/0, should NOT be flagged

    # Overall totals
    assert results["total_anomalies"] > 0
    assert results["counts"]["total"] == results["total_anomalies"]


def test_audit_store_breakdown(sample_audit_rows):
    """Verify that store breakdown correctly counts anomalies by store."""
    results = run_audit(sample_audit_rows)
    breakdown = results["by_store"]

    assert "فضل" in breakdown
    assert "بوژان" in breakdown

    assert breakdown["فضل"]["sop_violations"] == 1
    assert breakdown["بوژان"]["min_ge_max"] == 1
    assert breakdown["بوژان"]["blank_or_zero_active"] == 1


def test_generate_auto_fix_items(sample_audit_rows):
    """Verify automated repair of all anomalies and store filtering."""
    results = run_audit(sample_audit_rows)
    fixed = generate_auto_fix_items(results)

    fixed_map = {it["code"]: it for it in fixed}

    # 1. SOP Violation fixed to 0/0
    sop_fix = fixed_map[9900910]
    assert sop_fix["new_min"] == 0
    assert sop_fix["new_max"] == 0
    assert "SOP" in sop_fix["note"]

    # 2. min_ge_max fixed to satisfy Max > Min
    inv_fix = fixed_map[1004]
    assert inv_fix["new_max"] > inv_fix["new_min"]
    assert inv_fix["new_min"] == 24
    assert inv_fix["new_max"] >= 25

    # 3. blank_or_zero_active given safe initial facing and ceiling
    blank_fix = fixed_map[1005]
    assert blank_fix["new_min"] == 2
    assert blank_fix["new_max"] >= 6
    assert blank_fix["new_max"] > blank_fix["new_min"]

    # 4. pish_over_max bumped to cover proposal
    pish_fix = fixed_map[1002]
    assert pish_fix["new_max"] >= 28  # Cover pish_raw of 28.0

    # 5. Store filtering check
    fazl_fixed = generate_auto_fix_items(results, store_name="فضل")
    assert all(it["wh_name"] == "فضل" for it in fazl_fixed)
    assert 1004 not in {it["code"] for it in fazl_fixed}  # 1004 is at بوژان

    # Verify end-to-end compatibility with generate_tsv_clipboard
    tsv = generate_tsv_clipboard(fixed, store_code=3401)
    assert tsv.strip()
    for line in tsv.strip().split("\n"):
        parts = line.split("\t")
        assert len(parts) == 5
        s_code, c_code, mn, mx, rop = parts
        assert rop == "0"
        if int(c_code) == 9900910:
            assert mn == "0" and mx == "0"
        else:
            assert int(mx) > int(mn)


# ==============================================================================
# 2. Tests for diff_tracker.py
# ==============================================================================

def test_compare_reports():
    """Verify detection of min, max, status changes, and added/removed items."""
    prev_rows = [
        # Item 1: Min changed
        {"wh_name": "فضل", "code": 101, "name": "روغن ۱", "min": 10.0, "max": 40.0, "status": "فعال"},
        # Item 2: Max changed
        {"wh_name": "فضل", "code": 102, "name": "برنج ۲", "min": 20.0, "max": 50.0, "status": "فعال"},
        # Item 3: Status changed (active -> inactive)
        {"wh_name": "فضل", "code": 103, "name": "شیر ۳", "min": 5.0, "max": 15.0, "status": "فعال"},
        # Item 4: Unchanged
        {"wh_name": "فضل", "code": 104, "name": "ماست ۴", "min": 8.0, "max": 20.0, "status": "فعال"},
        # Item 5: Removed in current
        {"wh_name": "فضل", "code": 105, "name": "پنیر ۵", "min": 10.0, "max": 20.0, "status": "فعال"},
    ]

    curr_rows = [
        # Item 1: min changed 10 -> 25
        {"wh_name": "فضل", "code": 101, "name": "روغن ۱", "min": 25.0, "max": 40.0, "status": "فعال"},
        # Item 2: max changed 50 -> 80
        {"wh_name": "فضل", "code": 102, "name": "برنج ۲", "min": 20.0, "max": 80.0, "status": "فعال"},
        # Item 3: status changed فعال -> غیرفعال
        {"wh_name": "فضل", "code": 103, "name": "شیر ۳", "min": 5.0, "max": 15.0, "status": "غیرفعال"},
        # Item 4: Unchanged
        {"wh_name": "فضل", "code": 104, "name": "ماست ۴", "min": 8.0, "max": 20.0, "status": "فعال"},
        # Item 6: Newly added
        {"wh_name": "فضل", "code": 106, "name": "کره ۶", "min": 12.0, "max": 30.0, "status": "فعال"},
    ]

    diff = compare_reports(prev_rows, curr_rows)

    assert diff["counts"]["total_changes"] == 3
    assert diff["counts"]["min_changes"] == 1
    assert diff["counts"]["max_changes"] == 1
    assert diff["counts"]["status_changes"] == 1
    assert diff["counts"]["added"] == 1
    assert diff["counts"]["removed"] == 1

    changed_codes = [c["code"] for c in diff["changes"]]
    assert 101 in changed_codes
    assert 102 in changed_codes
    assert 103 in changed_codes
    assert 104 not in changed_codes  # Unchanged

    added_codes = [a["code"] for a in diff["added"]]
    assert 106 in added_codes

    removed_codes = [r["code"] for r in diff["removed"]]
    assert 105 in removed_codes


def test_generate_telegram_summary():
    """Verify formatted Persian Telegram briefing message generation."""
    changes = [
        {
            "code": 101,
            "name": "روغن آفتابگردان بهار",
            "prev_min": 10,
            "curr_min": 25,
            "prev_max": 40,
            "curr_max": 80,
            "prev_status": "فعال",
            "curr_status": "فعال",
            "status_changed": False,
        },
        {
            "code": 103,
            "name": "شیر کم چرب پگاه",
            "prev_min": 5,
            "curr_min": 5,
            "prev_max": 15,
            "curr_max": 15,
            "prev_status": "فعال",
            "curr_status": "غیرفعال",
            "status_changed": True,
        },
    ]

    msg = generate_telegram_summary("فضل", changes, target_date="1405.07.29")

    assert "فضل" in msg
    assert "1405.07.29" in msg
    assert "101" in msg
    assert "روغن آفتابگردان بهار" in msg
    assert "10 ⬅️ 25" in msg
    assert "40 ⬅️ 80" in msg
    assert "فعال ⬅️ غیرفعال" in msg
    assert "ShelfMaster" in msg

    # Empty changes check
    empty_msg = generate_telegram_summary("بوژان", [], target_date="1405.07.29")
    assert "هیچ تغییری" in empty_msg
    assert "بوژان" in empty_msg


# ==============================================================================
# 3. Tests for presets.py
# ==============================================================================

def test_preset_definitions_structure():
    """Verify all 5 standard presets are defined with required attributes."""
    expected_presets = [
        "روغن و برنج",
        "شوینده و بهداشتی",
        "ماکارونی و غلات",
        "قند و چای",
        "صفر کردن اقلام خاص",
    ]
    for p in expected_presets:
        assert p in PRESETS
        preset = PRESETS[p]
        assert "default_min" in preset
        assert "default_max" in preset
        assert "keywords" in preset


def test_apply_preset_keywords_and_limits():
    """Verify keyword filtering and limit adjustments for presets."""
    rows = [
        {"wh_name": "فضل", "code": 201, "name": "روغن مایع آفتابگردان 810 گرم لادن", "min": 5, "max": 10, "batch": 12},
        {"wh_name": "فضل", "code": 202, "name": "برنج طارم هاشمی 10 کیلوگرم گلستان", "min": 2, "max": 5, "batch": 1},
        {"wh_name": "بوژان", "code": 203, "name": "روغن سرخ کردنی شفاف بهار", "min": 10, "max": 20, "batch": 6},
        {"wh_name": "فضل", "code": 204, "name": "پفک نمکی مینو", "min": 10, "max": 30, "batch": 24},
    ]

    # 1. Apply to all stores
    res = apply_preset("روغن و برنج", rows)
    assert len(res) == 3
    for it in res:
        assert it["new_min"] == 35
        assert it["new_max"] == 100
        assert "روغن و برنج" in it["note"]

    # 2. Apply with store filtering
    res_fazl = apply_preset("روغن و برنج", rows, store_name="فضل")
    assert len(res_fazl) == 2
    assert all(it["wh_name"] == "فضل" for it in res_fazl)


def test_apply_preset_sop_zero_protection():
    """
    Verify SOP Section 5 overriding protection:
    Even when applying 'شوینده و بهداشتی' (min=25, max=80),
    a 10L detergent item MUST be zeroed out (min=0, max=0).
    """
    rows = [
        {"wh_name": "فضل", "code": 301, "name": "مایع ظرفشویی پریل 1 لیتری", "min": 5, "max": 15, "batch": 12},
        # 10L bulk detergent: SOP zero-mandated item
        {"wh_name": "فضل", "code": 9900910, "name": "مایع دستشویی 10 لیتری گلرنگ", "min": 10, "max": 20, "batch": 1},
    ]

    res = apply_preset("شوینده و بهداشتی", rows)
    assert len(res) == 2

    res_map = {it["code"]: it for it in res}

    # Standard detergent receives preset values
    assert res_map[301]["new_min"] == 25
    assert res_map[301]["new_max"] == 80

    # 10L bulk detergent is strictly zeroed by SOP rules
    assert res_map[9900910]["new_min"] == 0
    assert res_map[9900910]["new_max"] == 0
    assert "صفر" in res_map[9900910]["note"]


def test_apply_preset_zero_mandated_category():
    """Test applying 'صفر کردن اقلام خاص' preset."""
    rows = [
        {"wh_name": "فضل", "code": 401, "name": "سبد سفید 25 کیلویی پالود پلاست", "min": 10, "max": 20, "batch": 1},
        {"wh_name": "فضل", "code": 402, "name": "کالای عادی", "min": 10, "max": 20, "batch": 6},
    ]

    # When zero-mandated items exist in the inventory, only those are targeted
    res = apply_preset("صفر کردن اقلام خاص", rows)
    assert len(res) == 1
    assert res[0]["code"] == 401
    assert res[0]["new_min"] == 0
    assert res[0]["new_max"] == 0
