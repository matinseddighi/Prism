# -*- coding: utf-8 -*-
"""
واحد آزمون قوانین عملیاتی استاندارد (SOP Engine)
اعتبارسنجی نگاشت کد انبارها، اقلام صفر قطعی و پایستگی Max > Min
"""

import pytest
from engine.rules import (
    STORE_WAREHOUSE_MAP,
    PERMANENT_ZERO_CODES,
    is_zero_mandated,
    validate_and_adjust_limits,
    get_store_warehouse_code,
    normalize_persian_text,
)


def test_store_mapping_exact_and_aliases():
    """Verify STORE_WAREHOUSE_MAP contains all required 4-digit warehouse codes."""
    required_stores = {
        "فردوسی شمالی": 3601,
        "فضل": 3401,
        "بوژان": 4101,
        "17 شهریور": 4301,
        # کدهای تأییدشده توسط کاربر (۱۴۰۵/۰۸/۰۱) و فایل‌های کانورت از ۱۴۰۵/۰۷/۱۴ به بعد
        "بهشتی": 3301,
        "مدرس": 3501,
        "پژواک": 3001,
        "رحمت آباد": 3901,
        "جمهوری": 4001,
        "چناران": 3801,
        "زبرخان": 2701,
        "شاهد 17": 4401,
        "الينا": 2901,
        "مطهری": 3101,
    }

    for store_name, expected_code in required_stores.items():
        assert store_name in STORE_WAREHOUSE_MAP, f"Store '{store_name}' missing from STORE_WAREHOUSE_MAP"
        assert STORE_WAREHOUSE_MAP[store_name] == expected_code, (
            f"Store '{store_name}' expected code {expected_code}, got {STORE_WAREHOUSE_MAP[store_name]}"
        )

    # Common aliases check
    assert STORE_WAREHOUSE_MAP.get("فردوسی") == 3601
    assert STORE_WAREHOUSE_MAP.get("رحمت‌آباد") == 3901
    assert STORE_WAREHOUSE_MAP.get("۱۷ شهریور") == 4301


def test_get_store_warehouse_code_helper():
    """Verify get_store_warehouse_code resolves aliases, Persian/Arabic chars, and spaces."""
    assert get_store_warehouse_code("رحمت آباد") == 3901
    assert get_store_warehouse_code("رحمت‌آباد") == 3901
    assert get_store_warehouse_code("فردوسی") == 3601
    assert get_store_warehouse_code("فردوسي شمالي") == 3601
    assert get_store_warehouse_code("بهشتي") == 3301
    assert get_store_warehouse_code("ناشناخته") == 0
    assert get_store_warehouse_code("") == 0
    assert get_store_warehouse_code(None) == 0


def test_permanent_zero_codes_set():
    """Verify known permanent zero codes from GEMINI.md Section 5 are present."""
    must_include = [
        9902807, 9902808, 9902809, 9902810, 9902901, 9903691, 9904320,  # Milk powder bulk
        9902811, 9902816, 9902927,                                     # MPC & Whey
        9900910, 9905498,                                             # 10L cleaning chemicals
        9902937, 9903731,                                             # Store baskets
        9904201,                                                      # Discontinued basket
        9906761,                                                      # Bulk meat/fish
    ]
    for code in must_include:
        assert code in PERMANENT_ZERO_CODES, f"Code {code} missing from PERMANENT_ZERO_CODES"


def test_is_zero_mandated_by_code():
    """Verify is_zero_mandated returns True for all permanent zero codes."""
    assert is_zero_mandated(9900910) is True
    assert is_zero_mandated("9900910") is True
    assert is_zero_mandated(9905498, "مایع سفید کننده 10 لیتری") is True
    assert is_zero_mandated(9902937, "سبد سفید 25 کیلویی پالود پلاست") is True
    assert is_zero_mandated(9900001, "ماکارونی 700 گرمی") is False


def test_is_zero_mandated_by_name_patterns():
    """Verify keywords in SOP Section 5 match even if code is generic or not in set."""
    # 10L cleaning chemicals
    assert is_zero_mandated(1111111, "مایع دستشویی 10 لیتری گلرنگ") is True
    assert is_zero_mandated(1111111, "مایع ظرفشویی ۱۰ لیتری پریل") is True
    assert is_zero_mandated(1111111, "مایع سفیدکننده 10 کیلویی آترا") is True
    assert is_zero_mandated(1111111, "مایع جرم گیر ۱۰ لیتری") is True

    # Bulk powders and raw materials
    assert is_zero_mandated(2222222, "شیر خشک صنعتی کیسه 25 کیلو پالود") is True
    assert is_zero_mandated(2222222, "شیر خشک پاکت 25 کیلو") is True

    # Baskets
    assert is_zero_mandated(3333333, "سبد پلاست آبی 25 کیلویی") is True

    # Normal retail items must NOT match
    assert is_zero_mandated(4444444, "مایع دستشویی 500 گرمی") is False
    assert is_zero_mandated(5555555, "شیر خشک قوطی 400 گرمی نان") is False


def test_validate_and_adjust_limits_zero_zero():
    """Verify 0, 0 limits remain 0, 0 without alteration."""
    min_i, max_i, note = validate_and_adjust_limits(min_val=0, max_val=0, carton=24)
    assert min_i == 0
    assert max_i == 0
    assert "کف و سقف صفر" in note


def test_validate_and_adjust_limits_normal():
    """Verify valid limits with max > min are preserved."""
    min_i, max_i, note = validate_and_adjust_limits(min_val=10, max_val=30, carton=24)
    assert min_i == 10
    assert max_i == 30
    assert "حفظ مقادیر" in note


def test_validate_and_adjust_limits_bump_when_max_le_min():
    """Verify Max > Min is strictly enforced: max must be bumped when max <= min."""
    # Scenario A: carton > min -> max bumped to carton
    min_i, max_i, note = validate_and_adjust_limits(min_val=10, max_val=8, carton=24)
    assert min_i == 10
    assert max_i == 24
    assert max_i > min_i
    assert "ارتقای خودکار سقف" in note

    # Scenario B: carton <= min -> max bumped to min * 1.5
    min_i, max_i, note = validate_and_adjust_limits(min_val=30, max_val=30, carton=12)
    assert min_i == 30
    assert max_i == 45
    assert max_i > min_i
    assert "ارتقای خودکار سقف" in note

    # Scenario C: equal values
    min_i, max_i, note = validate_and_adjust_limits(min_val=6, max_val=6, carton=6)
    assert min_i == 6
    assert max_i == 9
    assert max_i > min_i


def test_validate_and_adjust_limits_slow_moving():
    """Verify slow moving items are capped at 1 carton (when carton <= 12 and max > carton)."""
    min_i, max_i, note = validate_and_adjust_limits(min_val=2, max_val=24, carton=6, is_slow_moving=True)
    assert min_i == 2
    assert max_i == 6
    assert "مهار سقف کندگرد" in note


def test_validate_and_adjust_limits_edge_cases():
    """Verify robust handling of floats, string numbers, None, and negative values."""
    # Floats rounding
    min_i, max_i, _ = validate_and_adjust_limits(min_val=4.6, max_val=10.2, carton=12)
    assert min_i == 5
    assert max_i == 10

    # String numbers
    min_i, max_i, _ = validate_and_adjust_limits(min_val="10", max_val="5", carton="20")
    assert min_i == 10
    assert max_i == 20

    # None and negative values
    min_i, max_i, note = validate_and_adjust_limits(min_val=None, max_val=-5, carton=0)
    assert min_i == 0
    assert max_i == 0
    assert "کف و سقف صفر" in note
