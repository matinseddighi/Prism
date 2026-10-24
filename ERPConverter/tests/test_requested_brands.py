# -*- coding: utf-8 -*-
"""
Tests for requested brands extractor.
"""

import os
import sys
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.requested_brands import extract_requested_brands


def test_extract_requested_brands():
    data = {
        "کد کالا": ["1", "2", "3", "4", "5", "6"],
        "نام کالا": [
            "روغن نباتی ۵ کیلویی گل بانو",
            "برنج طارم هاشمی پالود",
            "مایع ظرفشویی ۱۰۰۰ گرم هوم پلاس",
            "نوار بهداشتی بالدار نانسی",
            "رطب مضافتی بم",
            "کنسرو لوبیا چیتی سپیده"
        ],
        "نام برند": ["گل بانو", "پالود", "هوم پلاس", "نانسی", "متفرقه", "سپیده"],
        "گروه کالایی": ["روغن", "برنج", "شوینده", "سلولزی", "خرما", "کنسرو"],
        "درصد تخفیف گروهی فعلی": [19.0, 0.0, 21.0, 23.0, 0.0, 0.0],
        "سود درنظر گرفته شده برای کالا(%)": [7.0, 5.0, 7.0, 7.0, 7.0, 7.0],
        "هزینه ستاد": [3.0, 3.0, 3.0, 3.0, 3.0, 3.0]
    }
    df = pd.DataFrame(data)
    res = extract_requested_brands(df)
    
    assert res["total_count"] == 6
    assert len(res["summary"]) == 9
    
    # Check that file order was preserved
    assert res["df_file_order"]["کد کالا"].tolist() == ["1", "2", "3", "4", "5", "6"]
    
    # Check category mappings
    cats = res["df_file_order"]["دسته درخواستی"].tolist()
    assert cats[0] == "گل بانو"
    assert cats[1] == "برنج و روغن های پالود"
    assert cats[2] == "کالاهای هوم پلاس"
    assert cats[3] == "محصولات نانسی"
    assert cats[4] == "رطب های مضافتی"
    assert cats[5] == "کنسرو لوبیا سپیده"
