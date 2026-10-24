# -*- coding: utf-8 -*-
"""
ماژول قوانین عملیاتی استاندارد (SOP Engine)
بر اساس دستورالعمل قطعی و دائمی پروژه در سند GEMINI.md
"""

from typing import Tuple

# نگاشت رسمی کدهای ۴ رقمی انبار قفسه شعب بر اساس پایگاه داده ERP و فایل‌های کانورت سیستم
STORE_WAREHOUSE_MAP = {
    # ۳۳۰۱: بهشتی (کد شعبه ۳۳)
    "بهشتی": 3301,
    "بهشتي": 3301,

    # ۲۷۰۱: زبرخان (کد شعبه ۲۷)
    "زبرخان": 2701,

    # ۳۵۰۱: مدرس (کد شعبه ۳۵)
    "مدرس": 3501,

    # ۲۹۰۱: الینا
    "الینا": 2901,
    "الينا": 2901,

    # ۳۰۰۱: پژواک
    "پژواک": 3001,

    # ۳۱۰۱: مطهری
    "مطهری": 3101,
    "مطهري": 3101,

    # ۳۴۰۱: فضل
    "فضل": 3401,

    # ۳۶۰۱: فردوسی شمالی
    "فردوسی شمالی": 3601,
    "فردوسی": 3601,
    "فردوسي": 3601,
    "فردوسي شمالي": 3601,

    # ۳۸۰۱: چناران
    "چناران": 3801,

    # ۳۹۰۱: رحمت آباد
    "رحمت آباد": 3901,
    "رحمت‌آباد": 3901,
    "رحمت اباد": 3901,
    "رحمت": 3901,

    # ۴۰۰۱: جمهوری
    "جمهوری": 4001,
    "جمهوري": 4001,

    # ۴۱۰۱: بوژان
    "بوژان": 4101,

    # ۴۲۰۱: الهیه
    "الهیه": 4201,
    "الهيه": 4201,

    # ۴۳۰۱: ۱۷ شهریور
    "17 شهریور": 4301,
    "۱۷ شهریور": 4301,
    "17 شهريور": 4301,

    # ۴۴۰۱: قاسم آباد / شاهد ۱۷
    "قاسم آباد": 4401,
    "قاسم‌آباد": 4401,
    "قاسم اباد": 4401,
    "شاهد 17": 4401,
    "شاهد": 4401,
}

# کدهای اقلام با کف و سقف دائمی صفر (بخش ۵ سند SOP در GEMINI.md)
PERMANENT_ZERO_CODES = {
    # ۱. شیر خشک‌های کیسه‌ای و صنعتی و مواد اولیه کارخانه
    9902807, 9902808, 9902809, 9902810, 9902901, 9903691, 9904320,
    9902811, 9902816, 9902927,
    # ۲. شوینده‌ها و مایعات ۱۰ لیتری/۱۰ کیلویی مصرف نظافت شعبه
    9900910, 9905498,
    # ۳. ملزومات، دارایی‌های لجستیکی و سبدهای فروشگاهی
    9902937, 9903731,
    # ۴. کالاهای متوقف‌شده، سبدهای اشتباه یا حذفی خاص
    9904201,
    # ۵. کالاهای فله و وزنی
    9906761,
}


def normalize_persian_text(text: str) -> str:
    """یکسان‌سازی حروف فارسی و عربی (ی/ي، ک/ك) و حذف نیم‌فاصله"""
    if not text:
        return ""
    s = str(text).strip()
    return s.replace('ي', 'ی').replace('ك', 'ک').replace('\u200c', ' ')


def get_store_warehouse_code(store_name: str) -> int:
    """دریافت کد انبار ۴ رقمی قفسه شعبه با نرمال‌سازی نام"""
    if not store_name:
        return 0
    s_norm = normalize_persian_text(store_name)
    for name, code in STORE_WAREHOUSE_MAP.items():
        n_norm = normalize_persian_text(name)
        if s_norm == n_norm or s_norm in n_norm or n_norm in s_norm:
            return code

    # استخراج کد ۴ رقمی در صورت وجود در نام (مانند انبار 3101 یا 3901)
    import re
    m = re.search(r'\b(\d{4})\b', str(store_name))
    if m:
        return int(m.group(1))

    return STORE_WAREHOUSE_MAP.get(str(store_name).strip(), 0)


def is_zero_mandated(code: int, name: str = "") -> bool:
    """بررسی اینکه آیا کالا طبق بخش ۵ دستورالعمل SOP باید کف و سقف صفر داشته باشد یا خیر"""
    try:
        c = int(code)
    except (ValueError, TypeError):
        c = 0
    if c in PERMANENT_ZERO_CODES:
        return True

    name_norm = normalize_persian_text(str(name or ""))

    # ۱. شوینده‌ها و مایعات ۱۰ لیتری/۱۰ کیلویی و فله
    has_10_size = any(k in name_norm for k in ["10 لیتری", "10 کیلویی", "۱۰ لیتری", "۱۰ کیلویی", "10لیتری", "10کیلویی", "10 لتر", "10 کیلو"])
    if has_10_size and any(w in name_norm for w in ["مایع", "سفیدکننده", "جرم گیر", "دستشویی", "ظرفشویی", "لباسشویی", "شوینده", "گلرنگ", "آترا"]):
        return True

    # ۲. ملزومات، دارایی‌های لجستیکی و سبدهای فروشگاهی
    if "سبد" in name_norm:
        if any(w in name_norm for w in ["پلاست", "پالود", "سفید", "ابی", "آبی", "۲۵", "25", "چرخ", "خرید"]):
            return True

    # ۳. شیر خشک‌های کیسه‌ای و صنعتی (مواد اولیه کارخانه و فله)
    if any(k in name_norm for k in ["کیسه 25", "کیسه 10", "کیسه ۱۰", "کیسه ۲۵", "پاکت 15", "پاکت 20", "پاکت 25", "پاکت ۱۵", "پاکت ۲۰"]):
        if any(w in name_norm for w in ["شیر خشک", "شیرخشک", "پودر اب پنیر", "پودر آب پنیر", "mpc"]):
            return True

    # ۴. کالاهای فله و وزنی
    if any(w in name_norm for w in ["کشتار روز", "ماهی فله", "نهاده"]):
        return True

    return False


def validate_and_adjust_limits(
    min_val: float,
    max_val: float,
    carton: float = 1,
    is_slow_moving: bool = False
) -> Tuple[int, int, str]:
    """اعتبارسنجی و تصحیح سقف و کف بر اساس قوانین سلامت داده و شرط قطعی Max > Min"""
    min_i = max(0, int(round(float(min_val or 0))))
    max_i = max(0, int(round(float(max_val or 0))))
    carton_i = max(1, int(round(float(carton or 1))))

    if min_i == 0 and max_i == 0:
        return (0, 0, "کف و سقف صفر (عادی/غیرفعال)")

    note = "حفظ مقادیر"
    if max_i <= min_i:
        if carton_i > min_i:
            max_i = carton_i
        else:
            max_i = max(min_i + 1, int(round(min_i * 1.5)))
        note = f"ارتقای خودکار سقف جهت رعایت شرط سقف > کف (سقف جدید: {max_i})"

    if is_slow_moving and carton_i > 0:
        if carton_i <= 12 and max_i > carton_i:
            max_i = carton_i
            note += " | مهار سقف کندگرد به ۱ کارتن"

    return (min_i, max_i, note)
