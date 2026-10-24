# برنامه اجرایی پیاده‌سازی نرم‌افزار جامع کانورت و قیمت‌گذاری ERP

> **هدف:** ایجاد ماژول کامل، خودکار و مستقل جهت خواندن گزارش‌های روزانه تخفیف گروهی و قیمت عامل، هوشمندی تعیین مد ستاد و سود، جدول تعاملی وب با قابلیت ویرایش زنده و تولید خودکار فایل‌های کانورت ERP (دسته‌های ۹۴۶، ۹۴۰، ۸۰۰) و گزارش‌های تحلیلی.

**معماری:** سرویس سبک پایتون (ماژولار در لایه `engine/`) همراه با وب‌سرور محلی روی پورت ۸۷۰۰ و فرانت‌اند SPA مدرن (HTML5/CSS/Vanilla JS) با استایل‌های منطبق بر پنل مانیتورینگ موجود، با قابلیت ادغام مستقیم توسط کلاد.  
**پشته فناوری:** Python 3.12, openpyxl, pandas, HTML5/CSS3 (CSS Tokens), Vanilla JavaScript (RTL / Vazirmatn).

---

## فهرست وظایف (Task Decomposition)

### وظیفه ۱: ساختاربندی اولیه پروژه و فایل تنظیمات (`config.json`)
**فایل‌ها:**
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\config.json`
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\engine\__init__.py`

**جزئیات:**
- تنظیم مسیرهای پیش‌فرض: `Downloads`، درایو شبکه `D:\1.sed daily 405\2.کانورت`، پورت سرور ۸۷۰۰، و قواعد مد آماری پیش‌فرض.

---

### وظیفه ۲: پیاده‌سازی موتور خواندن داده‌ها و تعیین مد آماری (`reader.py` و `modes.py`)
**فایل‌ها:**
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\engine\reader.py`
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\engine\modes.py`
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\tests\test_reader_modes.py`

**جزئیات:**
- خواندن فایل‌های اکسل تخفیف گروهی و قیمت عامل با مدیریت انواع ستون‌ها و حل مشکلات NaN.
- تشخیص اقلام جدید نسبت به فایل مرجع قبل.
- استخراج اقلام فاقد مقدار هزینه ستاد یا سود فروشگاه.
- محاسبه هوشمند و بلادرنگ مد آماری هر گروه کالایی بر اساس اقلام دارای مقدار و اعمال قواعد خاص (پنیر پیتزا ۵٪، قند ۲٪، ژله ۴٪/۳٪، سود عمومی ۷٪ و برنج/روغن ۵٪).

---

### وظیفه ۳: موتور استخراج اقلام برندهای ۹‌گانه کلیدی (`requested_brands.py`)
**فایل‌ها:**
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\engine\requested_brands.py`
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\tests\test_requested_brands.py`

**جزئیات:**
- نرمال‌سازی متن فارسی (یکپارچه‌سازی حروف «ی» و «ک»).
- اعمال فیلترهای دقیق برای ۹ دسته درخواستی:
  1. گل‌بانو
  2. برنج و روغن‌های پالود
  3. روغن‌های ورامین
  4. کالاهای هوم‌پلاس
  5. محصولات نانسی
  6. رطب‌های مضافتی
  7. کنسرو لوبیا سپیده
  8. رب گوجه سپیده
  9. تن ماهی حمایت
- استخراج در دو ساختار: مطابق با ترتیب سطرهای فایل ورودی و تفکیک‌شده بر اساس گروه‌ها.

---

### وظیفه ۴: موتور استخراج و تحلیل سود ستاد دسته ۸۰۰ (`sood_setad.py`)
**فایل‌ها:**
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\engine\sood_setad.py`
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\tests\test_sood_setad.py`

**جزئیات:**
- پردازش فایل «قیمت عامل بنکدار مغازه دار».
- شناسایی اقلام فاقد سود ستاد.
- تعیین کد دسته فرعی متناظر (کدهای ۸۰۰۱ تا ۸۰۰۸) بر مبنای حاشیه ستاد و مدهای زیرگروه.

---

### وظیفه ۵: موتور نگارش و تولید فایل‌های کانورت و تحلیلی اکسل (`convert_writer.py`)
**فایل‌ها:**
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\engine\convert_writer.py`
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\tests\test_convert_writer.py`

**جزئیات:**
- تولید فایل `هزینه ستاد.xlsx` (شیت `bac54cc1-919a-46a3-95d3-667d6f6` با کدهای ۹۴۶ و کدهای فرعی ۹۴۶۲ تا ۹۴۶۵).
- تولید فایل `سود فروشگاه کانورت.xlsx` (شیت با کدهای ۹۴۰ و کدهای فرعی ۹۰۰۵ و ۹۰۰۷).
- تولید فایل تجمیعی ۲ برگه‌ای `کانورت هزینه ستاد و سود فروشگاه YYYY.MM.DD.xlsx`.
- تولید فایل اکسل چندبرگه‌ای با استایل شکیل برای `استخراج اقلام درخواستی پیشنهاد درصد تخفیف YYYY.MM.DD.xlsx`.
- تولید فایل اکسل تحلیلی `تعیین سود و هزینه کالاهای فاقد مقدار YYYY.MM.DD.xlsx` با فرمول‌های فعال.
- تولید فایل `سود ستاد.xlsx` در صورت وجود داده‌های فایل عامل.
- ذخیره همزمان در مسیر درایو `D:\1.sed daily 405\2.کانورت\YYYY.MM.DD` و `Downloads`.
- تولید خروجی متنی TSV برای کپی در کلیپ‌بورد.

---

### وظیفه ۶: وب‌سرور محلی و APIهای RESTful (`server.py`)
**فایل‌ها:**
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\server.py`
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\tests\test_server.py`

**جزئیات:**
- پیاده‌سازی سرور مبتنی بر `http.server` استاندارد پایتون (روی پورت ۸۷۰۰).
- اندپوینت‌های RESTful:
  * `GET /api/status`: وضعیت سرور و کشف خودکار جدیدترین فایل‌های موجود در پوشه Downloads.
  * `POST /api/load-file`: بارگذاری و پردازش اولیه فایل اکسل (آپلود دستی یا انتخاب از Downloads).
  * `POST /api/recalculate`: محاسبه مجدد مقادیر پس از ویرایش دستی سلول‌ها در جدول.
  * `POST /api/generate-converts`: تولید نهایی تمام فایل‌های خروجی اکسل و ذخیره روی دیسک.
  * `GET /api/clipboard-tsv`: دریافت رشته متنی تب‌دار جهت کپی سریع در ERP.

---

### وظیفه ۷: رابط کاربری وب تک‌صفحه‌ای (Frontend SPA)
**فایل‌ها:**
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\web\index.html`
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\web\css\tokens.css`
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\web\css\style.css`
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\web\js\app.js`
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\web\js\grid.js`

**جزئیات:**
- جعبه بارگذاری فایل با Drag & Drop و دکمه تک‌کلیکه «بارگذاری آخرین فایل امروز».
- کارت‌های خلاصه وضعیت و شاخص‌های کلیدی (تعداد کل، اقلام جدید، فاقد مقدار، کسری‌ها).
- جدول زنده با قابلیت جستجو، فیلتر و ویرایش مستقیم سلول‌های «هزینه ستاد» و «سود فروشگاه».
- تب مجزا برای مشاهده و بررسی اقلام درخواستی برندهای ۹‌گانه.
- دکمه‌های اقدام سریع با اعلان‌های زیبا (Toast Notifications) برای تولید فایل‌ها و کپی کلیپ‌بورد.

---

### وظیفه ۸: لانچر ویندوز و اعتبارسنجی نهایی با داده‌های واقعی روز
**فایل‌ها:**
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\اجرای نرم‌افزار کانورت.bat`
- ایجاد: `C:\Users\sedighi.m\Desktop\Matin Query\ERPConverter\README.md` (شامل راهنمای کامل ادغام توسط کلاد)
- اجرای تست‌های خودکار سراسری (E2E Test) بر روی فایل‌های واقعی ۲۸ و ۳۰ مهر و صحه‌گذاری ۱۰۰٪ خروجی‌ها.
