# -*- coding: utf-8 -*-
"""
Tests for sood_setad.py module
"""

import os
import sys
import tempfile
import pandas as pd
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.sood_setad import process_sood_setad_file


def test_process_sood_setad_mock():
    # Create temporary excel file
    data = {
        "کد کالا": [1001, 1002, 1003, 1004],
        "نام کالا": ["کالای یک", "کالای دو", "کالای سه", "کالای چهار"],
        "نام برند": ["برند آ", "برند آ", "برند ب", "برند ب"],
        "گروه کالایی": ["لبنیات", "لبنیات", "کنسرو", "کنسرو"],
        "سود ستاد درنظر گرفته شده برای کالا(%)": [4.0, 4.0, None, 2.0]
    }
    df = pd.DataFrame(data)
    with tempfile.NamedTemporaryFile(suffix=".xlsx", delete=False) as tmp:
        tmp_path = tmp.name

    try:
        df.to_excel(tmp_path, index=False)
        result = process_sood_setad_file(tmp_path)
        assert result["valid"] is True
        assert result["total_goods"] == 4
        assert result["missing_count"] == 1
        item = result["items"][0]
        assert item["code"] == "1003"
        # Since group 'کنسرو' has valid item 1004 with 2.0, mode is 2
        assert item["determined_sood_setad"] == 2
        assert item["main_cat"] == 800
        assert item["sub_cat"] == 8002
    finally:
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
