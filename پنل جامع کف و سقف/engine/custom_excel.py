# -*- coding: utf-8 -*-
import os, pandas as pd, io

try:
    from .rules import STORE_WAREHOUSE_MAP, validate_and_adjust_limits, is_zero_mandated, get_store_warehouse_code
    from .convert import generate_convert_file, generate_tsv_clipboard
except (ImportError, ValueError):
    from engine.rules import STORE_WAREHOUSE_MAP, validate_and_adjust_limits, is_zero_mandated, get_store_warehouse_code
    from engine.convert import generate_convert_file, generate_tsv_clipboard

def inspect_and_convert_custom_excel(file_bytes_or_path, override_store=None, target_date="1405.07.29"):
    # Read excel from path or bytes
    if isinstance(file_bytes_or_path, (bytes, bytearray)):
        df = pd.read_excel(io.BytesIO(file_bytes_or_path))
    else:
        df = pd.read_excel(file_bytes_or_path)
        
    cols = {str(c).strip(): c for c in df.columns}
    
    # Flexible column resolution: exact header first, then «contains» (skipping excluded words,
    # e.g. «موجودی قفسه شعبه» must not be taken as the store column)
    def find_col(candidates, exclude=()):
        for cand in candidates:
            for c_str, original_col in cols.items():
                if c_str.lower() == cand.lower():
                    return original_col
        for cand in candidates:
            for c_str, original_col in cols.items():
                if any(x in c_str for x in exclude):
                    continue
                if cand.lower() in c_str.lower():
                    return original_col
        return None

    code_col = find_col(["کد کالا", "کدکالا", "کد", "goodscode", "code"], exclude=("انبار",))
    name_col = find_col(["نام کالا", "نام محصول", "شرح کالا", "نام", "goodsname", "name"], exclude=("فروشگاه", "انبار", "شعبه"))
    min_col = find_col(["کف فعلی قفسه", "کف موجودی", "کف موجودي", "کف", "minqty", "min"])
    max_col = find_col(["سقف فعلی قفسه", "سقف موجودی", "سقف موجودي", "سقف", "maxqty", "max"])
    store_col = find_col(["نام فروشگاه", "فروشگاه", "شعبه", "dcname", "store"], exclude=("موجودی", "کد"))
    wh_code_col = find_col(["کد انبار(*)", "کد انبار", "stockid"])
    batch_col = find_col(["تعداد بچ مادر", "بچ مادر", "بچ", "کارتن", "تعداد در کارتن", "cartontype", "batch"])
    status_col = find_col(["وضعیت کالا در فروشگاه", "وضعیت کالا", "وضعیت", "status"])
    shelf_col = find_col(["موجودی انبار قفسه", "موجودی قفسه", "shelf_qty", "shelf"])
    free_col = find_col(["موجودی قابل ارسال", "موجودی آزاد", "free_qty", "free"])

    if not code_col:
        raise ValueError("ستون کد کالا در فایل اکسل یافت نشد.")

    code_to_name = {}
    for s_name, s_code in STORE_WAREHOUSE_MAP.items():
        code_to_name.setdefault(s_code, s_name)
    code_to_name.update({2901: "الينا", 4401: "شاهد 17"})  # same spelling as the proposal report

    def _wh_code_value(v):
        try:
            c = int(float(v))
            return c if c > 0 else 0
        except (TypeError, ValueError):
            return 0

    # Determine store name
    detected_store = override_store
    if not detected_store and store_col:
        store_series = df[store_col].dropna().astype(str).str.strip()
        if not store_series.empty:
            detected_store = store_series.iloc[0]
    if not detected_store and wh_code_col:
        codes = [c for c in (_wh_code_value(v) for v in df[wh_code_col].dropna()) if c > 0]
        if codes:
            detected_store = code_to_name.get(codes[0], str(codes[0]))

    # Check if filename contains store name
    if not detected_store and isinstance(file_bytes_or_path, str):
        fn = os.path.basename(file_bytes_or_path)
        for s_name in STORE_WAREHOUSE_MAP.keys():
            if s_name in fn:
                detected_store = s_name
                break
            
    if not detected_store:
        detected_store = "فروشگاه عمومی"

    # Normalize store code
    store_code = get_store_warehouse_code(detected_store)

    # Master batch lookup if available
    master_batches = {}
    master_candidates = [
        r"C:\Users\sedighi.m\Downloads\شناسنامه جامع و پالایش‌شده بچ‌های ارسالی کالاها (نسخه جدید 6495 قلم).xlsx",
        r"C:\Users\sedighi.m\Downloads\شناسنامه جامع بچ‌های ارسالی کالاها (آپدیت 223 قلم جدید - 1405.07.25).xlsx",
        r"C:\Users\sedighi.m\Downloads\شناسنامه جامع و پالایش‌شده بچ‌های ارسالی کالاها (6273 قلم).xlsx"
    ]
    for mf in master_candidates:
        if os.path.exists(mf):
            try:
                m_df = pd.read_excel(mf)
                m_code_col = [c for c in m_df.columns if "کد" in str(c)][0]
                # اولویت با ستون «تعداد در بچ ارسالی به فروشگاه»
                m_ship_cols = [c for c in m_df.columns if "ارسالی" in str(c) and "بچ" in str(c)]
                m_b_col = m_ship_cols[0] if m_ship_cols else [c for c in m_df.columns if "بچ" in str(c)][0]
                m_method_cols = [c for c in m_df.columns if "روش ارسال" in str(c)]
                m_method_col = m_method_cols[0] if m_method_cols else None
                for _, mr in m_df.iterrows():
                    try:
                        c_val = int(pd.to_numeric(mr[m_code_col], errors='coerce'))
                        b_val = float(pd.to_numeric(mr[m_b_col], errors='coerce'))
                        method_str = str(mr[m_method_col]) if m_method_col and not pd.isna(mr[m_method_col]) else ""
                        is_vis = "ویزیتور" in method_str
                        master_batches[c_val] = {"ship_batch": b_val, "is_visitor": is_vis}
                    except: pass
                break
            except: pass

    items = []
    matches = 0
    mismatches = 0
    visitor_count = 0
    auto_bumps = 0
    zero_mandated_count = 0

    for _, row in df.iterrows():
        code_raw = row.get(code_col)
        if pd.isna(code_raw):
            continue
        try:
            code = int(float(code_raw))
        except:
            continue
            
        name = str(row.get(name_col, '') if name_col else '')
        
        # Batch determination
        file_batch = float(row.get(batch_col, 1) or 1) if batch_col and not pd.isna(row.get(batch_col)) else 1.0
        final_batch = file_batch
        note = "حفظ مقادیر"
        
        if code in master_batches:
            m_info = master_batches[code]
            if m_info["is_visitor"]:
                # کالای ویزیتوری: طبق دستور کاربر بدون تغییر حفظ می‌شود
                matches += 1
                visitor_count += 1
                final_batch = file_batch
                note = "کالای ویزیتوری (تأمین مستقیم)"
            else:
                mb = m_info["ship_batch"]
                if file_batch == mb:
                    matches += 1
                else:
                    mismatches += 1
                    final_batch = mb  # انطباق با بچ ارسالی شناسنامه
                    note = f"اصلاح بچ به {mb}"
        else:
            matches += 1  # در صورت نبود در شناسنامه، مقدار فایل حفظ می‌شود

        # Limits
        raw_min = row.get(min_col) if min_col else 0
        raw_max = row.get(max_col) if max_col else 0
        min_v = 0 if pd.isna(raw_min) else float(raw_min)
        max_v = 0 if pd.isna(raw_max) else float(raw_max)

        # Apply SOP rules
        if is_zero_mandated(code, name):
            adj_min, adj_max = 0, 0
            note = "الزام سقف و کف صفر طبق SOP (شوینده ۱۰ لیتری/سبد/صنعتی)"
            zero_mandated_count += 1
        else:
            adj_min, adj_max, adj_note = validate_and_adjust_limits(min_v, max_v, final_batch)
            if adj_max > max_v and max_v <= min_v:
                auto_bumps += 1
                note = f"ارتقای خودکار سقف از {int(max_v)} به {int(adj_max)} (Max > Min)"
            elif note == "حفظ مقادیر" and adj_note != "حفظ مقادیر":
                note = adj_note

        # Per-row store (multi-store files) unless the user chose a store explicitly
        row_store, row_code = detected_store, store_code
        if not override_store:
            if store_col and not pd.isna(row.get(store_col)):
                rs = str(row.get(store_col)).strip()
                rc = get_store_warehouse_code(rs)
                if rc > 0:
                    row_store, row_code = rs, rc
            elif wh_code_col:
                rc = _wh_code_value(row.get(wh_code_col))
                if rc > 0:
                    row_store, row_code = code_to_name.get(rc, str(rc)), rc

        items.append({
            "wh_name": row_store,
            "store_code": row_code,
            "code": code,
            "name": name,
            "min": adj_min,
            "max": adj_max,
            "old_min": raw_min if not pd.isna(raw_min) else "نامشخص",
            "old_max": raw_max if not pd.isna(raw_max) else "نامشخص",
            "batch": final_batch,
            "shelf_qty": float(row.get(shelf_col, 0) or 0) if shelf_col and not pd.isna(row.get(shelf_col)) else 0,
            "free_qty": float(row.get(free_col, 0) or 0) if free_col and not pd.isna(row.get(free_col)) else 0,
            "status": str(row.get(status_col, 'فعال') if status_col and not pd.isna(row.get(status_col)) else 'فعال'),
            "change_note": note
        })

    if store_code <= 0 or any(it["store_code"] <= 0 for it in items):
        # بدون کد انبار، فایل ERP ساخته نمی‌شود
        return {
            "ok": False,
            "error": f"شعبه فایل «{detected_store}» شناخته نشد و کد انبار ندارد. شعبه را در پنل انتخاب کنید و دوباره فایل را بدهید.",
            "store_name": detected_store,
            "store_code": 0,
        }

    # Generate convert file
    export_res = generate_convert_file(detected_store, items, target_date=target_date)

    return {
        "ok": True,
        "store_name": detected_store,
        "store_code": store_code,
        "filename": export_res["filename"],
        "paths": export_res["paths"],
        "tsv": export_res["tsv"],
        "count": len(items),
        "audit_summary": {
            "total_items": len(items),
            "batch_matches": matches,
            "batch_mismatches": mismatches,
            "visitor_items": visitor_count,
            "auto_bumps": auto_bumps,
            "zero_mandated": zero_mandated_count
        },
        "items": items
    }

if __name__ == '__main__':
    res = inspect_and_convert_custom_excel(r"C:\Users\sedighi.m\Downloads\پودر رحمت آباد (1).xlsx")
    print("Success:", res["ok"])
    print("Store:", res["store_name"], res["store_code"])
    print("Summary:", res["audit_summary"])
    print("Filename:", res["filename"])
