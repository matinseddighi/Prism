/* =====================================================================
 * موتور محاسبات قیمت‌گذاری — بازنویسی دقیق منطق کوئری‌های SQL
 *   - درصد تخفیف گروه پیشنهادی.sql      → store
 *   - قیمت گذاری عامل.sql               → agent
 *   - قیمت گذاری انبار مرکزی.sql        → central
 *   - قیمت گذاری انبار ذخیره.sql        → reserve
 * ===================================================================== */
(function (root) {
  'use strict';
  const E = {};
  const EPS = 1e-7;

  // ---------- اعداد (شبیه‌سازی رفتار SQL Server) ----------
  const isNum = (x) => typeof x === 'number' && isFinite(x);
  // CAST(x AS INT/BIGINT) → حذف اعشار به سمت صفر
  const trunc = (x) => (isNum(x) ? Math.trunc(x + (x >= 0 ? EPS : -EPS)) : null);
  // CAST(x AS DECIMAL(p,d)) → گرد کردن (نیم به دور از صفر)
  const round = (x, d = 0) => {
    if (!isNum(x)) return null;
    const f = Math.pow(10, d);
    return (Math.sign(x) * Math.round(Math.abs(x) * f + 1e-7)) / f;
  };
  const truncD = (x, d) => {
    if (!isNum(x)) return null;
    const f = Math.pow(10, d);
    return Math.trunc(x * f + (x >= 0 ? 1e-6 : -1e-6)) / f;
  };
  const pct = (p) => 1 + (Number(p) || 0) / 100;
  E.trunc = trunc; E.round = round; E.truncD = truncD;

  // ---------- نرمال‌سازی متن ----------
  const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹', AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
  function normDigits(s) {
    return String(s).replace(/[۰-۹]/g, (d) => FA_DIGITS.indexOf(d)).replace(/[٠-٩]/g, (d) => AR_DIGITS.indexOf(d));
  }
  function norm(s) {
    if (s == null) return '';
    return normDigits(s).replace(/ي/g, 'ی').replace(/ك/g, 'ک').replace(/ة/g, 'ه')
      .replace(/[\s‌‍‎‏ ]/g, '').replace(/[ًٌٍَُِّْ]/g, '');
  }
  function toNum(v) {
    if (v == null || v === '') return null;
    if (typeof v === 'number') return isFinite(v) ? v : null;
    const s = normDigits(v).replace(/[,٬،\s]/g, '').replace(/٫/g, '.');
    if (s === '' || s === '-') return null;
    const n = Number(s);
    return isFinite(n) ? n : null;
  }
  const isBlank = (v) => v == null || String(v).trim() === '';
  const str = (v) => (v == null ? '' : String(v).trim());
  E.norm = norm; E.toNum = toNum; E.normDigits = normDigits; E.isBlank = isBlank;

  // ---------- ضرایب عمومی (قابل تغییر در برنامه) ----------
  E.DEFAULT_PARAMS = {
    firstCarRent: 2,        // کرایه اولیه (کالاهای کد 9 غیر گروه صنعتی)
    mandegari: 4.5,         // هزینه ماندگاری
    lastCarRent: 1.5,       // کرایه آخر (فروشگاه و انبار ذخیره)
    expiryFactor: 0.15,     // ضریب کسر ماندگاری مجاز از درصد تخفیف
    discountTolerance: 2,   // آستانه مغایرت درصد تخفیف (واحد درصد)
    amelNewCredit: 9,       // افزایش اعتباری قیمت عامل جدید (تا مهر ۱۴۰۵: ۱۰)
    amelCashCredit: 9,      // اختلاف نقد و اعتبار عامل
    bonakdarMarkup: 6,      // سود بنکدار نسبت به عامل نقدی
    maqazehdarMarkup: 9,    // سود مغازه‌دار نسبت به عامل نقدی
    retailCredit: 9,        // افزایش اعتباری بنکدار / مغازه‌دار / ارگانی (تا مهر ۱۴۰۵: ۱۰)
    cutoffDate: '1404/12/15', // سری ساخت‌های ثبت شده از این تاریخ با فرمول جدید
    centralFinance: 10,     // هزینه مالی انبار مرکزی
    centralSoodSetad: false,// اعمال سود ستاد در انبار مرکزی (در کوئری غیرفعال است)
    reserveDocCost: 9,      // کسر 9% از قیمت سری ساخت سند 65 (انبار ذخیره)
    reserveCut: 25,         // کاهش 25% انبار ذخیره (خرید بدون هشدار + ارسال با هشدار)
    // --- طرح قیمت رقابتی فروشگاه ---
    planKviBasic: true,     // کالای اساسی = کالای کلیدی
    planKviExempt: true,    // کالای بدون هزینه ستاد و ماندگاری = کالای کلیدی
    planKviOverpriced: true,// تخفیف فعلی بیشتر از سقف (خرید گران / فشار رقابتی) = کالای کلیدی
    planKviGroups: '',      // گروه‌های کالایی کلیدی (بخشی از نام، با ویرگول جدا)
    planKviMinMargin: 0,    // کف سود واقعی کالای کلیدی (٪)
    planMaxDrop: 5,         // حداکثر کاهش تخفیف در هر دوره (واحد درصد)
    planTailToCeiling: true,// کالای غیرکلیدی: تخفیف تا تخفیف رایج زیرگروه بالا برود (حداکثر تا سقف)
    planMaxRaise: 5,        // حداکثر افزایش تخفیف کالای غیرکلیدی در هر دوره
    planCompGap: 0,         // چند درصد ارزان‌تر از رقیب (کالای کلیدی)
    planUseExpiry: false,   // کسر ماندگاری مجاز (× ۰٫۱۵) از سقف تخفیف
    planFixRounding: true,  // سقف تخفیف رو به پایین (نه گرد کردن کوئری)
  };
  // نسخه ضرایب ذخیره‌شده: اگر کاربر ضریبی را تغییر نداده بود (برابر پیش‌فرض قدیم)، به پیش‌فرض جدید منتقل می‌شود
  E.PARAMS_VERSION = 2;
  const PARAM_MIGRATIONS = {
    2: { amelNewCredit: [10, 9], retailCredit: [10, 9] }, // کوئری AlarmPrice مهر ۱۴۰۵: اعتبار ۱۰٪ → ۹٪
  };
  E.migrateParams = function (p) {
    p = Object.assign({}, p);
    for (let v = (p._v || 1) + 1; v <= E.PARAMS_VERSION; v++) {
      for (const [k, [from, to]] of Object.entries(PARAM_MIGRATIONS[v] || {})) if (p[k] === from) p[k] = to;
    }
    p._v = E.PARAMS_VERSION;
    return p;
  };
  E.PARAM_META = [
    { key: 'firstCarRent', label: 'کرایه اولیه', unit: '%', group: 'مشترک', desc: 'فقط کالاهای کد ۹ که محصول گروه صنعتی نیستند' },
    { key: 'mandegari', label: 'هزینه ماندگاری', unit: '%', group: 'مشترک', desc: 'برای کالاهایی که معاف از ماندگاری نیستند' },
    { key: 'lastCarRent', label: 'کرایه آخر', unit: '%', group: 'فروشگاه / انبار ذخیره' },
    { key: 'expiryFactor', label: 'ضریب ماندگاری مجاز', unit: '×', group: 'فروشگاه', desc: 'درصد تخفیف − ماندگاری مجاز × این ضریب' },
    { key: 'discountTolerance', label: 'آستانه مغایرت تخفیف', unit: '%', group: 'فروشگاه' },
    { key: 'amelNewCredit', label: 'افزایش اعتباری عامل جدید', unit: '%', group: 'عامل' },
    { key: 'amelCashCredit', label: 'اختلاف نقد و اعتبار عامل', unit: '%', group: 'عامل' },
    { key: 'bonakdarMarkup', label: 'سود بنکدار (روی عامل نقدی)', unit: '%', group: 'عامل' },
    { key: 'maqazehdarMarkup', label: 'سود مغازه‌دار (روی عامل نقدی)', unit: '%', group: 'عامل' },
    { key: 'retailCredit', label: 'افزایش اعتباری بنکدار/مغازه‌دار/ارگانی', unit: '%', group: 'عامل' },
    { key: 'cutoffDate', label: 'تاریخ مبنای سری ساخت جدید', unit: 'تاریخ', group: 'عامل', type: 'text' },
    { key: 'centralFinance', label: 'هزینه مالی انبار مرکزی', unit: '%', group: 'انبار مرکزی' },
    { key: 'centralSoodSetad', label: 'اعمال سود ستاد در انبار مرکزی', unit: '', group: 'انبار مرکزی', type: 'bool' },
    { key: 'reserveDocCost', label: 'کسر هزینه از قیمت سند ۶۵', unit: '%', group: 'انبار ذخیره' },
    { key: 'reserveCut', label: 'کاهش انبار ذخیره', unit: '%', group: 'انبار ذخیره' },
    { key: 'planKviBasic', label: 'کالای اساسی = کلیدی', type: 'bool', group: 'طرح قیمت رقابتی' },
    { key: 'planKviExempt', label: 'کالای بدون هزینه ستاد و ماندگاری = کلیدی', type: 'bool', group: 'طرح قیمت رقابتی' },
    { key: 'planKviOverpriced', label: 'تخفیف فعلی بیشتر از سقف = کلیدی', type: 'bool', group: 'طرح قیمت رقابتی', desc: 'کالایی که گران خریده شده و برای رقابت تخفیف بیشتری می‌گیرد' },
    { key: 'planKviGroups', label: 'گروه‌های کالایی کلیدی', type: 'text', unit: '', group: 'طرح قیمت رقابتی', desc: 'بخشی از نام گروه، با ویرگول جدا؛ مثلاً: روغن، برنج، شير، نوشابه' },
    { key: 'planKviMinMargin', label: 'کف سود واقعی کالای کلیدی', unit: '%', group: 'طرح قیمت رقابتی', desc: 'کالای کلیدی برای رقابت می‌تواند زیر سود مصوب برود، ولی نه کمتر از این عدد' },
    { key: 'planMaxDrop', label: 'حداکثر کاهش تخفیف در هر دوره', unit: '%', group: 'طرح قیمت رقابتی', desc: 'برای جلوگیری از شوک گرانی، کاهش تخفیف پله‌ای انجام می‌شود' },
    { key: 'planTailToCeiling', label: 'کالای غیرکلیدی هم‌سطح تخفیف رایج زیرگروه شود', type: 'bool', group: 'طرح قیمت رقابتی', desc: 'تخفیف تا میانه زیرگروه بالا می‌رود (هرگز بیشتر از سقف)؛ غیرفعال = فقط اصلاح تخفیف‌های بیش از سقف' },
    { key: 'planMaxRaise', label: 'حداکثر افزایش تخفیف غیرکلیدی در هر دوره', unit: '%', group: 'طرح قیمت رقابتی' },
    { key: 'planCompGap', label: 'ارزان‌تر از رقیب (کالای کلیدی)', unit: '%', group: 'طرح قیمت رقابتی' },
    { key: 'planFixRounding', label: 'سقف تخفیف دقیق (گرد رو به پایین)', type: 'bool', group: 'طرح قیمت رقابتی', desc: 'کوئری سقف را گرد می‌کند و تا نیم واحد از سود مصوب را می‌بخشد؛ فعال = سود مصوب دقیق حفظ شود' },
    { key: 'planUseExpiry', label: 'کسر ماندگاری مجاز از سقف تخفیف', type: 'bool', group: 'طرح قیمت رقابتی', desc: 'فعال = سقف همان «بعد از ماندگاری» (محتاطانه‌تر)؛ غیرفعال = سقف همان کانورت (روال فعلی)' },
  ];

  const INDUSTRIAL = 'محصول گروه صنعتی';
  const isIndustrialTxt = (v) => norm(v) === norm(INDUSTRIAL);
  const firstCarApplies = (code, industrial) => str(code).startsWith('9') && !industrial;

  // =====================================================================
  //  تعریف گزارش‌ها و ستون‌ها (تشخیص خودکار نوع گزارش)
  // =====================================================================
  // کاندیدها: تطبیق دقیق (پس از نرمال‌سازی)؛ پیشوند ~ یعنی «شامل»
  E.TYPES = {
    store: {
      title: 'درصد تخفیف پیشنهادی فروشگاه',
      short: 'فروشگاه',
      // هرکدام از این ستون‌ها کافی است (نسخه‌های مختلف خروجی کوئری)
      signatureAny: [['~قبل از تأثیر ماندگاری'], ['~بعد از تأثیر ماندگاری'], ['کانورت درصد تخفیف گروهی'], ['درصد تخفیف گروهی فعلی', 'قیمت فروش پیشنهادی بدون مالیات']],
      rowKey: (r) => str(r.code),
      fields: {
        code: ['کد کالا'], name: ['نام کالا'], openDate: ['تاریخ افتتاح'], barcode: ['~بارکد'],
        tax: ['مالیات'], expiryTerm: ['ماندگاری مجاز'], qty: ['موجودی کل'],
        elamieh: ['اعلامیه قیمت خرید بدون مالیات'], tamin: ['آخرین قیمت تأمین بدون مالیات'],
        basePrice: ['قیمت لحاظ شده در محاسبات'], cmpFlag: ['~مقایسه اعلامیه'],
        userNoVat: ['قیمت مصرف کننده بدون مالیات'], r_sale: ['قیمت فروش پیشنهادی بدون مالیات'],
        r_disc: ['~قبل از تأثیر ماندگاری'], r_convert: ['کانورت درصد تخفیف گروهی'],
        r_discAfter: ['~بعد از تأثیر ماندگاری'], userVat: ['قیمت مصرف کننده با مالیات'],
        r_saleVat: ['قیمت فروش پیشنهادی با مالیات'], groupDiscount: ['درصد تخفیف گروهی فعلی'],
        r_diffFlag: ['~مغایرت درصد تخفیف'], storeProfit: ['سود درنظر گرفته شده برای کالا(%)', 'سود درنظر گرفته شده برای کالا', '~سود درنظر گرفته شده'],
        groupPath: ['گروه کالایی'], setadCost: ['هزینه ستاد', 'هزینه ستاد(%)'], sendWay: ['نحوه ارسال'],
        exemptMTxt: ['وضعیت هزینه ماندگاری'], owner: ['محصول گروه صنعتی', 'تولید کننده'],
        brand: ['نام برند'], proDate: ['تاریخ تولید'], expDate: ['تاریخ انقضاء'], goodType: ['وضعیت کالا'],
        exemptSMTxt: ['وضعیت محاسبه ماندگاری و هزینه ستاد', 'وضعیت محاسبه ماندگاری و هزینه ستاد'],
        r_realSood: ['سود واقعی فروش'],
        // اختیاری: اگر کوئری ستون تاریخ تخفیف داشته باشد
        discFrom: ['~تاریخ شروع تخفیف', '~شروع تخفیف'], discTo: ['~تاریخ پایان تخفیف', '~پایان تخفیف', '~اتمام تخفیف'],
      },
    },
    agent: {
      title: 'قیمت‌گذاری عامل / بنکدار / مغازه‌دار / ارگانی',
      short: 'عامل',
      signature: ['قیمت عامل نقدی'],
      rowKey: (r) => [str(r.code), str(r.batchNo), str(r.warehouse)].join('|'),
      fields: {
        code: ['کد کالا'], name: ['نام کالا'], tax: ['مالیات'],
        soodSetad: ['سود ستاد درنظر گرفته شده برای کالا(%)', '~سود ستاد درنظر'], groupPath: ['گروه کالایی'],
        qty: ['موجودی کل'], elamieh: ['اعلامیه قیمت خرید بدون مالیات'], tamin: ['آخرین قیمت تأمین بدون مالیات'],
        basePrice: ['قیمت لحاظ شده در محاسبات'], holdingPrice: ['قیمت محاسبه شده تأمین'],
        priceSource: ['قیمت بدست آمده از'], cmpFlag: ['~مقایسه اعلامیه'],
        batchNo: ['سری ساخت'], warehouse: ['نام انبار'], proDate: ['تاریخ تولید'], expDate: ['تاریخ انقضاء'],
        oldAmelBatch: ['قیمت عامل قدیم در سری ساخت'], r_bnAmel: ['قیمت سری ساخت + سود ستاد(عامل قدیم)', '~سود ستاد(عامل قدیم)'],
        bnUserVat: ['قیمت مصرف کننده با مالیات در سری ساخت'], bnUserNoVat: ['قیمت مصرف کننده بدون مالیات در سری ساخت'],
        r_newCredit: ['قیمت عامل جدید(اعتباری)'], insDate: ['تاریخ ثبت سری ساخت'],
        selAmel: ['قیمت عامل لحاظ شده در فرمول ها(اعتباری)'], r_maxAmel: ['بیشترین قیمت عامل(قدیم)'],
        r_selAmelCash: ['قیمت عامل لحاظ شده در فرمول ها(نقدی)'], selUser: ['قیمت مصرف کننده لحاظ شده در فرمول ها'],
        r_s2: ['~مرحله 2'], r_s3: ['~مرحله 3'], r_s4: ['عدد مرحله 4'], r_s5: ['عدد مرحله 5'], r_s6: ['عدد مرحله 6'],
        contractUser: ['~نرخ های قراردادی'],
        r_amelCash: ['قیمت عامل نقدی'], r_amelCredit: ['قیمت عامل اعتباری'], curAmel: ['قیمت عامل فعلی'],
        r_bonCash: ['قیمت بنکدار نقدی'], r_bonCredit: ['قیمت بنکدار اعتباری'], curBon: ['قیمت بنکدار فعلی'],
        r_maqCash: ['قیمت مغازه دار نقدی'], r_maqCredit: ['قیمت مغازه دار اعتباری'], curMaq: ['قیمت مغازه دار فعلی'],
        exemptSMTxt: ['وضعیت هزینه ماندگاری و هزینه ستاد'], setadCost: ['هزینه ستاد(%)', 'هزینه ستاد'],
        owner: ['تولید کننده'], sendWay: ['نحوه ارسال'], exemptMTxt: ['وضعیت هزینه ماندگاری'],
        soodOrgan: ['سود ارکانی درنظر گرفته شده برای کالا(%)', 'سود ارگانی درنظر گرفته شده برای کالا(%)', '~درنظر گرفته شده برای کالا(%)ارگانی'],
        r_organCash: ['قیمت ارگانی نقدی'], r_organCredit: ['قیمت ارگانی اعتباری'], r_soodEffect: ['تأثیر سود ستاد'],
      },
    },
    central: {
      title: 'قیمت پیشنهادی سری ساخت انبار مرکزی',
      short: 'انبار مرکزی',
      signature: ['قیمت پیشنهادی سری ساخت انبار مرکزی'],
      rowKey: (r) => [str(r.docNo), str(r.code), str(r.batchNo), str(r.proDate), str(r.expDate)].join('|'),
      fields: {
        docDate: ['تاریخ سند 21'], docNo: ['شماره سند 21'], docStatus: ['وضعیت تأیید سند 21'],
        code: ['کد کالا'], name: ['نام کالا'], groupPath: ['گروه کالایی'], brand: ['نام برند'],
        owner: ['تولید کننده'], supplier: ['تأمین کننده'], qty: ['تعداد سری ساخت در سند 21'],
        batchNo: ['سری ساخت'], bnUser: ['قیمت مصرف کننده در سری ساخت'], proDate: ['تاریخ تولید'], expDate: ['تاریخ انقضاء'],
        docPrice: ['قیمت در سند 21'], soodSetad: ['سود کالا ستاد(%)'], soodStore: ['سود کالا فروشگاه(%)'],
        setadCost: ['هزینه ستاد(%)'], sendWay: ['نحوه ارسال'],
        exemptMTxt: ['وضعیت هزینه ماندگاری(عاملین)', 'وضعیت هزینه ماندگاری'],
        exemptSMTxt: ['وضعیت هزینه ماندگاری و هزینه ستاد'],
        r_first: ['~کرایه اولیه'], r_mand: ['~تأثیر ماندگاری'], r_setad: ['تأثیر هزینه ستاد'],
        r_fin: ['~هزینه مالی'], r_final: ['قیمت پیشنهادی سری ساخت انبار مرکزی'],
      },
    },
    reserve: {
      title: 'قیمت نهایی پیشنهادی انبار ذخیره',
      short: 'انبار ذخیره',
      signature: ['قیمت نهایی پیشنهادی انبار ذخیره'],
      rowKey: (r) => [str(r.docNo), str(r.code), str(r.batchNo)].join('|'),
      fields: {
        fromDC: ['انبار مبدأ سند 65'], toDC: ['انبار مقصد سند 65'], docDate: ['تاریخ سند 65'], docNo: ['شماره سند 65'],
        docStatus: ['وضعیت تأیید سند 65'], code: ['کد کالا'], name: ['نام کالا'], docPrice: ['قیمت سند 65'],
        batchNo: ['سری ساخت سند 65'], proDate: ['تاریخ تولید'], expDate: ['تاریخ انقضاء'],
        bnInsDate: ['تاریخ ثبت سری ساخت انبار مبدأ'], bnPriceText: ['قیمت خرید در متن سری ساخت'],
        taminDate: ['تاریخ سند تأمین'], taminNo: ['شماره سند تأمین'], taminPrice: ['قیمت تأمین'],
        half50: ['تاریخ 50% طول عمر کالا'], half70: ['تاریخ 70% طول عمر کالا'],
        buyStatus: ['وضعیت خرید کالا'], brand: ['نام برند'], owner: ['تولید کننده'], sendStatus: ['وضعیت ارسال کالا'],
        exemptSMTxt: ['وضعیت هزینه ماندگاری و هزینه ستاد'], exemptMAmelTxt: ['وضعیت هزینه ماندگاری(عاملین)'],
        exemptMStoreTxt: ['وضعیت هزینه ماندگاری(فروشگاه)'], setadCost: ['هزینه ستاد(%)'],
        r_first: ['~کرایه اولیه'], r_mand: ['~تأثیر هزینه ماندگاری'], r_setad: ['تأثیر هزینه ستاد'],
        r_last: ['~کرایه آخر'], r_cut: ['~کاهش 25'], r_final: ['قیمت نهایی پیشنهادی انبار ذخیره'],
      },
    },
  };

  // تشخیص نوع گزارش از روی سرستون‌ها
  function headerMatch(nh, cand) {
    if (cand[0] === '~') return nh.includes(norm(cand.slice(1)));
    return nh === norm(cand);
  }
  E.detectType = function (headers) {
    const nh = headers.map(norm);
    const has = (sig) => sig.every((c) => nh.some((h) => headerMatch(h, c)));
    // اول گزارش‌هایی با امضای اختصاصی (عامل، انبارها)، بعد فروشگاه
    for (const [t, def] of Object.entries(E.TYPES)) if (def.signature && has(def.signature)) return t;
    for (const [t, def] of Object.entries(E.TYPES)) if (def.signatureAny && def.signatureAny.some(has)) return t;
    return null;
  };
  // نگاشت ستون‌ها: اول تطبیق دقیق، بعد «شامل»
  E.mapColumns = function (type, headers) {
    const nh = headers.map(norm);
    const used = new Set();
    const map = {};
    const fields = E.TYPES[type].fields;
    for (const pass of [0, 1]) {
      for (const [key, cands] of Object.entries(fields)) {
        if (map[key] != null) continue;
        for (const c of cands) {
          if ((c[0] === '~') !== (pass === 1)) continue;
          const idx = nh.findIndex((h, i) => !used.has(i) && headerMatch(h, c));
          if (idx >= 0) { map[key] = idx; used.add(idx); break; }
        }
      }
    }
    return map;
  };
  E.rowObject = function (map, arr) {
    const o = {};
    for (const [k, i] of Object.entries(map)) o[k] = arr[i];
    return o;
  };

  // =====================================================================
  //  ۱) فروشگاه — درصد تخفیف پیشنهادی
  // =====================================================================
  E.store = {};
  E.store.inputsFromRow = function (r) {
    return {
      code: str(r.code), name: str(r.name),
      basePrice: toNum(r.basePrice),       // خالی = قیمت تأمین/اعلامیه ندارد → نتیجه خالی (مانند کوئری)
      tax: toNum(r.tax) ?? 0,
      userVat: toNum(r.userVat),
      userNoVat: toNum(r.userNoVat),
      groupDiscount: toNum(r.groupDiscount),
      storeProfit: toNum(r.storeProfit) ?? 0,
      setadCost: toNum(r.setadCost) ?? 0,
      expiryTerm: toNum(r.expiryTerm),     // خالی = ماندگاری مجاز ثبت نشده → تخفیف بعد از ماندگاری خالی
      industrial: isIndustrialTxt(r.owner),
      exemptMandegari: !isBlank(r.exemptMTxt),
      exemptSetadMandegari: !isBlank(r.exemptSMTxt),
      // برای طرح قیمت رقابتی
      basic: norm(r.goodType).includes(norm('اساسی')),
      groupPath: str(r.groupPath),
      compPrice: null,     // قیمت رقیب با مالیات (از فایل قیمت رقبا)
      kviManual: null,     // true/false = تعیین دستی کالای کلیدی
      // نسخه جدید کوئری (بدون ستون «قبل از تأثیر ماندگاری»): کانورت از تخفیف بعد از ماندگاری
      convertAfter: !('r_disc' in r),
    };
  };
  E.store.compute = function (inp, P) {
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    const steps = [];
    const fc = firstCarApplies(inp.code, inp.industrial);
    const mandOn = !inp.exemptSetadMandegari && !inp.exemptMandegari;
    const setadOn = !inp.exemptSetadMandegari;
    const mul = (a, f) => (a == null ? null : a * f);
    let v = inp.basePrice;
    steps.push({ label: 'قیمت لحاظ شده در محاسبات (بدون مالیات)', value: v, note: v == null ? 'قیمت تأمین/اعلامیه ثبت نشده' : '' });
    v = mul(v, fc ? pct(P.firstCarRent) : 1);
    steps.push({ label: 'تأثیر کرایه اولیه', factor: fc ? `× ${pct(P.firstCarRent)}` : 'اعمال نمی‌شود', value: v, off: !fc });
    v = mul(v, mandOn ? pct(P.mandegari) : 1);
    steps.push({ label: 'تأثیر هزینه ماندگاری', factor: mandOn ? `× ${pct(P.mandegari)}` : 'معاف', value: v, off: !mandOn });
    v = mul(v, setadOn ? pct(inp.setadCost) : 1);
    steps.push({ label: 'تأثیر هزینه ستاد', factor: setadOn ? `× ${pct(inp.setadCost)}` : 'معاف', value: v, off: !setadOn });
    v = mul(v, pct(P.lastCarRent));
    steps.push({ label: 'تأثیر کرایه آخر', factor: `× ${pct(P.lastCarRent)}`, value: v });
    const saleRaw = mul(v, pct(inp.storeProfit));
    steps.push({ label: 'سود فروشگاه → قیمت فروش پیشنهادی بدون مالیات', factor: `× ${pct(inp.storeProfit)}`, value: saleRaw, main: true });

    const userNoVat = inp.userNoVat != null ? inp.userNoVat
      : (inp.userVat != null ? round(inp.userVat / pct(inp.tax)) : null);
    const gd = inp.groupDiscount ?? 0;
    const orderDiff = userNoVat && saleRaw != null ? round(100 - (saleRaw * 100) / userNoVat) : null;
    const orderDiffFinal = orderDiff == null ? null : Math.max(0, orderDiff);
    const expiryCut = mandOn ? (inp.expiryTerm == null ? null : inp.expiryTerm * P.expiryFactor) : 0;
    const discAfterRaw = orderDiffFinal == null || expiryCut == null ? null : orderDiffFinal - expiryCut;
    // کانورت: نسخه قدیم کوئری از تخفیف قبل از ماندگاری، نسخه جدید (۱۴۰۵/۰۷) از تخفیف بعد از ماندگاری
    const convBase = inp.convertAfter ? (discAfterRaw ?? 0) : (orderDiffFinal ?? 0);
    const convert = Math.abs(convBase - gd) > P.discountTolerance ? trunc(convBase) : gd;
    const discAfter = trunc(discAfterRaw);
    const saleVatCurrent = inp.userVat != null ? trunc(inp.userVat * ((100 - gd) / 100)) : null;
    const saleVatNew = inp.userVat != null && discAfter != null ? trunc(inp.userVat * ((100 - Math.max(0, discAfter)) / 100)) : null;
    const realSood = discAfterRaw != null && discAfterRaw < 0 ? trunc(inp.storeProfit + discAfterRaw) : null;

    steps.push({ label: 'قیمت مصرف‌کننده بدون مالیات', value: userNoVat, note: inp.userNoVat == null ? 'محاسبه از قیمت با مالیات' : '' });
    steps.push({ label: 'درصد تخفیف پیشنهادی (قبل از ماندگاری)', value: orderDiffFinal, unit: '%', formula: '100 − فروش پیشنهادی × 100 ÷ قیمت مصرف‌کننده' });
    steps.push({ label: 'کسر ماندگاری مجاز', factor: mandOn ? `${inp.expiryTerm} × ${P.expiryFactor}` : 'معاف', value: expiryCut, unit: '%', off: !mandOn });
    steps.push({ label: 'درصد تخفیف پیشنهادی (بعد از ماندگاری)', value: discAfter, unit: '%', main: true });
    steps.push({ label: 'کانورت درصد تخفیف گروهی', value: convert, unit: '%', formula: `اگر اختلاف تخفیف ${inp.convertAfter ? 'بعد' : 'قبل'} از ماندگاری با تخفیف فعلی بیشتر از ${P.discountTolerance} باشد، همان؛ وگرنه تخفیف فعلی` });

    return {
      steps,
      flags: { firstCar: fc, mandegari: mandOn, setad: setadOn },
      out: {
        sale: trunc(saleRaw), saleRaw, userNoVat,
        disc: orderDiffFinal, convert, discAfter, discAfterRaw,
        saleVat: saleVatCurrent, saleVatNew, realSood,
        diffFlag: convert !== gd,
      },
    };
  };
  // ستون‌های گزارش ↔ خروجی محاسبه (برای کنترل صحت)
  E.store.checks = [
    ['r_sale', 'sale', 'قیمت فروش پیشنهادی بدون مالیات'],
    ['r_disc', 'disc', 'درصد تخفیف قبل از ماندگاری'],
    ['r_convert', 'convert', 'کانورت درصد تخفیف گروهی'],
    ['r_discAfter', 'discAfter', 'درصد تخفیف بعد از ماندگاری'],
    ['r_saleVat', 'saleVat', 'قیمت فروش پیشنهادی با مالیات'],
    ['r_realSood', 'realSood', 'سود واقعی فروش'],
  ];
  // -----------------------------------------------------------------
  //  طرح قیمت رقابتی (الگوی قیمت روزانه پایین / EDLP)
  //  - کالای غیرکلیدی: تخفیف = سقف مجاز (کمترین قیمتی که سود مصوب را حفظ می‌کند)
  //    اگر تخفیف فعلی بیشتر از سقف است، پله‌ای (حداکثر planMaxDrop) کم می‌شود.
  //  - کالای کلیدی: تخفیف فعلی کم نمی‌شود، تا قیمت رقیب بالا می‌رود،
  //    و فقط کف سود واقعی کالای کلیدی محدودش می‌کند.
  //  تخفیف گروهی عدد صحیح است؛ قیمت شلف = قیمت مصرف‌کننده × (۱۰۰ − تخفیف) ÷ ۱۰۰
  // -----------------------------------------------------------------
  // ctx.groupMedian = میانه تخفیف فعلی کالاهای هم‌زیرگروه (از E.store.groupMedians)
  E.store.plan = function (inp, res, P, ctx) {
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    const o = res.out;
    const sp = inp.storeProfit || 0;
    const uNo = o.userNoVat, uVat = inp.userVat;
    const cur = inp.groupDiscount ?? 0;
    const base = { cur, approved: sp, kvi: false, reasons: [], flags: [], target: null, change: null };
    if (!o.saleRaw || !uNo || uVat == null) {
      return Object.assign(base, { status: 'incomplete', action: 'داده ناقص', flags: [!o.saleRaw ? 'قیمت خرید ندارد' : 'قیمت مصرف‌کننده ندارد'] });
    }
    const cost = o.saleRaw / pct(sp);                       // بها + کرایه + ماندگاری + ستاد (بدون سود فروشگاه)
    const marginAt = (d) => ((uNo * (100 - d)) / 100 / cost - 1) * 100;
    const shelfAt = (d) => trunc((uVat * (100 - d)) / 100);
    // سقف دقیق: بدون گرد کردن رو به بالا (کوئری سقف را گرد می‌کند و تا ۰٫۵ واحد سود را می‌بخشد)
    const mandOn = res.flags.mandegari;
    const expiryCut = mandOn && P.planUseExpiry ? (inp.expiryTerm || 0) * P.expiryFactor : 0;
    const ceilExact = 100 - (o.saleRaw * 100) / uNo - expiryCut;
    const ceil = Math.max(0, P.planFixRounding ? Math.floor(ceilExact + 1e-9) : Math.round(ceilExact));
    const deficit = 100 - (o.saleRaw * 100) / uNo < 0;      // بدون تخفیف هم سود مصوب پوشش داده نمی‌شود
    const belowCost = marginAt(0) < 0;                       // بدون تخفیف هم زیر بها

    // ---- کالای کلیدی ----
    const reasons = [];
    if (inp.kviManual === true) reasons.push('انتخاب دستی');
    if (inp.kviManual !== false) {
      if (P.planKviBasic && inp.basic) reasons.push('کالای اساسی');
      if (P.planKviExempt && inp.exemptSetadMandegari) reasons.push('بدون هزینه ستاد و ماندگاری');
      // بیش از سقف گرد شده‌ی کوئری = واقعاً گران خریده شده (نه اختلاف گرد کردن)
      if (P.planKviOverpriced && cur > Math.max(0, Math.round(ceilExact))) reasons.push('تخفیف بیش از سقف (خرید گران)');
      const gs = String(P.planKviGroups || '').split(/[,،]/).map((s) => norm(s)).filter(Boolean);
      const ng = norm(inp.groupPath || '');
      if (gs.some((g) => ng.includes(g))) reasons.push('گروه کالایی کلیدی');
    }
    const kvi = inp.kviManual !== false && reasons.length > 0;

    // بیشترین تخفیفی که کف سود کالای کلیدی را نگه می‌دارد
    const kviCap = Math.max(0, Math.floor(100 - (100 * cost * pct(P.planKviMinMargin)) / uNo + 1e-9));
    // کمترین تخفیفی که قیمت شلف را به قیمت رقیب (منهای فاصله) می‌رساند
    const dComp = inp.compPrice ? Math.max(0, Math.ceil(100 * (1 - (inp.compPrice * (1 - (P.planCompGap || 0) / 100)) / uVat) - 1e-9)) : null;

    const flags = [];
    let target;
    const ref = ctx && ctx.groupMedian != null ? ctx.groupMedian : cur;
    if (kvi) {
      // بدون قیمت رقیب: مثل غیرکلیدی هم‌سطح زیرگروه با افزایش پله‌ای، ولی هرگز کاهش نمی‌یابد
      target = Math.max(cur, Math.min(ceil, Math.max(cur, ref)));
      if (target > cur + P.planMaxRaise) { target = cur + P.planMaxRaise; flags.push(`افزایش پله‌ای تا تخفیف رایج زیرگروه (${ref}٪)`); }
      // با قیمت رقیب: تا رسیدن به رقیب (حتی بیش از سقف)
      if (dComp != null && dComp > target) target = dComp;
      if (target > kviCap) {
        target = kviCap;
        flags.push(dComp != null && dComp > kviCap ? 'رسیدن به قیمت رقیب بدون زیان ممکن نیست — مذاکره قیمت خرید' : 'کف سود کالای کلیدی؛ تخفیف محدود شد');
      }
    } else {
      // هم‌سطح شدن با تخفیف رایج زیرگروه (میانه)، نه بیشتر از سقف، و افزایش پله‌ای
      target =P.planTailToCeiling ? Math.min(ceil, Math.max(cur, ref)) : Math.min(cur, ceil);
      if (target > cur + P.planMaxRaise) { target = cur + P.planMaxRaise; flags.push(`افزایش پله‌ای تا تخفیف رایج زیرگروه (${ref}٪)`); }
      if (cur > ceil) {
        target = Math.max(ceil, cur - P.planMaxDrop);
        if (target > ceil) flags.push(`کاهش پله‌ای؛ تا سقف ${ceil}٪ هنوز ${target - ceil} واحد مانده`);
      }
      // رسیدن به قیمت رقیب تا جایی که سود مصوب حفظ شود
      if (dComp != null && dComp > target) {
        target = Math.max(target, Math.min(dComp, ceil));
        if (dComp > target) flags.push(`گران‌تر از رقیب؛ رسیدن به آن ${dComp - target} واحد تخفیف زیر سود مصوب می‌خواهد`);
      }
    }
    if (belowCost) flags.push('زیر بها: قیمت مصرف‌کننده حتی بدون تخفیف بها را پوشش نمی‌دهد');
    else if (deficit) flags.push('کسری سود: قیمت مصرف‌کننده بدون تخفیف هم سود مصوب را پوشش نمی‌دهد');
    if (P.planUseExpiry && mandOn && inp.expiryTerm == null) flags.push('ماندگاری مجاز ثبت نشده (صفر فرض شد)');
    if (P.planFixRounding && cur === ceil + 1 && Math.round(ceilExact) === cur) flags.push('گرد شدن کوئری: تخفیف فعلی ۱ واحد بیش از سقف دقیق');
    target = Math.max(0, Math.min(99, target));
    const mNew = marginAt(target);
    return Object.assign(base, {
      status: 'ok', kvi, reasons, flags, ceil, ceilExact, dComp, kviCap, belowCost, deficit,
      target, change: target - cur,
      action: target > cur ? 'افزایش تخفیف' : target < cur ? 'کاهش تخفیف' : 'بدون تغییر',
      shelfCur: shelfAt(cur), shelfNew: shelfAt(target),
      marginCur: marginAt(cur), marginNew: mNew,
      belowApprovedCur: marginAt(cur) < sp - 0.01, belowApprovedNew: mNew < sp - 0.01,
    });
  };

  // میانه تخفیف فعلی هر زیرگروه (مسیر کامل گروه کالایی) — فقط کالاهای دارای قیمت
  E.store.groupMedians = function (inputs) {
    const g = new Map();
    for (const inp of inputs) {
      if (!inp.groupPath || inp.basePrice == null || inp.userVat == null) continue;
      if (!g.has(inp.groupPath)) g.set(inp.groupPath, []);
      g.get(inp.groupPath).push(inp.groupDiscount ?? 0);
    }
    const out = new Map();
    for (const [k, a] of g) { a.sort((x, y) => x - y); out.set(k, a[Math.floor((a.length - 1) / 2)]); }
    return out;
  };

  // مقایسه «فعلی» و «جدید»
  E.store.currentVsNew = function (inp, res) {
    return [
      { label: 'درصد تخفیف گروهی', cur: inp.groupDiscount, neu: res.out.discAfter, unit: '%' },
      { label: 'قیمت فروش با مالیات', cur: res.out.saleVat, neu: res.out.saleVatNew },
    ];
  };

  // =====================================================================
  //  ۲) عامل / بنکدار / مغازه‌دار / ارگانی
  // =====================================================================
  E.agent = {};
  E.agent.inputsFromRow = function (r) {
    return {
      code: str(r.code), name: str(r.name),
      tax: toNum(r.tax) ?? 0,
      soodSetad: toNum(r.soodSetad) ?? 0,
      basePrice: toNum(r.basePrice) ?? 0,
      holdingPrice: toNum(r.holdingPrice) ?? toNum(r.basePrice) ?? 0,
      setadCost: toNum(r.setadCost) ?? 0,
      industrial: isIndustrialTxt(r.owner),
      exemptMandegari: !isBlank(r.exemptMTxt),
      exemptSetadMandegari: !isBlank(r.exemptSMTxt),
      oldAmelBatch: toNum(r.oldAmelBatch) ?? 0,
      insDate: str(r.insDate),
      selAmelOld: toNum(r.selAmel),        // قیمت عامل از جدول نرخ ۱۴۰۵/۰۴/۰۱ (سری ساخت‌های قدیمی)
      bnUserVat: toNum(r.bnUserVat),
      selUserOld: toNum(r.selUser),        // قیمت مصرف‌کننده از جدول نرخ ۱۴۰۵/۰۴/۰۱
      otherMaxAmel: null,                  // بیشترین قیمت عامل سایر ردیف‌های هم‌گروه (توسط برنامه پر می‌شود)
      soodOrgan: toNum(r.soodOrgan),
      curAmel: toNum(r.curAmel), curBon: toNum(r.curBon), curMaq: toNum(r.curMaq),
    };
  };
  // قیمت مصرف‌کننده بدون مالیات سری ساخت — تابع FetchUserPrice_BI_Team خروجی REAL (اعشاری ۳۲ بیتی) دارد
  // و محاسبه در SQL با همان دقت انجام می‌شود؛ برای تطابق ریالی، همان دقت شبیه‌سازی می‌شود.
  E.agent.bnUserNoVat = function (userVat, tax) {
    if (userVat == null) return null;
    const f = Math.fround;
    return round(f(f(userVat) / f((100 + (Number(tax) || 0)) / 100)), 2);
  };
  // قیمت عامل و مصرف‌کننده‌ی لحاظ شده (بسته به تاریخ ثبت سری ساخت)
  E.agent.selected = function (inp, P) {
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    const isNew = inp.insDate && inp.insDate >= P.cutoffDate;
    const bnAmel = trunc(inp.oldAmelBatch * pct(inp.soodSetad));
    // سری ساخت قدیمی: قیمت‌ها از جدول نرخ ۱۴۰۵/۰۴/۰۱ (اگر نباشد، مانند کوئری خالی می‌ماند)
    const selAmel = isNew ? bnAmel : inp.selAmelOld;
    const selUser = isNew ? E.agent.bnUserNoVat(inp.bnUserVat, inp.tax) : inp.selUserOld;
    return { isNew, bnAmel, selAmel, selUser };
  };
  E.agent.compute = function (inp, P) {
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    const steps = [];
    const fc = firstCarApplies(inp.code, inp.industrial);
    const mandOn = !inp.exemptSetadMandegari && !inp.exemptMandegari;
    const setadOn = !inp.exemptSetadMandegari;

    // --- ساخت قیمت عامل جدید از قیمت تأمین ---
    let v = fc ? inp.basePrice * pct(P.firstCarRent) : inp.holdingPrice;
    steps.push({ label: 'قیمت لحاظ شده در محاسبات', value: fc ? inp.basePrice : inp.holdingPrice });
    steps.push({ label: 'تأثیر کرایه اولیه', factor: fc ? `× ${pct(P.firstCarRent)}` : 'اعمال نمی‌شود', value: v, off: !fc });
    v = v * (mandOn ? pct(P.mandegari) : 1);
    steps.push({ label: 'تأثیر هزینه ماندگاری', factor: mandOn ? `× ${pct(P.mandegari)}` : 'معاف', value: v, off: !mandOn });
    v = v * (setadOn ? pct(inp.setadCost) : 1);
    steps.push({ label: 'تأثیر هزینه ستاد', factor: setadOn ? `× ${pct(inp.setadCost)}` : 'معاف', value: v, off: !setadOn });
    const soodEffect = v * pct(inp.soodSetad);
    steps.push({ label: 'تأثیر سود ستاد', factor: `× ${pct(inp.soodSetad)}`, value: soodEffect });
    const newCredit = trunc(soodEffect * pct(P.amelNewCredit));
    steps.push({ label: 'قیمت عامل جدید (اعتباری)', factor: `× ${pct(P.amelNewCredit)}`, value: newCredit, main: true });

    // --- قیمت قدیم و مارجین ---
    const sel = E.agent.selected(inp, P);
    const Z = sel.selUser;
    // در کوئری، بیشترین قیمت عامل با شرط برابری قیمت مصرف‌کننده join می‌شود؛ مصرف‌کننده خالی → نتیجه خالی
    const maxAmel = Z == null ? null : (Math.max(sel.selAmel ?? 0, inp.otherMaxAmel ?? 0) || null);
    const selAmelCash = maxAmel != null ? trunc(maxAmel / pct(P.amelCashCredit)) : null;
    steps.push({ label: 'قیمت عامل قدیم سری ساخت + سود ستاد', value: sel.bnAmel });
    steps.push({ label: 'قیمت عامل لحاظ شده (اعتباری)', value: sel.selAmel, note: sel.isNew ? 'سری ساخت جدید' : 'از نرخ‌های قبلی' });
    steps.push({ label: 'بیشترین قیمت عامل (قدیم)', value: maxAmel });
    steps.push({ label: 'قیمت عامل لحاظ شده (نقدی)', factor: `÷ ${pct(P.amelCashCredit)}`, value: selAmelCash });
    steps.push({ label: 'قیمت مصرف‌کننده لحاظ شده (بدون مالیات)', value: Z });

    let s2 = null, s3 = null, s4 = null, s5 = null, s6 = null, cash = null, cashCase = '';
    if (maxAmel && selAmelCash && Z != null) {
      s2 = truncD(newCredit / maxAmel, 4) - 1;                 // مرحله ۲: مقدار افزایش قیمت
      s3 = truncD((Z - selAmelCash) / selAmelCash, 13);        // مرحله ۳: مارجین کالا
      s4 = round((s2 < 0 && s3 > 0) ? Math.abs(s2 * s3) : s2 * s3, 6);
      s5 = round((s2 > 0 && s3 > 0) ? Math.abs(s3 - s4) : Math.abs(s3 + s4), 6);
      const opposite = (s2 > 0 && s3 < 0) || (s2 < 0 && s3 > 0);
      s6 = opposite ? s5 * 100 : s5 * 100 + 100;
      if (maxAmel > newCredit) { cash = trunc(newCredit / pct(P.amelCashCredit)); cashCase = 'قیمت قدیم بیشتر از جدید → عامل جدید ÷ ' + pct(P.amelCashCredit); }
      else if (s2 < 0 && s3 > 0) { cash = Z / (1 + s6 / 100); cashCase = 'مصرف‌کننده ÷ (1 + مرحله ۶)'; }
      else if (s2 > 0 && s3 < 0) { cash = Z * (1 + s6 / 100); cashCase = 'مصرف‌کننده × (1 + مرحله ۶)'; }
      else { cash = s6 ? Z / (s6 / 100) : null; cashCase = 'مصرف‌کننده ÷ (مرحله ۶ ÷ 100)'; }
    }
    steps.push({ label: 'مرحله ۲ — مقدار افزایش قیمت', value: s2, dec: 4 });
    steps.push({ label: 'مرحله ۳ — مارجین کالا', value: s3, dec: 6 });
    steps.push({ label: 'مرحله ۴', value: s4, dec: 6 });
    steps.push({ label: 'مرحله ۵', value: s5, dec: 6 });
    steps.push({ label: 'مرحله ۶', value: s6, dec: 4 });
    steps.push({ label: 'قیمت عامل نقدی', factor: cashCase, value: cash, main: true });

    const amelCredit = cash != null ? cash * pct(P.amelCashCredit) : null;
    const bonCash = cash != null ? cash * pct(P.bonakdarMarkup) : null;
    const maqCash = cash != null ? cash * pct(P.maqazehdarMarkup) : null;
    const bonCredit = bonCash != null ? bonCash * pct(P.retailCredit) : null;
    const maqCredit = maqCash != null ? maqCash * pct(P.retailCredit) : null;
    const organImpact = inp.soodOrgan == null ? null : round(1 + (inp.soodSetad - inp.soodOrgan) / 100, 2);
    const organCash = cash == null ? null : (inp.soodOrgan == null ? cash : cash / organImpact);
    const organCredit = cash == null ? null : (inp.soodOrgan == null ? amelCredit : organCash * pct(P.retailCredit));

    return {
      steps,
      flags: { firstCar: fc, mandegari: mandOn, setad: setadOn, isNew: sel.isNew },
      out: {
        soodEffect: trunc(soodEffect), newCredit, bnAmel: sel.bnAmel, selAmel: sel.selAmel, maxAmel: trunc(maxAmel),
        selAmelCash, selUser: trunc(Z), s2, s3, s4, s5, s6,
        amelCash: trunc(cash), amelCredit: trunc(amelCredit),
        bonCash: trunc(bonCash), bonCredit: trunc(bonCredit),
        maqCash: trunc(maqCash), maqCredit: trunc(maqCredit),
        organCash: trunc(organCash), organCredit: trunc(organCredit),
      },
    };
  };
  E.agent.checks = [
    ['r_soodEffect', 'soodEffect', 'تأثیر سود ستاد'],
    ['r_newCredit', 'newCredit', 'قیمت عامل جدید (اعتباری)'],
    ['r_bnAmel', 'bnAmel', 'قیمت سری ساخت + سود ستاد'],
    ['r_maxAmel', 'maxAmel', 'بیشترین قیمت عامل (قدیم)'],
    ['r_selAmelCash', 'selAmelCash', 'قیمت عامل لحاظ شده (نقدی)'],
    ['r_amelCash', 'amelCash', 'قیمت عامل نقدی'],
    ['r_amelCredit', 'amelCredit', 'قیمت عامل اعتباری'],
    ['r_bonCash', 'bonCash', 'قیمت بنکدار نقدی'],
    ['r_bonCredit', 'bonCredit', 'قیمت بنکدار اعتباری'],
    ['r_maqCash', 'maqCash', 'قیمت مغازه‌دار نقدی'],
    ['r_maqCredit', 'maqCredit', 'قیمت مغازه‌دار اعتباری'],
    ['r_organCash', 'organCash', 'قیمت ارگانی نقدی'],
    ['r_organCredit', 'organCredit', 'قیمت ارگانی اعتباری'],
  ];
  E.agent.currentVsNew = function (inp, res) {
    return [
      { label: 'عامل (اعتباری)', cur: inp.curAmel, neu: res.out.amelCredit },
      { label: 'بنکدار (اعتباری)', cur: inp.curBon, neu: res.out.bonCredit },
      { label: 'مغازه‌دار (اعتباری)', cur: inp.curMaq, neu: res.out.maqCredit },
    ];
  };
  // گروه‌بندی برای «بیشترین قیمت عامل»: کد کالا + تاریخ تولید + تاریخ انقضا + قیمت مصرف‌کننده لحاظ شده
  E.agent.groupKey = function (r, inp, P) {
    const sel = E.agent.selected(inp, P);
    return [str(r.code), str(r.proDate), str(r.expDate), sel.selUser].join('|');
  };
  // ضرایب اعتباری که گزارش با آن ساخته شده (گزارش‌های قبل از مهر ۱۴۰۵ با ۱۰٪، بعد از آن ۹٪)
  // از نسبت ستون‌های خود گزارش، با رأی اکثریت ردیف‌ها تشخیص داده می‌شود.
  E.agent.detectParams = function (objs) {
    const vote = (pairs) => {
      const c = new Map();
      for (const [a, b] of pairs) {
        const x = toNum(a), y = toNum(b);
        if (!(x > 1000 && y > 1000)) continue;
        const r = Math.round((y / x - 1) * 100);
        c.set(r, (c.get(r) || 0) + 1);
      }
      let best = null, n = 0;
      for (const [r, k] of c) if (k > n) { best = r; n = k; }
      return best;
    };
    const out = {};
    const nc = vote(objs.map((o) => [o.r_soodEffect, o.r_newCredit]));
    const rc = vote(objs.map((o) => [o.r_bonCash, o.r_bonCredit]));
    if (nc != null && nc > 0) out.amelNewCredit = nc;
    if (rc != null && rc > 0) out.retailCredit = rc;
    return out;
  };

  // =====================================================================
  //  ۳) انبار مرکزی
  // =====================================================================
  E.central = {};
  E.central.inputsFromRow = function (r) {
    return {
      code: str(r.code), name: str(r.name),
      docPrice: toNum(r.docPrice) ?? 0,
      setadCost: toNum(r.setadCost) ?? 0,
      soodSetad: toNum(r.soodSetad) ?? 0,
      soodStore: toNum(r.soodStore) ?? 0,
      industrial: isIndustrialTxt(r.owner),
      exemptMandegari: !isBlank(r.exemptMTxt),
      exemptSetadMandegari: !isBlank(r.exemptSMTxt),
    };
  };
  E.central.compute = function (inp, P) {
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    const steps = [];
    const fc = firstCarApplies(inp.code, inp.industrial);
    const mandOn = !inp.exemptSetadMandegari && !inp.exemptMandegari;
    const setadOn = !inp.exemptSetadMandegari;
    let v = inp.docPrice;
    steps.push({ label: 'قیمت در سند ۲۱', value: v });
    const first = v * (fc ? pct(P.firstCarRent) : 1);
    steps.push({ label: 'تأثیر کرایه اولیه', factor: fc ? `× ${pct(P.firstCarRent)}` : 'اعمال نمی‌شود', value: first, off: !fc });
    const mand = first * (mandOn ? pct(P.mandegari) : 1);
    steps.push({ label: 'تأثیر ماندگاری', factor: mandOn ? `× ${pct(P.mandegari)}` : 'معاف', value: mand, off: !mandOn });
    const setad = mand * (setadOn ? pct(inp.setadCost) : 1);
    steps.push({ label: 'تأثیر هزینه ستاد', factor: setadOn ? `× ${pct(inp.setadCost)}` : 'معاف', value: setad, off: !setadOn });
    const sood = setad * (P.centralSoodSetad ? pct(inp.soodSetad) : 1);
    steps.push({ label: 'تأثیر سود ستاد', factor: P.centralSoodSetad ? `× ${pct(inp.soodSetad)}` : 'غیرفعال (طبق کوئری)', value: sood, off: !P.centralSoodSetad });
    const fin = sood * pct(P.centralFinance);
    steps.push({ label: 'تأثیر هزینه مالی', factor: `× ${pct(P.centralFinance)}`, value: fin });
    const final = trunc(fin);
    steps.push({ label: 'قیمت پیشنهادی سری ساخت انبار مرکزی', value: final, main: true });
    return { steps, flags: { firstCar: fc, mandegari: mandOn, setad: setadOn }, out: { first, mand, setad, fin, final } };
  };
  E.central.checks = [
    ['r_first', 'first', 'تأثیر کرایه اولیه', 2],
    ['r_mand', 'mand', 'تأثیر ماندگاری', 2],
    ['r_setad', 'setad', 'تأثیر هزینه ستاد', 2],
    ['r_fin', 'fin', 'تأثیر هزینه مالی', 2],
    ['r_final', 'final', 'قیمت پیشنهادی انبار مرکزی'],
  ];
  E.central.currentVsNew = () => [];

  // =====================================================================
  //  ۴) انبار ذخیره
  // =====================================================================
  E.reserve = {};
  E.reserve.inputsFromRow = function (r) {
    const ss = norm(r.sendStatus);
    return {
      code: str(r.code), name: str(r.name),
      taminPrice: toNum(r.taminPrice),
      bnPriceDoc65: null,
      setadCost: toNum(r.setadCost) ?? 0,
      industrial: isIndustrialTxt(r.owner),
      exemptSetadMandegari: !isBlank(r.exemptSMTxt),
      exemptMandegariAmel: !isBlank(r.exemptMAmelTxt),
      exemptMandegariStore: !isBlank(r.exemptMStoreTxt),
      buyWarning: !isBlank(r.buyStatus),
      sendTag: ss.includes(norm('زیر 50')) ? 1 : ss.includes(norm('بین 50')) ? 2 : ss.includes(norm('بالای 70')) ? 3 : null,
    };
  };
  E.reserve.compute = function (inp, P) {
    P = Object.assign({}, E.DEFAULT_PARAMS, P || {});
    const steps = [];
    const fc = firstCarApplies(inp.code, inp.industrial);
    const mandOn = !inp.exemptSetadMandegari && !inp.exemptMandegariAmel && !inp.exemptMandegariStore;
    const setadOn = !inp.exemptSetadMandegari;
    let tamin = inp.taminPrice;
    if (tamin == null && inp.bnPriceDoc65 != null) {
      tamin = inp.bnPriceDoc65 / pct(P.reserveDocCost) / (setadOn ? pct(inp.setadCost) : 1) / (mandOn ? pct(P.mandegari) : 1) / (fc ? pct(P.firstCarRent) : 1);
      steps.push({ label: 'قیمت سری ساخت سند ۶۵', value: inp.bnPriceDoc65 });
      steps.push({ label: 'قیمت تأمین (برگشت از سند ۶۵)', factor: 'حذف ۹٪، ستاد، ماندگاری و کرایه', value: tamin });
    } else {
      steps.push({ label: 'قیمت تأمین (سند ۲۱)', value: tamin });
    }
    tamin = tamin ?? 0;
    const first = tamin * (fc ? pct(P.firstCarRent) : 1);
    steps.push({ label: 'تأثیر کرایه اولیه', factor: fc ? `× ${pct(P.firstCarRent)}` : 'اعمال نمی‌شود', value: first, off: !fc });
    const mand = first * (mandOn ? pct(P.mandegari) : 1);
    steps.push({ label: 'تأثیر هزینه ماندگاری', factor: mandOn ? `× ${pct(P.mandegari)}` : 'معاف', value: mand, off: !mandOn });
    const setad = mand * (setadOn ? pct(inp.setadCost) : 1);
    steps.push({ label: 'تأثیر هزینه ستاد', factor: setadOn ? `× ${pct(inp.setadCost)}` : 'معاف', value: setad, off: !setadOn });
    const last = setad * pct(P.lastCarRent);
    steps.push({ label: 'تأثیر کرایه آخر', factor: `× ${pct(P.lastCarRent)}`, value: last });
    const cutOn = !inp.buyWarning && (inp.sendTag || 0) > 1;
    const cut = cutOn ? last / pct(P.reserveCut) : last;
    steps.push({ label: 'تأثیر کاهش انبار ذخیره', factor: cutOn ? `÷ ${pct(P.reserveCut)}` : 'اعمال نمی‌شود', value: cut, off: !cutOn });
    const final = trunc(cut);
    steps.push({ label: 'قیمت نهایی پیشنهادی انبار ذخیره', value: final, main: true });
    return { steps, flags: { firstCar: fc, mandegari: mandOn, setad: setadOn, cut: cutOn }, out: { first, mand, setad, last, cut, final } };
  };
  E.reserve.checks = [
    ['r_first', 'first', 'تأثیر کرایه اولیه', 2],
    ['r_mand', 'mand', 'تأثیر هزینه ماندگاری', 2],
    ['r_setad', 'setad', 'تأثیر هزینه ستاد', 2],
    ['r_last', 'last', 'تأثیر کرایه آخر', 2],
    ['r_cut', 'cut', 'تأثیر کاهش ۲۵٪', 2],
    ['r_final', 'final', 'قیمت نهایی انبار ذخیره'],
  ];
  E.reserve.currentVsNew = () => [];

  // ---------- کنترل صحت محاسبه در برابر گزارش ----------
  // ضرایبی که گزارش با آن تولید شده و با پیش‌فرض فعلی فرق دارد (برای محاسبه «قبل» و کنترل صحت)
  E.detectReportParams = function (type, objs) {
    const d = E[type] && E[type].detectParams ? E[type].detectParams(objs) : {};
    const out = {};
    for (const [k, v] of Object.entries(d)) if (v !== E.DEFAULT_PARAMS[k]) out[k] = v;
    return out;
  };
  E.verify = function (type, rowObj, res) {
    const list = [];
    for (const [rk, ok, label, tol] of E[type].checks) {
      if (!(rk in rowObj)) continue;
      const rep = toNum(rowObj[rk]);
      const calc = res.out[ok];
      const repBlank = rep == null;
      const calcBlank = calc == null;
      let match;
      if (repBlank || calcBlank) match = repBlank && (calcBlank || calc === 0 || ok === 'realSood');
      else match = Math.abs(rep - calc) <= (tol || 0) + 1e-9 || (tol == null && Math.abs(rep - calc) <= 1e-9);
      list.push({ key: rk, label, report: rep, calc, match });
    }
    return list;
  };

  // --- برچسب نوع گزارش ---
  E.typeTitle = (t) => (E.TYPES[t] ? E.TYPES[t].title : t);

  if (typeof module !== 'undefined' && module.exports) module.exports = E;
  else root.PricingEngine = E;
})(typeof window !== 'undefined' ? window : globalThis);
