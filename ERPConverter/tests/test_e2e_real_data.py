# -*- coding: utf-8 -*-
r"""
End-to-End integration test on real report file:
C:\Users\sedighi.m\Downloads\پیشنهاد درصد تخفیف گروهی 1405.07.30 (1).xlsx
"""

import os
import sys
import tempfile
import openpyxl
import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from engine.reader import read_discount_file, extract_date_from_name
from engine.modes import process_missing_items
from engine.requested_brands import extract_requested_brands
from engine.convert_writer import export_all_converts, ERP_SHEET_NAME

REAL_FILE = r"C:\Users\sedighi.m\Downloads\پیشنهاد درصد تخفیف گروهی 1405.07.28.xlsx"


@pytest.mark.skipif(not os.path.exists(REAL_FILE), reason="Real file not found on host")
def test_e2e_real_pipeline():
    # 1. Read
    parsed = read_discount_file(REAL_FILE)
    assert parsed["total_rows"] > 4000
    assert parsed["date_str"] == "1405.07.28"
    df = parsed["df"]

    # 2. Missing items & modes
    missing = process_missing_items(df)
    assert len(missing) > 0

    # 3. Requested brands
    req = extract_requested_brands(df)
    assert req["total_count"] > 50

    # 4. Generate all convert files in temp directory
    with tempfile.TemporaryDirectory() as tmp_export:
        res = export_all_converts(
            date_str="1405.07.28",
            source_filename=os.path.basename(REAL_FILE),
            missing_items=missing,
            requested_data=req,
            new_goods=[],
            total_goods_count=parsed["total_rows"],
            sood_setad_data=None,
            export_dir=tmp_export,
            downloads_dir=None
        )

        assert res["success"] is True
        assert res["setad_count"] > 0
        assert res["sood_count"] > 0

        # Verify هزینه ستاد.xlsx
        f_setad = os.path.join(tmp_export, "هزینه ستاد.xlsx")
        assert os.path.exists(f_setad)
        wb_s = openpyxl.load_workbook(f_setad)
        assert wb_s.sheetnames == [ERP_SHEET_NAME]
        assert len(list(wb_s.active.iter_rows())) == res["setad_count"] + 1

        # Verify سود فروشگاه کانورت.xlsx
        f_sood = os.path.join(tmp_export, "سود فروشگاه کانورت.xlsx")
        assert os.path.exists(f_sood)
        wb_f = openpyxl.load_workbook(f_sood)
        assert wb_f.sheetnames == [ERP_SHEET_NAME]
        assert len(list(wb_f.active.iter_rows())) == res["sood_count"] + 1

        # Verify combined workbook
        f_comb = os.path.join(tmp_export, "کانورت هزینه ستاد و سود فروشگاه 1405.07.28.xlsx")
        assert os.path.exists(f_comb)
        wb_c = openpyxl.load_workbook(f_comb)
        assert "هزینه ستاد (946)" in wb_c.sheetnames
        assert "سود فروشگاه (940)" in wb_c.sheetnames

        # Verify determining analytical workbook
        f_det = os.path.join(tmp_export, "تعیین سود و هزینه کالاهای فاقد مقدار 1405.07.28.xlsx")
        assert os.path.exists(f_det)
        wb_d = openpyxl.load_workbook(f_det)
        assert "خلاصه" in wb_d.sheetnames
        assert "تعیین سود و هزینه فروشگاه" in wb_d.sheetnames

        # Verify requested brands workbook
        f_req = os.path.join(tmp_export, "استخراج اقلام درخواستی پیشنهاد درصد تخفیف 1405.07.28.xlsx")
        assert os.path.exists(f_req)
        wb_r = openpyxl.load_workbook(f_req)
        assert "کل اقلام (سورت فایل جدید)" in wb_r.sheetnames
        assert "خلاصه و آمار دسته‌ها" in wb_r.sheetnames
