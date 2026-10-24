# -*- coding: utf-8 -*-
"""
ERPConverter - HQ Profit (سود ستاد - دسته ۸۰۰) Engine
Extracts missing HQ profits from agent pricing files and determines category 800 ERP convert rows.
"""

from __future__ import annotations

import os
from typing import Any, Dict, List, Optional, Tuple
import pandas as pd
import numpy as np

try:
    from .reader import normalize_persian_text
except ImportError:
    from reader import normalize_persian_text


def process_sood_setad_file(filepath: str) -> Dict[str, Any]:
    """
    Parses an agent/pricing file to identify distinct missing goods for HQ profit (دسته ۸۰۰)
    and computes statistical group modes for proposed values.
    """
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"File not found: {filepath}")

    df = pd.read_excel(filepath)
    
    # Identify target column
    col_sood = None
    for cand in [
        "سود ستاد درنظر گرفته شده برای کالا(%)",
        "سود ستاد",
        "سود ستاد درنظر گرفته شده"
    ]:
        if cand in df.columns:
            col_sood = cand
            break

    col_code = "کد کالا"
    col_grp = "گروه کالایی"
    
    if col_code not in df.columns or col_sood is None:
        return {
            "valid": False,
            "error": "ستون‌های الزامی (کد کالا یا سود ستاد) در این فایل یافت نشدند."
        }

    # Ensure numeric
    df[col_sood] = pd.to_numeric(df[col_sood], errors="coerce")
    df[col_code] = df[col_code].astype(str).str.strip().str.replace(r"\.0$", "", regex=True)

    # Aggregate by distinct product
    goods_df = df.groupby(col_code).first().reset_index()
    total_goods = len(goods_df)

    # Compute group modes across valid items
    sub_modes = {}
    if col_grp in goods_df.columns:
        valid_goods = goods_df[goods_df[col_sood].notna()]
        for g, sub in valid_goods.groupby(col_grp):
            s = sub[col_sood]
            if len(s) > 0:
                m_series = s.mode()
                if not m_series.empty:
                    m = int(round(float(m_series.iloc[0])))
                    cov = round((s == m).mean() * 100)
                    sub_modes[str(g)] = (m, cov, len(s))

    # Missing goods
    missing_goods = goods_df[goods_df[col_sood].isna()].copy()
    items = []
    convert_rows = []

    for idx, r in missing_goods.iterrows():
        c_code = str(r[col_code]).strip()
        c_name = str(r.get("نام کالا", "")).strip()
        c_brand = str(r.get("نام برند", "")).strip() if pd.notna(r.get("نام برند")) else ""
        c_grp = str(r.get(col_grp, "")).strip() if pd.notna(r.get(col_grp)) else ""

        # Determine mode
        if c_grp in sub_modes:
            det_val, cov, cnt = sub_modes[c_grp]
            basis = f"اکثریت زیرگروه ({cnt} کالا، {cov}٪ هم‌مقدار)"
        else:
            det_val = 3
            basis = "الگوی عمومی دسته (۳٪)"

        st_main = 800
        st_sub = 8000 + det_val
        if 0 < det_val <= 9:  # کد فرعی ۸۰۰X فقط یک رقم دارد
            convert_rows.append((st_main, st_sub, c_code))

        items.append({
            "code": c_code,
            "name": c_name,
            "brand": c_brand,
            "category": c_grp,
            "determined_sood_setad": det_val,
            "basis": basis,
            "main_cat": st_main,
            "sub_cat": st_sub
        })

    return {
        "valid": True,
        "filepath": filepath,
        "filename": os.path.basename(filepath),
        "total_goods": total_goods,
        "missing_count": len(missing_goods),
        "items": items,
        "convert_rows": convert_rows
    }
