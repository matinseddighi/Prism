# بررسی سریع گزارش درصد تخفیف از نگاه دقت قیمت و رقابت‌پذیری
import openpyxl, statistics as st, sys, io, collections
sys.stdout = io.open(sys.stdout.fileno(), "w", encoding="utf-8", closefd=False)
f = r"C:\Users\sedighi.m\Downloads\درصد تخفیف پیشنهادی برای نرم افزار (1).xlsx"
ws = openpyxl.load_workbook(f, read_only=True).worksheets[0]
rows = list(ws.iter_rows(values_only=True))
H = {h: i for i, h in enumerate(rows[0])}
def col(name): return next(i for h, i in H.items() if h and name in h)
c = dict(code=col("کد کالا"), qty=col("موجودی کل"), base=col("قیمت لحاظ شده"), uNo=col("قیمت مصرف کننده بدون مالیات"),
         uV=col("قیمت مصرف کننده با مالیات"), disc=col("قبل از تأثیر"), after=col("بعد از تأثیر"), conv=col("کانورت"),
         cur=col("درصد تخفیف گروهی فعلی"), saleV=col("قیمت فروش پیشنهادی با مالیات"), grp=col("گروه کالایی"), sood=col("سود درنظر"))
num = lambda v: v if isinstance(v, (int, float)) else None
R = [r for r in rows[1:] if r[c["code"]]]
active = [r for r in R if num(r[c["uV"]]) and num(r[c["base"]])]
print("کل:", len(R), "دارای قیمت خرید و مصرف‌کننده:", len(active), "دارای موجودی:", sum(1 for r in active if (num(r[c["qty"]]) or 0) > 0))

# ۱) گرد بودن قیمت شلف (با مالیات) — مضرب ۱۰٬۰۰۰ ریال (۱۰۰۰ تومان) و ۵۰٬۰۰۰
sv = [num(r[c["saleV"]]) for r in active if num(r[c["saleV"]])]
for m in (1000, 10000, 50000):
    print(f"قیمت شلف مضرب {m:,} ریال: {sum(1 for v in sv if v % m == 0)}/{len(sv)}")

# ۲) فاصله تخفیف فعلی تا سقف مجاز (بعد از ماندگاری)
gaps = []
over = under = equal = 0
for r in active:
    cur, aft = num(r[c["cur"]]) or 0, num(r[c["after"]])
    if aft is None: continue
    g = aft - cur; gaps.append(g)
    if g < 0: over += 1
    elif g > 0: under += 1
    else: equal += 1
print("تخفیف فعلی > سقف مجاز (سود زیر حد):", over, "| تخفیف فعلی < سقف (فضای رقابت):", under, "| برابر:", equal)
print("میانه فاصله:", st.median(gaps), "| فاصله ≥ ۵ واحد:", sum(1 for g in gaps if g >= 5), "| فاصله ≤ −۵:", sum(1 for g in gaps if g <= -5))

# ۳) پراکندگی تخفیف داخل زیرگروه (ناهمگونی)
by = collections.defaultdict(list)
for r in active:
    by[str(r[c["grp"]])].append(num(r[c["cur"]]) or 0)
spread = [(max(v) - min(v), k, len(v)) for k, v in by.items() if len(v) >= 5]
spread.sort(reverse=True)
print("زیرگروه‌ها با ≥۵ کالا:", len(spread), "| اختلاف بیشینه‌وکمینه تخفیف ≥ ۲۰ واحد:", sum(1 for s in spread if s[0] >= 20))
for s in spread[:5]: print("  ", s)

# ۴) توزیع درصد تخفیف فعلی
dist = collections.Counter(int(num(r[c["cur"]]) or 0) for r in active)
print("پرتکرارترین تخفیف‌ها:", dist.most_common(12))
print("تخفیف‌های غیر مضرب ۵:", sum(v for k, v in dist.items() if k % 5), "از", len(active))
