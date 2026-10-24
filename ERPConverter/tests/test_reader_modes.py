# -*- coding: utf-8 -*-
"""
Tests for reader and modes engine modules.
"""

import os
import sys
import pandas as pd
import pytest

# Add parent directory to sys.path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.reader import normalize_persian_text, extract_date_from_name, detect_new_goods
from engine.modes import evaluate_single_item_margin, process_missing_items


def test_normalize_persian_text():
    assert normalize_persian_text("يك تست كالا") == "یک تست کالا"
    assert normalize_persian_text("  سلام   عليكم  ") == "سلام علیکم"


def test_extract_date_from_name():
    assert extract_date_from_name("پیشنهاد درصد تخفیف گروهی 1405.07.30 (1).xlsx") == "1405.07.30"
    assert extract_date_from_name("درصد تخفیف 1405/08/01.xlsx") == "1405.08.01"


def test_detect_new_goods():
    df_curr = pd.DataFrame({"کد کالا": ["101", "102", "103"], "نام کالا": ["A", "B", "C"]})
    df_prev = pd.DataFrame({"کد کالا": ["101", "102"], "نام کالا": ["A", "B"]})
    
    new_goods = detect_new_goods(df_curr, df_prev)
    assert len(new_goods) == 1
    assert new_goods.iloc[0]["کد کالا"] == "103"


def test_evaluate_single_item_margin():
    # Normal item
    res = evaluate_single_item_margin(
        p_calc=100000,
        p_cons=150000,
        disc_grp=10.0,
        setad_val=3,
        sood_val=7
    )
    assert res["status"] == "قابل کانورت"
    assert res["conv_disc"] is not None
    assert res["conv_disc"] > 0
    assert res["gap"] is not None

    # Missing consumer price
    res_no_cons = evaluate_single_item_margin(
        p_calc=100000,
        p_cons=None,
        disc_grp=0,
        setad_val=3,
        sood_val=7
    )
    assert res_no_cons["status"] == "فاقد قیمت مصرف‌کننده"

    # Deficit store (cost > consumer price after profit)
    res_deficit = evaluate_single_item_margin(
        p_calc=150000,
        p_cons=100000,
        disc_grp=0,
        setad_val=3,
        sood_val=7
    )
    assert res_deficit["status"] == "کسری فروشگاه"
    assert res_deficit["conv_disc"] < 0


def test_process_missing_items_defaults():
    # Test dataset with missing Setad and Sood
    data = {
        "کد کالا": ["1001", "1002", "1003"],
        "نام کالا": ["پنیر پیتزا مطهر", "پودر ژله هلو", "برنج هاشمی"],
        "نام برند": ["مطهر", "هاتی کارا", "پالود"],
        "گروه کالایی": ["لبنیات > پنیر پیتزا", "دسر > ژله", "خواروبار > برنج"],
        "قیمت لحاظ شده در محاسبات": [100000, 20000, 800000],
        "قیمت مصرف کننده بدون مالیات": [140000, 30000, 1000000],
        "درصد تخفیف گروهی فعلی": [5.0, 0.0, 0.0],
        "هزینه ستاد": [None, None, 3.0],
        "سود درنظر گرفته شده برای کالا(%)": [None, None, None]
    }
    df = pd.DataFrame(data)
    results = process_missing_items(df)
    
    assert len(results) == 3
    
    # 1001: پنیر پیتزا -> Setad=5, Sood=7
    r1 = next(r for r in results if r["code"] == "1001")
    assert r1["setad_determined"] == 5
    assert r1["sood_determined"] == 7
    assert r1["needs_setad_convert"] is True
    assert r1["needs_sood_convert"] is True
    
    # 1002: ژله -> Setad=3 (rule), Sood=7
    r2 = next(r for r in results if r["code"] == "1002")
    assert r2["setad_determined"] == 3
    assert r2["sood_determined"] == 7
    
    # 1003: برنج -> Setad=3 (already had 3), Sood=5 (rule for rice)
    r3 = next(r for r in results if r["code"] == "1003")
    assert r3["setad_determined"] == 3
    assert r3["needs_setad_convert"] is False
    assert r3["sood_determined"] == 5
    assert r3["needs_sood_convert"] is True
