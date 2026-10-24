# -*- coding: utf-8 -*-
"""
ShelfMaster Tests - Streaming Reader Test Suite
Verifies fast Excel streaming parser, cell types, caching, and store alias filtering.
"""

import os
import sys
import glob
import time
import pytest
import openpyxl

# Ensure ShelfMaster root is on sys.path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from engine.reader import (
    parse_send_report,
    get_store_records,
    is_store_match,
    _to_int,
    _to_float,
    _to_str,
)


@pytest.fixture
def sample_excel_file(tmp_path):
    """Creates a sample Excel file mimicking ERP Proposal Report structure."""
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = "Sheet1"

    # Row 1: Header Row
    headers = [
        "کد کالا",
        "نام کالا",
        "وضعیت کالا در فروشگاه",
        "تعداد بچ مادر",
        "پیشنهاد ارسال گرد شده به بالا/پایین",
        "موجودی قابل ارسال",
        "نام فروشگاه",
        "موجودی انبار قفسه",
        "سقف فعلی قفسه",
        "کف فعلی قفسه",
        "پیشنهاد ارسال",
    ]
    ws.append(headers)

    # Row 2: Summary / Invalid row (must be skipped by reader)
    ws.append(["", "", "", -1000, -1000, -1000, "", -1000, -1000, -1000, -1000])

    # Row 3: Product 1 (Ferdowsi)
    ws.append([
        900001,
        "شیر کم چرب ۱ لیتری",
        "فعال",
        12,
        24,
        150,
        "فردوسی شمالی",
        5,
        30,
        10,
        25,
    ])

    # Row 4: Product 2 (Fazl)
    ws.append([
        900002,
        "پنیر تبریز ۴۰۰ گرم",
        "فعال",
        6,
        12,
        60,
        "فضل",
        2,
        16,
        4,
        14,
    ])

    # Row 5: Product 3 (Ferdowsi) - zero batch (should default to 1.0)
    ws.append([
        900003,
        "ماست دبه سون ۲ کیلو",
        "فعال",
        0,  # Batch 0 -> should default to 1.0
        4,
        20,
        "فردوسی شمالی",
        1,
        8,
        2,
        7,
    ])

    file_path = tmp_path / "sample_proposal.xlsx"
    wb.save(file_path)
    wb.close()
    return str(file_path)


def test_parse_send_report_dynamic_file(sample_excel_file):
    """Verify streaming parse extracts records, handles column mapping, and skips invalid rows."""
    data = parse_send_report(sample_excel_file)

    assert data["source_file"] == sample_excel_file
    assert data["goods_count"] == 3
    assert len(data["rows"]) == 3
    assert data["stores"] == ["فردوسی شمالی", "فضل"]

    # Check Product 1
    p1 = data["rows"][0]
    assert p1["code"] == 900001
    assert p1["name"] == "شیر کم چرب ۱ لیتری"
    assert p1["wh_name"] == "فردوسی شمالی"
    assert p1["status"] == "فعال"
    assert p1["batch"] == 12.0
    assert p1["shelf_qty"] == 5.0
    assert p1["free_qty"] == 150.0
    assert p1["min"] == 10.0
    assert p1["max"] == 30.0
    assert p1["pish_round"] == 24.0
    assert p1["pish_raw"] == 25.0

    # Check Product 3 batch default (0 -> 1.0)
    p3 = data["rows"][2]
    assert p3["code"] == 900003
    assert p3["batch"] == 1.0


def test_get_store_records_alias_filtering(sample_excel_file):
    """Verify store filtering works with alias tolerance (e.g. فردوسی vs فردوسی شمالی)."""
    data = parse_send_report(sample_excel_file)

    # Alias query: "فردوسی" should match "فردوسی شمالی"
    records_ferdowsi = get_store_records(data, "فردوسی")
    assert len(records_ferdowsi) == 2
    for r in records_ferdowsi:
        assert r["wh_name"] == "فردوسی شمالی"

    # Exact query: "فردوسی شمالی"
    records_ferdowsi_exact = get_store_records(data, "فردوسی شمالی")
    assert len(records_ferdowsi_exact) == 2

    # Query: "فضل"
    records_fazl = get_store_records(data, "فضل")
    assert len(records_fazl) == 1
    assert records_fazl[0]["code"] == 900002
    assert records_fazl[0]["wh_name"] == "فضل"

    # Query non-existent store in dataset: "بوژان"
    records_empty = get_store_records(data, "بوژان")
    assert len(records_empty) == 0

    # Query empty/None
    assert get_store_records(data, "") == []
    assert get_store_records(data, None) == []
    assert get_store_records({}, "فضل") == []


def test_cache_mechanism_and_speed(sample_excel_file, tmp_path):
    """Verify caching saves parsed data and reloads in < 0.1s."""
    cache_dir = tmp_path / "cache_store"

    t0 = time.time()
    data1 = parse_send_report(sample_excel_file, cache_dir=str(cache_dir))
    t_first = time.time() - t0

    # Cache file must exist
    cache_files = list(cache_dir.glob("*.cache.json"))
    assert len(cache_files) == 1

    # Second load must use cache and be instant (< 0.1s)
    t1 = time.time()
    data2 = parse_send_report(sample_excel_file, cache_dir=str(cache_dir))
    t_second = time.time() - t1

    assert t_second < 0.1, f"Cached load took {t_second:.4f}s, expected < 0.1s"
    assert data1["goods_count"] == data2["goods_count"]
    assert data1["stores"] == data2["stores"]
    assert data1["rows"] == data2["rows"]


def test_cache_invalidation_on_file_change(sample_excel_file, tmp_path):
    """Verify cache invalidates and updates when source file mtime changes."""
    cache_dir = tmp_path / "cache_store"
    parse_send_report(sample_excel_file, cache_dir=str(cache_dir))

    # Append a new row to sample_excel_file
    wb = openpyxl.load_workbook(sample_excel_file)
    ws = wb.active
    ws.append([
        900004,
        "دوغ نعنایی ۱.۵ لیتر",
        "فعال",
        6,
        12,
        40,
        "فضل",
        3,
        12,
        3,
        9,
    ])
    time.sleep(0.05)  # Ensure mtime advances
    wb.save(sample_excel_file)
    wb.close()

    # Re-parsing with cache_dir should detect mtime change and reflect 4 goods
    data = parse_send_report(sample_excel_file, cache_dir=str(cache_dir))
    assert data["goods_count"] == 4


def test_is_store_match_aliases():
    """Verify is_store_match with Persian glyphs and warehouse codes."""
    # Warehouse code alias: فردوسی & فردوسی شمالی both map to 3601
    assert is_store_match("فردوسی", "فردوسی شمالی")
    assert is_store_match("فردوسی شمالی", "فردوسی")

    # Arabic vs Persian Yeh/Kaf
    assert is_store_match("الینا", "الينا")
    assert is_store_match("الهیه", "الهيه")

    # Arabic numerals vs Persian numerals
    assert is_store_match("۱۷ شهریور", "17 شهریور")
    assert is_store_match("شاهد 17", "شاهد ۱۷")

    # Shahid Beheshti vs Beheshti
    assert is_store_match("شهید بهشتی", "بهشتی")
    assert is_store_match("بهشتی", "شهید بهشتی")

    # Different stores must NOT match
    assert not is_store_match("فضل", "بوژان")
    assert not is_store_match("مدرس", "پژواک")
    assert not is_store_match("", "فضل")


def test_type_conversion_helpers():
    """Verify safe int, float, and str conversion helpers."""
    assert _to_int(" 12345 ") == 12345
    assert _to_int("9902807.0") == 9902807
    assert _to_int("") == 0
    assert _to_int(None) == 0
    assert _to_int("invalid") == 0

    assert _to_float(" 12.5 ") == 12.5
    assert _to_float("", default=1.0) == 1.0
    assert _to_float(None, default=1.0) == 1.0
    assert _to_float("invalid", default=1.0) == 1.0

    assert _to_str("   تست متن   ") == "تست متن"
    assert _to_str(None) == ""


def test_missing_file_raises_error():
    """Verify missing file raises FileNotFoundError."""
    with pytest.raises(FileNotFoundError):
        parse_send_report("non_existent_file_path_12345.xlsx")


def test_integration_real_download_file(tmp_path):
    """
    Integration test using an actual 'گزارش کامل پیشنهاد ارسال*.xlsx' from Downloads (if present).
    Verifies stores is non-empty, goods_count > 0, and get_store_records returns records for a known store.
    """
    downloads_path = r"C:\Users\sedighi.m\Downloads"
    pattern = os.path.join(downloads_path, "*پیشنهاد ارسال*.xlsx")
    files = glob.glob(pattern)

    if not files:
        pytest.skip("No real send proposal file in Downloads directory.")

    # Select the most recent file
    files.sort(key=os.path.getmtime, reverse=True)
    real_file = files[0]

    cache_dir = tmp_path / "integration_cache"

    t0 = time.time()
    data = parse_send_report(real_file, cache_dir=str(cache_dir))
    parse_time = time.time() - t0

    assert len(data["stores"]) > 0, "Stores list must not be empty"
    assert data["goods_count"] > 0, "Goods count must be greater than 0"
    assert isinstance(data["rows"], list)

    # Test get_store_records for a known store like 'فردوسی' or 'فضل'
    test_store = "فردوسی" if "فردوسی شمالی" in data["stores"] or "فردوسی" in data["stores"] else data["stores"][0]
    records = get_store_records(data, test_store)

    assert len(records) > 0, f"get_store_records must return records for store '{test_store}'"
    for r in records[:5]:
        assert r["code"] > 0
        assert r["wh_name"] != ""

    # Test that second load via cache is instant (< 0.1s)
    t1 = time.time()
    cached_data = parse_send_report(real_file, cache_dir=str(cache_dir))
    cached_time = time.time() - t1

    assert cached_time < 0.1, f"Cached load took {cached_time:.4f}s, expected < 0.1s"
    assert cached_data["goods_count"] == data["goods_count"]
