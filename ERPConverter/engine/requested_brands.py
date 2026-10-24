# -*- coding: utf-8 -*-
"""
ERPConverter - 9 Key Requested Brands & Commodity Groups Extractor
Extracts and categorizes strategic brands requested daily by management.
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple
import pandas as pd
import numpy as np

try:
    from .reader import normalize_persian_text
except ImportError:
    from reader import normalize_persian_text


REQUESTED_CATEGORIES = [
    ("گل بانو", "Gol Banoo"),
    ("برنج و روغن های پالود", "Palood Rice & Oil"),
    ("روغن های ورامین", "Varamin Oils"),
    ("کالاهای هوم پلاس", "Home Plus Products"),
    ("محصولات نانسی", "Nancy Products"),
    ("رطب های مضافتی", "Mozafati Dates"),
    ("کنسرو لوبیا سپیده", "Sepideh Canned Beans"),
    ("رب گوجه سپیده", "Sepideh Tomato Paste"),
    ("تن ماهی حمایت", "Hemayat Canned Tuna")
]


def extract_requested_brands(df: pd.DataFrame) -> Dict[str, Any]:
    """
    Extracts, orders, and summarizes the 9 strategic brand categories from the discount proposal dataframe.
    """
    df_c = df.copy()
    df_c["norm_name"] = df_c["نام کالا"].apply(normalize_persian_text)
    df_c["norm_brand"] = df_c["نام برند"].apply(normalize_persian_text) if "نام برند" in df_c.columns else ""
    df_c["norm_grp"] = df_c["گروه کالایی"].apply(normalize_persian_text) if "گروه کالایی" in df_c.columns else ""

    conds = [
        ("گل بانو", df_c["norm_brand"].str.contains("گل بانو") | df_c["norm_name"].str.contains("گل بانو")),
        ("برنج و روغن های پالود", (df_c["norm_brand"].str.contains("پالود") | df_c["norm_name"].str.contains("پالود")) & (df_c["norm_name"].str.contains("برنج|روغن") | df_c["norm_grp"].str.contains("برنج|روغن"))),
        ("روغن های ورامین", (df_c["norm_brand"].str.contains("ورامین") | df_c["norm_name"].str.contains("ورامین")) & (df_c["norm_name"].str.contains("روغن") | df_c["norm_grp"].str.contains("روغن"))),
        ("کالاهای هوم پلاس", df_c["norm_brand"].str.contains("هوم پلاس|هومپلاس") | df_c["norm_name"].str.contains("هوم پلاس|هومپلاس")),
        ("محصولات نانسی", df_c["norm_brand"].str.contains("نانسی") | df_c["norm_name"].str.contains("نانسی")),
        ("رطب های مضافتی", df_c["norm_name"].str.contains("رطب|خرما") & df_c["norm_name"].str.contains("مضافتی|مظافتی")),
        ("کنسرو لوبیا سپیده", df_c["norm_name"].str.contains("لوبیا") & (df_c["norm_brand"].str.contains("سپیده") | df_c["norm_name"].str.contains("سپیده"))),
        ("رب گوجه سپیده", (df_c["norm_name"].str.contains("رب گوجه") | (df_c["norm_grp"].str.contains("رب گوجه") & ~df_c["norm_name"].str.contains("مربا|پرچرب|کم چرب"))) & (df_c["norm_brand"].str.contains("سپیده") | df_c["norm_name"].str.contains("سپیده"))),
        ("تن ماهی حمایت", df_c["norm_name"].str.contains("تن|ماهی") & (df_c["norm_brand"].str.contains("حمایت") | df_c["norm_name"].str.contains("حمایت")))
    ]

    category_map = {}
    category_dfs = {}

    for cat_name, mask in conds:
        sub = df[mask].copy()
        sub["دسته درخواستی"] = cat_name
        category_dfs[cat_name] = sub
        for _, r in sub.iterrows():
            c_code = str(r["کد کالا"]).strip()
            if c_code not in category_map:
                category_map[c_code] = cat_name

    # Master list 1: Preserving exact row order in source file
    matched_by_file_order = []
    for idx, r in df.iterrows():
        c_code = str(r["کد کالا"]).strip()
        if c_code in category_map:
            row_dict = r.to_dict()
            row_dict["ردیف در فایل اصلی"] = idx + 2
            row_dict["دسته درخواستی"] = category_map[c_code]
            matched_by_file_order.append(row_dict)

    df_by_file_order = pd.DataFrame(matched_by_file_order)

    # Summary table per category
    summary = []
    for idx, (cat_name, sub_df) in enumerate(category_dfs.items(), 1):
        sample_items = "، ".join(sub_df["نام کالا"].astype(str).iloc[:2].tolist()) if len(sub_df) > 0 else "-"
        
        discs = sub_df["درصد تخفیف گروهی فعلی"].dropna().tolist() if "درصد تخفیف گروهی فعلی" in sub_df.columns else []
        disc_ints = [int(round(float(d))) for d in discs if float(d) > 0]
        disc_str = f"{min(disc_ints)}٪ تا {max(disc_ints)}٪" if disc_ints else ("۰٪" if discs else "بدون تخفیف")

        sood_vals = sub_df["سود درنظر گرفته شده برای کالا(%)"].dropna().unique().tolist() if "سود درنظر گرفته شده برای کالا(%)" in sub_df.columns else []
        sood_ints = [int(round(float(s))) for s in sood_vals]
        sood_str = "، ".join([f"{s}٪" for s in sorted(set(sood_ints))]) if sood_ints else "-"

        cost_vals = sub_df["هزینه ستاد"].dropna().unique().tolist() if "هزینه ستاد" in sub_df.columns else []
        cost_ints = [int(round(float(c))) for c in cost_vals]
        cost_str = "، ".join([f"{c}٪" for c in sorted(set(cost_ints))]) if cost_ints else "-"

        summary.append({
            "index": idx,
            "category": cat_name,
            "count": len(sub_df),
            "sample_items": sample_items,
            "discount_range": disc_str,
            "sood_range": sood_str,
            "setad_range": cost_str
        })

    return {
        "total_count": len(df_by_file_order),
        "df_file_order": df_by_file_order,
        "category_dfs": category_dfs,
        "summary": summary
    }
