# -*- coding: utf-8 -*-
"""
ERPConverter - Excel and TSV Convert Exporter
Generates standard ERP conversion files, multi-tab analytical workbooks,
and formatted TSV strings with zero formula errors and RTL styling.
"""

from __future__ import annotations

import os
import shutil
from typing import Any, Dict, List, Optional, Tuple, Union
import openpyxl
from openpyxl.styles import Font, PatternFill, Alignment, Border, Side
from openpyxl.utils import get_column_letter
import pandas as pd


# Constants
ERP_SHEET_NAME = "bac54cc1-919a-46a3-95d3-667d6f6"
ERP_HEADERS = ("کد دسته اصلي (*)", "کد دسته فرعي (*)", "کد کالا (*)")

# Styling definitions
FONT_FAMILY = "Tahoma"
HEADER_FILL_NAVY = PatternFill(start_color="1B365D", end_color="1B365D", fill_type="solid")
HEADER_FILL_BLUE = PatternFill(start_color="0F4C81", end_color="0F4C81", fill_type="solid")
HEADER_FILL_TEAL = PatternFill(start_color="134E4A", end_color="134E4A", fill_type="solid")
HEADER_FONT_WHITE = Font(name=FONT_FAMILY, size=10, bold=True, color="FFFFFF")

CELL_FONT = Font(name=FONT_FAMILY, size=9)
CELL_FONT_BOLD = Font(name=FONT_FAMILY, size=9, bold=True)
ZEBRA_FILL = PatternFill(start_color="F8FAFC", end_color="F8FAFC", fill_type="solid")
DEFICIT_FILL = PatternFill(start_color="FEE2E2", end_color="FEE2E2", fill_type="solid")

THIN_BORDER_SIDE = Side(style="thin", color="CBD5E1")
THIN_BORDER = Border(
    left=THIN_BORDER_SIDE, right=THIN_BORDER_SIDE,
    top=THIN_BORDER_SIDE, bottom=THIN_BORDER_SIDE
)
ALIGN_CENTER = Alignment(horizontal="center", vertical="center")
ALIGN_RIGHT = Alignment(horizontal="right", vertical="center")


def _apply_sheet_view(ws: openpyxl.worksheet.worksheet.Worksheet) -> None:
    """Configures RTL and clean grid view for worksheet."""
    ws.sheet_view.rightToLeft = True
    ws.views.sheetView[0].rightToLeft = True


def _autofit_columns(ws: openpyxl.worksheet.worksheet.Worksheet, max_len: int = 50) -> None:
    """Adjusts column widths dynamically according to content."""
    for col in ws.columns:
        col_letter = get_column_letter(col[0].column)
        max_width = 10
        for cell in col:
            val = cell.value
            if val is not None:
                s = str(val)
                # Count approximate Persian character width
                w = len(s) + 2
                if w > max_width:
                    max_width = min(w, max_len)
        ws.column_dimensions[col_letter].width = max_width + 2


def generate_single_convert_workbook(
    rows: List[Tuple[int, int, str]],
    output_path: str,
    sheet_name: str = ERP_SHEET_NAME
) -> str:
    """
    Creates a single ERP convert Excel file (e.g. هزینه ستاد or سود فروشگاه).
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    wb = openpyxl.Workbook()
    ws = wb.active
    ws.title = sheet_name
    _apply_sheet_view(ws)

    # Headers
    ws.append(list(ERP_HEADERS))
    for col_idx in range(1, 4):
        c = ws.cell(row=1, column=col_idx)
        c.fill = HEADER_FILL_NAVY
        c.font = HEADER_FONT_WHITE
        c.alignment = ALIGN_CENTER
        c.border = THIN_BORDER

    # Rows
    for r_idx, (cat_main, cat_sub, code) in enumerate(rows, start=2):
        c1 = ws.cell(row=r_idx, column=1, value=int(cat_main))
        c2 = ws.cell(row=r_idx, column=2, value=int(cat_sub))
        c3 = ws.cell(row=r_idx, column=3, value=erp_code(code))
        for c in (c1, c2, c3):
            c.font = CELL_FONT
            c.alignment = ALIGN_CENTER
            c.border = THIN_BORDER

    _autofit_columns(ws)
    wb.save(output_path)
    return output_path


def generate_combined_convert_workbook(
    setad_rows: List[Tuple[int, int, str]],
    sood_rows: List[Tuple[int, int, str]],
    output_path: str
) -> str:
    """
    Creates a combined 2-tab convert Excel file:
    Tab 1: هزینه ستاد (946)
    Tab 2: سود فروشگاه (940)
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    wb = openpyxl.Workbook()

    # Tab 1: Setad
    ws_setad = wb.active
    ws_setad.title = "هزینه ستاد (946)"
    _apply_sheet_view(ws_setad)
    ws_setad.append(list(ERP_HEADERS))
    for col_idx in range(1, 4):
        c = ws_setad.cell(row=1, column=col_idx)
        c.fill = HEADER_FILL_NAVY
        c.font = HEADER_FONT_WHITE
        c.alignment = ALIGN_CENTER
        c.border = THIN_BORDER

    for r_idx, (cat_main, cat_sub, code) in enumerate(setad_rows, start=2):
        c1 = ws_setad.cell(row=r_idx, column=1, value=int(cat_main))
        c2 = ws_setad.cell(row=r_idx, column=2, value=int(cat_sub))
        c3 = ws_setad.cell(row=r_idx, column=3, value=erp_code(code))
        for c in (c1, c2, c3):
            c.font = CELL_FONT
            c.alignment = ALIGN_CENTER
            c.border = THIN_BORDER
    _autofit_columns(ws_setad)

    # Tab 2: Sood
    ws_sood = wb.create_sheet(title="سود فروشگاه (940)")
    _apply_sheet_view(ws_sood)
    ws_sood.append(list(ERP_HEADERS))
    for col_idx in range(1, 4):
        c = ws_sood.cell(row=1, column=col_idx)
        c.fill = HEADER_FILL_NAVY
        c.font = HEADER_FONT_WHITE
        c.alignment = ALIGN_CENTER
        c.border = THIN_BORDER

    for r_idx, (cat_main, cat_sub, code) in enumerate(sood_rows, start=2):
        c1 = ws_sood.cell(row=r_idx, column=1, value=int(cat_main))
        c2 = ws_sood.cell(row=r_idx, column=2, value=int(cat_sub))
        c3 = ws_sood.cell(row=r_idx, column=3, value=erp_code(code))
        for c in (c1, c2, c3):
            c.font = CELL_FONT
            c.alignment = ALIGN_CENTER
            c.border = THIN_BORDER
    _autofit_columns(ws_sood)

    wb.save(output_path)
    return output_path


def generate_requested_brands_workbook(
    requested_data: Dict[str, Any],
    output_path: str
) -> str:
    """
    Creates multi-sheet requested brands workbook:
    - Tab 1: کل اقلام (سورت فایل جدید)
    - Tab 2: کل اقلام (تفکیک به دسته‌ها)
    - Tab 3: خلاصه و آمار دسته‌ها
    - Tabs 4..N: Individual brand categories
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    wb = openpyxl.Workbook()

    df_file_order = requested_data.get("df_file_order", pd.DataFrame())
    category_dfs = requested_data.get("category_dfs", {})
    summary = requested_data.get("summary", [])

    # Priority columns to display cleanly
    cols = [
        "ردیف در فایل اصلی", "دسته درخواستی", "کد کالا", "نام کالا", "نام برند",
        "گروه کالایی", "تاریخ افتتاح", "بارکد 123 پیش فرض", "قیمت لحاظ شده در محاسبات",
        "قیمت مصرف‌کننده بدون مالیات", "درصد تخفیف گروهی فعلی", "سود درنظر گرفته شده برای کالا(%)",
        "هزینه ستاد"
    ]

    def _write_table_sheet(ws, df_data, title, fill_color=HEADER_FILL_NAVY):
        ws.title = title
        _apply_sheet_view(ws)
        if df_data.empty:
            ws.append(["موردی یافت نشد"])
            return

        present_cols = [c for c in cols if c in df_data.columns]
        ws.append(present_cols)
        for col_idx in range(1, len(present_cols) + 1):
            c = ws.cell(row=1, column=col_idx)
            c.fill = fill_color
            c.font = HEADER_FONT_WHITE
            c.alignment = ALIGN_CENTER
            c.border = THIN_BORDER

        for r_idx, (_, r) in enumerate(df_data[present_cols].iterrows(), start=2):
            is_zebra = (r_idx % 2 == 1)
            for c_idx, val in enumerate(r, start=1):
                cell_val = val
                if pd.isna(cell_val):
                    cell_val = ""
                cell = ws.cell(row=r_idx, column=c_idx, value=cell_val)
                cell.font = CELL_FONT
                cell.border = THIN_BORDER
                cell.alignment = ALIGN_CENTER if c_idx in (1, 2, 3, 7, 8, 11, 12, 13) else ALIGN_RIGHT
                if is_zebra:
                    cell.fill = ZEBRA_FILL
        _autofit_columns(ws)

    # 1. File Order
    ws1 = wb.active
    _write_table_sheet(ws1, df_file_order, "کل اقلام (سورت فایل جدید)")

    # 2. Categorized Order
    df_cat_order_list = []
    for cat_name, sub_df in category_dfs.items():
        if not sub_df.empty:
            df_cat_order_list.append(sub_df)
    df_cat_order = pd.concat(df_cat_order_list, ignore_index=True) if df_cat_order_list else pd.DataFrame()
    ws2 = wb.create_sheet()
    _write_table_sheet(ws2, df_cat_order, "کل اقلام (تفکیک به دسته‌ها)")

    # 3. Summary Sheet
    ws3 = wb.create_sheet(title="خلاصه و آمار دسته‌ها")
    _apply_sheet_view(ws3)
    sum_headers = ["ردیف", "عنوان دسته درخواستی", "تعداد کالا", "اقلام شاخص نمونه", "دامنه تخفیف تأمین", "سودهای ثبت‌شده", "هزینه ستاد"]
    ws3.append(sum_headers)
    for col_idx in range(1, len(sum_headers) + 1):
        c = ws3.cell(row=1, column=col_idx)
        c.fill = HEADER_FILL_TEAL
        c.font = HEADER_FONT_WHITE
        c.alignment = ALIGN_CENTER
        c.border = THIN_BORDER

    for r_idx, s in enumerate(summary, start=2):
        row_vals = [
            s.get("index", r_idx - 1),
            s.get("category", ""),
            s.get("count", 0),
            s.get("sample_items", ""),
            s.get("discount_range", ""),
            s.get("sood_range", ""),
            s.get("setad_range", "")
        ]
        is_zebra = (r_idx % 2 == 1)
        for c_idx, val in enumerate(row_vals, start=1):
            cell = ws3.cell(row=r_idx, column=c_idx, value=val)
            cell.font = CELL_FONT
            cell.border = THIN_BORDER
            cell.alignment = ALIGN_CENTER if c_idx in (1, 3, 5, 6, 7) else ALIGN_RIGHT
            if is_zebra:
                cell.fill = ZEBRA_FILL
    _autofit_columns(ws3)

    # 4..N Category Specific sheets
    for cat_name, sub_df in category_dfs.items():
        safe_title = f"{cat_name} ({len(sub_df)} کالا)"[:31]
        ws_cat = wb.create_sheet()
        _write_table_sheet(ws_cat, sub_df, safe_title, fill_color=HEADER_FILL_BLUE)

    wb.save(output_path)
    return output_path


def generate_determining_workbook(
    date_str: str,
    source_filename: str,
    missing_items: List[Dict[str, Any]],
    new_goods: List[Dict[str, Any]],
    total_goods_count: int,
    output_path: str
) -> str:
    """
    Creates comprehensive analytical workbook:
    - Tab 1: خلاصه (Executive KPI cards & metrics)
    - Tab 2: تعیین سود و هزینه فروشگاه (Detailed calculation grid)
    - Tab 3: کالاهای جدید اضافه شده (Comparison with previous day)
    """
    os.makedirs(os.path.dirname(os.path.abspath(output_path)), exist_ok=True)
    wb = openpyxl.Workbook()

    # Tab 1: خلاصه
    ws_sum = wb.active
    ws_sum.title = "خلاصه"
    _apply_sheet_view(ws_sum)

    ws_sum.cell(row=1, column=1, value=f"تعیین هزینه ستاد و سود فروشگاه — {date_str}").font = Font(name=FONT_FAMILY, size=13, bold=True, color="1B365D")
    ws_sum.cell(row=2, column=1, value=f"منبع: {source_filename} ({total_goods_count:,} کالا)").font = Font(name=FONT_FAMILY, size=10, italic=True)

    kpi_headers = ["شاخص عملیاتی", "تعداد"]
    for c_idx, h in enumerate(kpi_headers, start=1):
        c = ws_sum.cell(row=4, column=c_idx, value=h)
        c.fill = HEADER_FILL_NAVY
        c.font = HEADER_FONT_WHITE
        c.alignment = ALIGN_CENTER
        c.border = THIN_BORDER

    deficits_count = sum(1 for item in missing_items if str(item.get("status", "")).startswith("کسری"))
    convertible_count = sum(1 for item in missing_items if (item.get("proposed_convert_discount") or 0) > 0)
    abnormal_count = sum(1 for item in missing_items if "نامتعارف" in str(item.get("status", "")))

    kpis = [
        ("کالای جدید اضافه\u200cشده نسبت به گزارش قبل", len(new_goods)),
        ("کالای بدون هزینه ستاد یا سود فروشگاه در فایل جدید", len(missing_items)),
        ("کالای قابل کانورت تخفیف فروشگاه", convertible_count),
        ("کسری قیمت فروشگاه", deficits_count),
        ("نیاز به هماهنگی بازرگانی / سهم نامتعارف", abnormal_count)
    ]

    for idx, (metric, val) in enumerate(kpis, start=5):
        c_m = ws_sum.cell(row=idx, column=1, value=metric)
        c_v = ws_sum.cell(row=idx, column=2, value=val)
        c_m.font = CELL_FONT_BOLD
        c_m.border = THIN_BORDER
        c_m.alignment = ALIGN_RIGHT
        c_v.font = CELL_FONT_BOLD
        c_v.border = THIN_BORDER
        c_v.alignment = ALIGN_CENTER
        if idx % 2 == 1:
            c_m.fill = ZEBRA_FILL
            c_v.fill = ZEBRA_FILL

    ws_sum.column_dimensions["A"].width = 50
    ws_sum.column_dimensions["B"].width = 18

    # Tab 2: تعیین سود و هزینه فروشگاه
    ws_grid = wb.create_sheet(title="تعیین سود و هزینه فروشگاه")
    _apply_sheet_view(ws_grid)

    grid_headers = [
        "کد کالا", "نام کالا", "نام برند", "گروه کالایی",
        "هزینه ستاد تعیین\u200cشده", "سود فروشگاه تعیین\u200cشده",
        "تاریخ افتتاح", "محصول گروه صنعتی", "بدون هزینه ستاد و ماندگاری",
        "شامل ۴.۵٪ ماندگاری نمی\u200cشود", "قیمت لحاظ شده در محاسبات",
        "قیمت مصرف\u200cکننده بدون مالیات", "درصد تخفیف گروهی فعلی",
        "هزینه ستاد ثبت\u200cشده", "مبنای تعیین هزینه ستاد",
        "سود فروشگاه ثبت\u200cشده", "مبنای تعیین سود فروشگاه",
        "کانورت پیشنهادی فروشگاه", "وضعیت", "قیمت فروشگاه پس از کسر سود",
        "گپ قیمت فروشگاه و تأمین", "حاشیه سود ناخالص کل", "سهم فروشگاه از تخفیف تامین"
    ]
    ws_grid.append(grid_headers)
    for col_idx in range(1, len(grid_headers) + 1):
        c = ws_grid.cell(row=1, column=col_idx)
        c.fill = HEADER_FILL_BLUE
        c.font = HEADER_FONT_WHITE
        c.alignment = ALIGN_CENTER
        c.border = THIN_BORDER

    for r_idx, item in enumerate(missing_items, start=2):
        row_vals = [
            str(item.get("code", "")),
            item.get("name", ""),
            item.get("brand", ""),
            item.get("category", ""),
            item.get("determined_setad", 0),
            item.get("determined_sood", 0),
            item.get("opening_date", ""),
            item.get("is_industrial_group", "خير"),
            item.get("no_setad_mandegari", "خير"),
            item.get("no_mandegari_4_5", "خير"),
            item.get("calc_price", 0),
            item.get("cons_price_no_tax", 0),
            item.get("supplier_discount", 0),
            item.get("recorded_setad", "-"),
            item.get("setad_basis", ""),
            item.get("recorded_sood", "-"),
            item.get("sood_basis", ""),
            item.get("proposed_convert_discount", 0),
            item.get("status", "سالم"),
            item.get("net_store_price", 0),
            item.get("price_gap", 0),
            item.get("gross_margin_total", 0),
            item.get("store_share_pct", 0)
        ]
        is_zebra = (r_idx % 2 == 1)
        is_deficit = (str(item.get("status", "")).startswith("کسری"))
        for c_idx, val in enumerate(row_vals, start=1):
            cell = ws_grid.cell(row=r_idx, column=c_idx, value=val)
            cell.font = CELL_FONT
            cell.border = THIN_BORDER
            cell.alignment = ALIGN_CENTER if c_idx in (1, 5, 6, 7, 8, 9, 10, 13, 14, 16, 18, 19) else ALIGN_RIGHT
            if is_deficit:
                cell.fill = DEFICIT_FILL
            elif is_zebra:
                cell.fill = ZEBRA_FILL

    _autofit_columns(ws_grid)

    # Tab 3: کالاهای جدید اضافه شده
    ws_new = wb.create_sheet(title="کالاهای جدید اضافه شده")
    _apply_sheet_view(ws_new)
    new_headers = ["کد کالا", "نام کالا", "نام برند", "گروه کالایی", "تاریخ افتتاح", "قیمت لحاظ شده در محاسبات"]
    ws_new.append(new_headers)
    for col_idx in range(1, len(new_headers) + 1):
        c = ws_new.cell(row=1, column=col_idx)
        c.fill = HEADER_FILL_NAVY
        c.font = HEADER_FONT_WHITE
        c.alignment = ALIGN_CENTER
        c.border = THIN_BORDER

    for r_idx, item in enumerate(new_goods, start=2):
        row_vals = [
            str(item.get("code", "")),
            item.get("name", ""),
            item.get("brand", ""),
            item.get("category", ""),
            item.get("opening_date", ""),
            item.get("calc_price", 0)
        ]
        is_zebra = (r_idx % 2 == 1)
        for c_idx, val in enumerate(row_vals, start=1):
            cell = ws_new.cell(row=r_idx, column=c_idx, value=val)
            cell.font = CELL_FONT
            cell.border = THIN_BORDER
            cell.alignment = ALIGN_CENTER if c_idx in (1, 5) else ALIGN_RIGHT
            if is_zebra:
                cell.fill = ZEBRA_FILL
    _autofit_columns(ws_new)

    wb.save(output_path)
    return output_path


def erp_code(code: Any) -> Union[int, str]:
    """کد کالا در فایل ورود سیستم عدد است (مثل نمونه‌های ERP)؛ کد غیرعددی همان متن می‌ماند."""
    s = str(code).strip()
    return int(s) if s.isdigit() else s


def _int_or_none(v: Any) -> Optional[int]:
    try:
        if v is None or v == "" or pd.isna(v):
            return None
        return int(round(float(v)))
    except (TypeError, ValueError):
        return None


def build_convert_rows(missing_items: List[Dict[str, Any]]) -> Tuple[List[Tuple[int, int, str]], List[Tuple[int, int, str]], List[Dict[str, Any]]]:
    """ردیف‌های ۹۴۶ (هزینه ستاد، 946X) و ۹۴۰ (سود فروشگاه، 90XX).
    فقط مقداری که در گزارش خالی بوده وارد فایل می‌شود (needs_*_convert)؛ مقدار ثبت‌شده دوباره فرستاده نمی‌شود.
    مقدار خارج از محدوده کد فرعی (ستاد ۱ تا ۹، سود ۱ تا ۹۹) کنار گذاشته و گزارش می‌شود."""
    setad_rows, sood_rows, skipped = [], [], []
    for item in missing_items:
        code = str(item.get("code", "")).strip()
        if not code:
            continue
        if item.get("needs_setad_convert", True):
            v = _int_or_none(item.get("determined_setad"))
            if v is not None and 1 <= v <= 9:
                setad_rows.append((946, 9460 + v, code))
            elif v not in (None, 0):
                skipped.append({"code": code, "field": "setad", "value": v})
        if item.get("needs_sood_convert", True):
            v = _int_or_none(item.get("determined_sood"))
            if v is not None and 1 <= v <= 99:
                sood_rows.append((940, 9000 + v, code))
            elif v not in (None, 0):
                skipped.append({"code": code, "field": "sood", "value": v})
    return setad_rows, sood_rows, skipped


def generate_clipboard_tsv(rows: List[Tuple[int, int, str]]) -> str:
    """
    Generates a TSV string ready for pasting directly into the ERP grid.
    Includes headers matching ERP import format.
    """
    lines = ["\t".join(ERP_HEADERS)]
    for cat_main, cat_sub, code in rows:
        lines.append(f"{cat_main}\t{cat_sub}\t{str(code).strip()}")
    return "\n".join(lines)


def export_all_converts(
    date_str: str,
    source_filename: str,
    missing_items: List[Dict[str, Any]],
    requested_data: Optional[Dict[str, Any]],
    new_goods: List[Dict[str, Any]],
    total_goods_count: int,
    sood_setad_data: Optional[Dict[str, Any]],
    export_dir: str,
    downloads_dir: Optional[str] = None
) -> Dict[str, Any]:
    """
    Coordinates and exports all convert files:
    1. هزینه ستاد.xlsx (Category 946)
    2. سود فروشگاه کانورت.xlsx (Category 940)
    3. کانورت هزینه ستاد و سود فروشگاه YYYY.MM.DD.xlsx (Combined)
    4. استخراج اقلام درخواستی پیشنهاد درصد تخفیف YYYY.MM.DD.xlsx
    5. تعیین سود و هزینه کالاهای فاقد مقدار YYYY.MM.DD.xlsx
    6. سود ستاد.xlsx (Category 800 - if agent data provided)
    """
    os.makedirs(export_dir, exist_ok=True)
    generated_files = []

    # 1. Build row lists
    setad_rows, sood_rows, skipped = build_convert_rows(missing_items)

    # 1. هزینه ستاد
    p_setad = os.path.join(export_dir, "هزینه ستاد.xlsx")
    generate_single_convert_workbook(setad_rows, p_setad)
    generated_files.append(p_setad)

    # 2. سود فروشگاه کانورت
    p_sood = os.path.join(export_dir, "سود فروشگاه کانورت.xlsx")
    generate_single_convert_workbook(sood_rows, p_sood)
    generated_files.append(p_sood)

    # 3. کانورت هزینه ستاد و سود فروشگاه YYYY.MM.DD.xlsx
    p_comb = os.path.join(export_dir, f"کانورت هزینه ستاد و سود فروشگاه {date_str}.xlsx")
    generate_combined_convert_workbook(setad_rows, sood_rows, p_comb)
    generated_files.append(p_comb)

    # 4. تعیین سود و هزینه کالاهای فاقد مقدار YYYY.MM.DD.xlsx
    p_det = os.path.join(export_dir, f"تعیین سود و هزینه کالاهای فاقد مقدار {date_str}.xlsx")
    generate_determining_workbook(
        date_str=date_str,
        source_filename=source_filename,
        missing_items=missing_items,
        new_goods=new_goods,
        total_goods_count=total_goods_count,
        output_path=p_det
    )
    generated_files.append(p_det)

    # 5. استخراج اقلام درخواستی (if available)
    if requested_data:
        p_req = os.path.join(export_dir, f"استخراج اقلام درخواستی پیشنهاد درصد تخفیف {date_str}.xlsx")
        generate_requested_brands_workbook(requested_data, p_req)
        generated_files.append(p_req)

    # 6. سود ستاد (Category 800 - if agent file data exists)
    if sood_setad_data and sood_setad_data.get("convert_rows"):
        p_sood_setad = os.path.join(export_dir, "سود ستاد.xlsx")
        generate_single_convert_workbook(sood_setad_data["convert_rows"], p_sood_setad)
        generated_files.append(p_sood_setad)

    # Copy files to Downloads if specified
    copied_files = []
    if downloads_dir and os.path.exists(downloads_dir):
        for f in generated_files:
            try:
                dest = os.path.join(downloads_dir, os.path.basename(f))
                shutil.copy2(f, dest)
                copied_files.append(dest)
            except Exception:
                pass

    return {
        "success": True,
        "export_dir": export_dir,
        "generated_files": generated_files,
        "copied_to_downloads": copied_files,
        "setad_count": len(setad_rows),
        "sood_count": len(sood_rows),
        "skipped": skipped,
        "clipboard_setad_tsv": generate_clipboard_tsv(setad_rows),
        "clipboard_sood_tsv": generate_clipboard_tsv(sood_rows)
    }
