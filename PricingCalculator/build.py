# ساخت فایل نهایی تک‌فایلی (آفلاین) از سورس‌ها
import os
here = os.path.dirname(os.path.abspath(__file__))
src = os.path.join(here, "src")
read = lambda n: open(os.path.join(src, n), encoding="utf-8").read()
import base64
html = read("index.html")
html = html.replace("/*__FONT__*/", base64.b64encode(open(os.path.join(src, "fonts", "Vazirmatn.woff2"), "rb").read()).decode())
for tag, name in [("/*__CSS__*/", "style.css"), ("/*__ENGINE__*/", "engine.js"), ("/*__ANALYSIS__*/", "analysis.js"), ("/*__PL__*/", "pl.js"), ("/*__POLICY__*/", "policy.js"), ("/*__XLSX__*/", "xlsx.js"), ("/*__APP__*/", "app.js")]:
    html = html.replace(tag, read(name).replace("</script>", "<\\/script>"))
out = os.path.join(here, "ماشین حساب قیمت گذاری.html")
open(out, "w", encoding="utf-8").write(html)
print("built", len(html), "chars")
