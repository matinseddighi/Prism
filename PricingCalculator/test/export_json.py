import openpyxl, json, os, sys
base = r"C:\Users\sedighi.m\Downloads\\"
files = {
    "store": "درصد تخفیف پیشنهادی برای نرم افزار (1).xlsx",
    "central": "قیمت گذاری انبار مرکزی برای نرم افزار.xlsx",
    "agent": "قیمت گذاری عامل بنکدار مغازه دار برای نرم افزار.xlsx",
}
out = os.path.dirname(os.path.abspath(__file__))
for k, f in files.items():
    wb = openpyxl.load_workbook(base + f, read_only=True)
    ws = wb.worksheets[0]
    rows = [list(r) for r in ws.iter_rows(values_only=True)]
    headers = rows[0]
    data = [r for r in rows[1:] if any(v not in (None, "") for v in r)]
    json.dump({"headers": headers, "rows": data}, open(os.path.join(out, k + ".json"), "w", encoding="utf-8"), ensure_ascii=False)
    print(k, len(data))
