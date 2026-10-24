# -*- coding: utf-8 -*-
"""
ERPConverter - Statistical Mode & Margin Calculation Engine
Calculates commodity group modes, assigns intelligent Setad/Sood defaults,
and evaluates financial pricing formulas for ERP conversion.
"""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional, Tuple
import pandas as pd
import numpy as np

try:
    from .reader import normalize_persian_text
except ImportError:
    from reader import normalize_persian_text


DEFAULT_OVERRIDE_RULES = {
    "setad": {
        "پنیر پیتزا": 5,
        "موزارلا": 5,
        "پنیر خامه ای": 4,
        "دسر و ژله": 3,
        "ژله": 3,
        "خمیر مایه": 3,
        "قند": 2,
        "شکر": 2,
    },
    "sood": {
        "برنج ایرانی": 5,
        "برنج": 5,
        "جامد و نیمه جامد": 5,
        "روغن": 5,
    }
}


SETAD_COL_CANDIDATES = [
    "هزینه ستاد",
    "هزینه ستاد درنظر گرفته شده",
    "هزینه ستاد در نظر گرفته شده",
    "درصد هزینه ستاد"
]

SOOD_COL_CANDIDATES = [
    "سود درنظر گرفته شده برای کالا(%)",
    "سود در نظر گرفته شده برای کالا(%)",
    "سود فروشگاه",
    "سود"
]

PRICE_CALC_CANDIDATES = [
    "قیمت لحاظ شده در محاسبات",
    "فی تامین",
    "اعلامیه قیمت خرید بدون مالیات",
    "آخرین قیمت تأمین بدون مالیات"
]

PRICE_CONS_CANDIDATES = [
    "قیمت مصرف کننده بدون مالیات",
    "قیمت مصرف‌کننده بدون مالیات",
    "قیمت مصرف کننده با مالیات",
    "قیمت مصرف‌کننده با مالیات"
]

GROUP_COL_CANDIDATES = [
    "گروه کالایی",
    "زیر گروه",
    "دسته بندی"
]


STATUS_DEFICIT = "کسری فروشگاه"


def rule_matches(keyword: str, norm_name: str, norm_grp: str) -> bool:
    """قاعده اختصاصی فقط وقتی می‌خورد که کلمه کامل باشد (نه تکه‌ای از کلمه دیگر).
    کلیدواژه تک‌کلمه‌ای (قند، برنج، روغن…) فقط با مسیر گروه کالایی سنجیده می‌شود؛
    مثلاً «پاستیل قند کاهش یافته» نباید هزینه ستاد قند و شکر بگیرد.
    عبارت چندکلمه‌ای (پنیر پیتزا، پنیر خامه ای…) در نام کالا هم جست‌وجو می‌شود."""
    kw = normalize_persian_text(keyword)
    if not kw:
        return False
    norm_name, norm_grp = normalize_persian_text(norm_name), normalize_persian_text(norm_grp)
    pat = r"(?<![\w‌])" + re.escape(kw) + r"(?![\w‌])"
    if re.search(pat, norm_grp):
        return True
    return " " in kw and re.search(pat, norm_name) is not None


def find_column(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    """Finds the first existing column in DataFrame among candidates."""
    for cand in candidates:
        if cand in df.columns:
            return cand
    return None


def calculate_modes(df: pd.DataFrame) -> Tuple[Dict[str, Tuple[int, int, int]], Dict[str, Tuple[int, int, int]]]:
    """
    Computes mode, coverage percentage, and item count for Setad and Store Sood per group.
    Returns: (sub_setad, sub_sood)
    """
    sub_setad = {}
    sub_sood = {}
    
    col_setad = find_column(df, SETAD_COL_CANDIDATES)
    col_sood = find_column(df, SOOD_COL_CANDIDATES)
    col_grp = find_column(df, GROUP_COL_CANDIDATES) or "گروه کالایی"
    
    if col_setad and col_grp in df.columns:
        valid_s = df[df[col_setad].notna()]
        for g, sub in valid_s.groupby(col_grp):
            s = sub[col_setad]
            if len(s) > 0:
                m_series = s.mode()
                if not m_series.empty:
                    m = int(round(float(m_series.iloc[0])))
                    cov = round((s == m).mean() * 100)
                    sub_setad[str(g)] = (m, cov, len(s))

    if col_sood and col_grp in df.columns:
        valid_sood = df[df[col_sood].notna()]
        for g, sub in valid_sood.groupby(col_grp):
            s = sub[col_sood]
            if len(s) > 0:
                m_series = s.mode()
                if not m_series.empty:
                    m = int(round(float(m_series.iloc[0])))
                    cov = round((s == m).mean() * 100)
                    sub_sood[str(g)] = (m, cov, len(s))

    return sub_setad, sub_sood


def evaluate_single_item_margin(
    p_calc: Optional[float],
    p_cons: Optional[float],
    disc_grp: Optional[float],
    setad_val: int,
    sood_val: int
) -> Dict[str, Any]:
    """
    Computes store net selling price, gap, margin, and convert discount for a single product.
    """
    if p_calc is None or pd.isna(p_calc):
        p_calc = 0.0
    if p_cons is None or pd.isna(p_cons):
        p_cons = None
    if disc_grp is None or pd.isna(disc_grp):
        disc_grp = 0.0

    p_calc_val = int(round(p_calc)) if p_calc > 0 else 0
    p_cons_val = int(round(p_cons)) if (p_cons is not None and p_cons > 0) else None

    # Calculate Convert Discount %
    # Formula: ROUND((1 - (P_calc*(1+Setad/100)) / (P_cons*(1-Sood/100))) * 100, 0) / 100
    if p_cons_val and p_cons_val > 0 and (1.0 - sood_val / 100.0) > 0:
        denom = p_cons_val * (1.0 - sood_val / 100.0)
        numer = p_calc_val * (1.0 + setad_val / 100.0)
        conv_disc = round((1.0 - numer / denom) * 100.0) / 100.0
    else:
        conv_disc = None

    # Determine status
    if p_cons_val is None or p_cons_val == 0:
        status = "فاقد قیمت مصرف‌کننده"
    elif conv_disc is not None and conv_disc < 0:
        status = STATUS_DEFICIT
    elif conv_disc is not None and conv_disc > 0.50:
        status = "نیاز به بررسی تخفیف بالا"
    else:
        status = "قابل کانورت"

    # Price after profit deduction
    # Formula: P_cons * (1 - Sood/100) * (1 - Disc_grp/100)
    if p_cons_val and p_cons_val > 0:
        store_net_price = int(round(p_cons_val * (1.0 - sood_val / 100.0) * (1.0 - disc_grp / 100.0)))
        cost_with_setad = int(round(p_calc_val * (1.0 + setad_val / 100.0)))
        gap = store_net_price - cost_with_setad
        gross_margin = round((1.0 - (p_calc_val / p_cons_val)) * 1000.0) / 10.0  # percentage
    else:
        store_net_price = None
        gap = None
        gross_margin = None

    return {
        "p_calc_val": p_calc_val,
        "p_cons_val": p_cons_val,
        "disc_grp": disc_grp,
        "setad_val": setad_val,
        "sood_val": sood_val,
        "conv_disc": conv_disc,
        "status": status,
        "store_net_price": store_net_price,
        "gap": gap,
        "gross_margin": gross_margin
    }


def process_missing_items(
    df: pd.DataFrame,
    override_rules: Optional[Dict[str, Dict[str, int]]] = None
) -> List[Dict[str, Any]]:
    """
    Finds all items lacking Setad or Sood, assigns intelligent defaults,
    and returns a full analytical dataset ready for user grid editing.
    """
    col_setad = find_column(df, SETAD_COL_CANDIDATES)
    col_sood = find_column(df, SOOD_COL_CANDIDATES)
    col_grp = find_column(df, GROUP_COL_CANDIDATES) or "گروه کالایی"
    col_p_calc = find_column(df, PRICE_CALC_CANDIDATES)
    col_p_cons = find_column(df, PRICE_CONS_CANDIDATES)

    if not col_setad and not col_sood:
        return []

    sub_setad, sub_sood = calculate_modes(df)
    rules = override_rules or DEFAULT_OVERRIDE_RULES

    # Filter missing
    if col_setad and col_sood:
        miss_df = df[df[col_setad].isna() | df[col_sood].isna()].copy()
    elif col_setad:
        miss_df = df[df[col_setad].isna()].copy()
    else:
        miss_df = df[df[col_sood].isna()].copy()

    results = []

    for idx, r in miss_df.iterrows():
        c_code = str(r.get("کد کالا", "")).strip()
        c_name = str(r.get("نام کالا", "")).strip()
        c_brand = str(r.get("نام برند", "")).strip() if pd.notna(r.get("نام برند")) else ""
        c_grp = str(r.get(col_grp, "")).strip() if pd.notna(r.get(col_grp)) else ""
        c_date = str(r.get("تاریخ افتتاح", "")).strip() if pd.notna(r.get("تاریخ افتتاح")) else ""
        is_group = str(r.get("محصول گروه صنعتی", "سایر")).strip() if pd.notna(r.get("محصول گروه صنعتی")) else "سایر"

        p_calc = r.get(col_p_calc) if col_p_calc else 0
        p_cons = r.get(col_p_cons) if col_p_cons else None
        disc_grp = r.get("درصد تخفیف گروهی فعلی", 0.0)

        # Normalized strings for reliable matching
        norm_name = normalize_persian_text(c_name)
        norm_grp = normalize_persian_text(c_grp)

        # 1. Determine Setad Cost
        if col_setad and pd.notna(r[col_setad]):
            det_setad = int(round(float(r[col_setad])))
            basis_setad = "مقدار ثبت‌شده فعلی"
        else:
            # Check override keywords
            rule_matched = False
            for kw, val in rules.get("setad", {}).items():
                if rule_matches(kw, norm_name, norm_grp):
                    det_setad = val
                    basis_setad = f"قانون اختصاصی «{kw}» ({val}٪)"
                    rule_matched = True
                    break
            if not rule_matched:
                if c_grp in sub_setad:
                    det_setad, s_cov, s_cnt = sub_setad[c_grp]
                    basis_setad = f"اکثریت گروه ({s_cnt} کالا، {s_cov}٪ هم‌مقدار)"
                else:
                    det_setad = 3
                    basis_setad = "الگوی عمومی دسته (۳٪)"

        # 2. Determine Store Sood
        if col_sood and pd.notna(r[col_sood]):
            det_sood = int(round(float(r[col_sood])))
            basis_sood = "مقدار ثبت‌شده فعلی"
        else:
            rule_matched = False
            for kw, val in rules.get("sood", {}).items():
                if rule_matches(kw, norm_name, norm_grp):
                    det_sood = val
                    basis_sood = f"قانون اختصاصی «{kw}» ({val}٪)"
                    rule_matched = True
                    break
            if not rule_matched:
                if c_grp in sub_sood:
                    det_sood, ss_cov, ss_cnt = sub_sood[c_grp]
                    basis_sood = f"اکثریت گروه ({ss_cnt} کالا، {ss_cov}٪ هم‌مقدار)"
                else:
                    det_sood = 7
                    basis_sood = "الگوی استاندارد فروشگاه (۷٪)"

        # 3. Calculate margin metrics
        eval_metrics = evaluate_single_item_margin(
            p_calc=p_calc,
            p_cons=p_cons,
            disc_grp=disc_grp,
            setad_val=det_setad,
            sood_val=det_sood
        )

        row_item = {
            "row_id": idx + 2,
            "code": c_code,
            "name": c_name,
            "brand": c_brand,
            "category": c_grp,
            "open_date": c_date,
            "opening_date": c_date,
            "is_group": is_group,
            "is_industrial_group": "بله" if is_group != "سایر" else "خير",
            "p_calc": eval_metrics["p_calc_val"],
            "calc_price": eval_metrics["p_calc_val"],
            "p_cons": eval_metrics["p_cons_val"],
            "cons_price_no_tax": eval_metrics["p_cons_val"],
            "disc_current": eval_metrics["disc_grp"],
            "supplier_discount": eval_metrics["disc_grp"],
            "setad_raw": float(r[col_setad]) if col_setad and pd.notna(r[col_setad]) else None,
            "recorded_setad": float(r[col_setad]) if col_setad and pd.notna(r[col_setad]) else "-",
            "setad_determined": det_setad,
            "determined_setad": det_setad,
            "basis_setad": basis_setad,
            "setad_basis": basis_setad,
            "sood_raw": float(r[col_sood]) if col_sood and pd.notna(r[col_sood]) else None,
            "recorded_sood": float(r[col_sood]) if col_sood and pd.notna(r[col_sood]) else "-",
            "sood_determined": det_sood,
            "determined_sood": det_sood,
            "basis_sood": basis_sood,
            "sood_basis": basis_sood,
            "conv_disc": eval_metrics["conv_disc"],
            "proposed_convert_discount": eval_metrics["conv_disc"],
            "status": eval_metrics["status"],
            "store_net_price": eval_metrics["store_net_price"],
            "net_store_price": eval_metrics["store_net_price"],
            "gap": eval_metrics["gap"],
            "price_gap": eval_metrics["gap"],
            "gross_margin": eval_metrics["gross_margin"],
            "gross_margin_total": eval_metrics["gross_margin"],
            "needs_setad_convert": pd.isna(r[col_setad]) if col_setad else True,
            "needs_sood_convert": pd.isna(r[col_sood]) if col_sood else True
        }
        results.append(row_item)

    return results
