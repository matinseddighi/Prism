# -*- coding: utf-8 -*-
"""
ERPConverter - Excel Reader & File Discovery Module
Reads ERP discount proposals and price inquiry files safely and reliably.
"""

from __future__ import annotations

import glob
import os
import re
from typing import Any, Dict, List, Optional, Sequence, Tuple, Union
import pandas as pd
import numpy as np


def normalize_persian_text(text: Any) -> str:
    """Normalizes Arabic/Persian characters like 'ي' to 'ی' and 'ك' to 'ک'."""
    if not isinstance(text, str):
        return ""
    text = text.replace("ي", "ی").replace("ك", "ک")
    text = re.sub(r"\s+", " ", text)
    return text.strip()


def extract_date_from_name(filename: str) -> str:
    """Extracts Jalali date pattern like 1405.07.30 or 1405.08.01 from filename."""
    m = re.search(r"140\d[./_]\d{2}[./_]\d{2}", filename)
    if m:
        return m.group(0).replace("/", ".").replace("_", ".")
    return ""


# خروجی‌های جزئی یا ساخته‌شده از گزارش اصلی که نباید به‌جای گزارش کامل خوانده شوند
SKIP_PREFIXES = ("~$", "استخراج")


def _dirs(directory: Union[str, Sequence[str], None]) -> List[str]:
    if not directory:
        return []
    return [directory] if isinstance(directory, str) else [d for d in directory if d]


def find_latest_file(directory: Union[str, Sequence[str], None], pattern: str, recursive: bool = False) -> Optional[str]:
    """Finds the most recent file matching pattern by mtime in one or more folders.
    recursive=True also searches subfolders (the monitor panel sorts reports into «گزارش‌ها/<type>/»);
    folders starting with «_» (e.g. _تکراری) and ~$ / «استخراج…» files are skipped."""
    valid = []
    for d in _dirs(directory):
        if not os.path.isdir(d):
            continue
        pat = os.path.join(d, "**", pattern) if recursive else os.path.join(d, pattern)
        for f in glob.glob(pat, recursive=recursive):
            rel = os.path.relpath(f, d).split(os.sep)
            if any(p.startswith("_") for p in rel[:-1]) or os.path.basename(f).startswith(SKIP_PREFIXES):
                continue
            valid.append(f)
    if not valid:
        return None
    valid.sort(key=lambda x: os.path.getmtime(x), reverse=True)
    return valid[0]


def find_latest_discount_file(directory: Union[str, Sequence[str], None], recursive: bool = False) -> Optional[str]:
    """Finds latest 'پیشنهاد درصد تخفیف گروهی' file in the folder(s)."""
    return find_latest_file(directory, "*پیشنهاد درصد تخفیف گروهی*.xlsx", recursive) or \
           find_latest_file(directory, "*درصد تخفیف پیشنهادی*.xlsx", recursive)


def find_latest_agent_file(directory: Union[str, Sequence[str], None], recursive: bool = False) -> Optional[str]:
    """Finds latest 'قیمت عامل بنکدار مغازه دار' file in the folder(s)."""
    return find_latest_file(directory, "*قیمت عامل بنکدار مغازه دار*.xlsx", recursive)


NUMERIC_COLS = [
    "اعلامیه قیمت خرید بدون مالیات",
    "آخرین قیمت تأمین بدون مالیات",
    "قیمت لحاظ شده در محاسبات",
    "قیمت مصرف کننده بدون مالیات",
    "قیمت فروش پیشنهادی بدون مالیات",
    "قیمت مصرف کننده با مالیات",
    "قیمت فروش پیشنهادی با مالیات",
    "درصد تخفیف گروهی فعلی",
    "کانورت درصد تخفیف گروهی",
    "سود درنظر گرفته شده برای کالا(%)",
    "هزینه ستاد",
    "مالیات",
    "ماندگاری مجاز",
    "موجودی کل"
]


def read_discount_file(filepath: str) -> Dict[str, Any]:
    """
    Parses a discount proposal Excel file into a clean DataFrame and metadata.
    """
    if not os.path.exists(filepath):
        raise FileNotFoundError(f"File not found: {filepath}")

    filename = os.path.basename(filepath)
    date_str = extract_date_from_name(filename)
    
    # Read excel
    df = pd.read_excel(filepath)
    
    # Standardize column types
    for col in NUMERIC_COLS:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce")
            
    if "کد کالا" in df.columns:
        df["کد کالا"] = df["کد کالا"].astype(str).str.strip().str.replace(r"\.0$", "", regex=True)

    return {
        "filepath": filepath,
        "filename": filename,
        "date_str": date_str,
        "total_rows": len(df),
        "columns": list(df.columns),
        "df": df
    }


def find_previous_archive_file(current_filepath: str, archive_dir: Union[str, Sequence[str], None]) -> Optional[str]:
    """
    Finds the latest previous daily discount file in the archive(s) to compare new goods against.
    """
    curr_date = extract_date_from_name(os.path.basename(current_filepath))
    files = glob.glob(os.path.join(os.path.dirname(current_filepath), "*پیشنهاد درصد تخفیف گروهی*.xlsx"))
    for d in _dirs(archive_dir):
        if os.path.isdir(d):
            files += glob.glob(os.path.join(d, "**", "*پیشنهاد درصد تخفیف گروهی*.xlsx"), recursive=True)

    candidates = []
    curr_norm = os.path.abspath(current_filepath).lower()
    for f in set(files):
        if os.path.abspath(f).lower() == curr_norm or os.path.basename(f).startswith(SKIP_PREFIXES):
            continue
        d = extract_date_from_name(os.path.basename(f))
        if d and d < curr_date:
            candidates.append((d, os.path.getmtime(f), f))

    if not candidates:
        return None

    # Sort primarily by date descending, then mtime
    candidates.sort(key=lambda x: (x[0], x[1]), reverse=True)
    return candidates[0][2]


def detect_new_goods(df_current: pd.DataFrame, df_previous: Optional[pd.DataFrame]) -> pd.DataFrame:
    """
    Detects goods present in current file that were absent in the previous report.
    """
    if df_previous is None or len(df_previous) == 0:
        return pd.DataFrame()
        
    curr_codes = set(df_current["کد کالا"].astype(str))
    prev_codes = set(df_previous["کد کالا"].astype(str))
    
    new_codes = curr_codes - prev_codes
    return df_current[df_current["کد کالا"].astype(str).isin(new_codes)].copy()
