# -*- coding: utf-8 -*-
"""
آزمون اصلاحات ۱۴۰۵/۰۸/۰۳ (پیش از ادغام در پنل مانیتورینگ):
کشف فایل در زیرپوشه‌ها، قواعد کلمه‌کامل، فقط مقادیر خالی در فایل ورود، کد عددی، وضعیت کسری.
"""

import os
import sys
import tempfile
import time

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.reader import find_latest_discount_file, find_previous_archive_file
from engine.modes import process_missing_items, rule_matches, STATUS_DEFICIT
from engine.convert_writer import build_convert_rows, erp_code


def _touch(path, t):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(b"x")
    os.utime(path, (t, t))


def test_discovery_subfolders_and_skips():
    with tempfile.TemporaryDirectory() as root:
        now = time.time()
        old = os.path.join(root, "پیشنهاد درصد تخفیف گروهی 1405.07.28.xlsx")
        new = os.path.join(root, "تخفیف گروهی", "پیشنهاد درصد تخفیف گروهی 1405.08.02 (08-37).xlsx")
        part = os.path.join(root, "تخفیف گروهی", "استخراج پیشنهاد درصد تخفیف گروهی 1405.08.02 (09-00).xlsx")
        dup = os.path.join(root, "_تکراری", "پیشنهاد درصد تخفیف گروهی 1405.08.03.xlsx")
        _touch(old, now - 900)
        _touch(new, now - 600)
        _touch(part, now - 300)
        _touch(dup, now)
        # بدون زیرپوشه همان رفتار قبلی
        assert find_latest_discount_file(root) == old
        # با زیرپوشه: «استخراج…» و «_تکراری» کنار می‌روند
        assert find_latest_discount_file([root], recursive=True) == new
        # گزارش قبلی برای کالاهای جدید: فایل «استخراج…» نه
        assert find_previous_archive_file(new, [root]) == old


def test_rule_whole_word_on_group():
    # «پاستیل قند کاهش یافته» نباید قانون قند (۲٪) بگیرد
    assert not rule_matches("قند", "پاستیل قند کاهش یافته حس بهار", "تنقلات > پاستیل و مارشمالو > پاستیل")
    assert rule_matches("قند", "قند حبه ۵۰۰ گرمی", "خواروبار > قند و شکر")
    # تکه‌ای از کلمه دیگر نه
    assert not rule_matches("برنج", "شیر برنج", "لبنیات > برنجک")
    # عبارت چندکلمه‌ای در نام هم
    assert rule_matches("پنیر خامه ای", "پنير خامه اي 70 گرمي خرم", "لبنيات > پنير")


def test_missing_items_rule_and_deficit():
    df = pd.DataFrame({
        "کد کالا": ["1", "2"],
        "نام کالا": ["پاستیل قند کاهش یافته", "کالای گران"],
        "گروه کالایی": ["تنقلات > پاستیل", "سایر > سایر"],
        "قیمت لحاظ شده در محاسبات": [10000, 150000],
        "قیمت مصرف کننده بدون مالیات": [20000, 100000],
        "درصد تخفیف گروهی فعلی": [0.0, 0.0],
        "هزینه ستاد": [None, None],
        "سود درنظر گرفته شده برای کالا(%)": [None, None],
    })
    res = {r["code"]: r for r in process_missing_items(df)}
    assert res["1"]["determined_setad"] == 3
    assert res["2"]["status"] == STATUS_DEFICIT


def test_convert_rows_only_missing_fields():
    items = [
        {"code": "100", "determined_setad": 3, "determined_sood": 7, "needs_setad_convert": False, "needs_sood_convert": True},
        {"code": "200", "determined_setad": 4, "determined_sood": 5, "needs_setad_convert": True, "needs_sood_convert": True},
        {"code": "300", "determined_setad": 12, "determined_sood": None, "needs_setad_convert": True, "needs_sood_convert": True},
    ]
    setad, sood, skipped = build_convert_rows(items)
    assert setad == [(946, 9464, "200")]
    assert sood == [(940, 9007, "100"), (940, 9005, "200")]
    assert skipped == [{"code": "300", "field": "setad", "value": 12}]


def test_erp_code_number():
    assert erp_code("9907052") == 9907052
    assert erp_code(" 900122 ") == 900122
    assert erp_code("A-1") == "A-1"
