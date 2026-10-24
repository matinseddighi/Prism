/**
 * ERPConverter - Main Application Controller (app.js)
 * Manages file loading, API communication, KPI updates, tab switches, and clipboard actions.
 */

document.addEventListener('DOMContentLoaded', () => {
  let activeGrid = null;
  let currentItems = [];
  let recalculateTimer = null;

  // UI Elements
  const statusEl = document.getElementById('sourceStatusText');
  const loadLatestBtn = document.getElementById('loadLatestBtn');
  const exportAllBtn = document.getElementById('exportAllBtn');
  const copySetadBtn = document.getElementById('copySetadBtn');
  const copySoodBtn = document.getElementById('copySoodBtn');
  const openFolderBtn = document.getElementById('openFolderBtn');
  const themeToggleBtn = document.getElementById('themeToggleBtn');
  const toastContainer = document.getElementById('toastContainer');

  // KPI elements
  const kpiTotal = document.getElementById('kpiTotal');
  const kpiMissing = document.getElementById('kpiMissing');
  const kpiConvertible = document.getElementById('kpiConvertible');
  const kpiDeficits = document.getElementById('kpiDeficits');
  const kpiNewGoods = document.getElementById('kpiNewGoods');
  const kpiRequested = document.getElementById('kpiRequested');

  // Initialize Grid
  activeGrid = new ERPDataGrid('gridContainer', {
    onItemChanged: (item, allItems) => {
      currentItems = allItems;
      triggerRecalculate();
    }
  });

  // Theme Management
  const savedTheme = localStorage.getItem('erp_theme') || 'dark';
  document.documentElement.setAttribute('data-theme', savedTheme);
  themeToggleBtn.addEventListener('click', () => {
    const cur = document.documentElement.getAttribute('data-theme');
    const next = cur === 'dark' ? 'light' : 'dark';
    document.documentElement.setAttribute('data-theme', next);
    localStorage.setItem('erp_theme', next);
    showToast(`پوسته به ${next === 'dark' ? 'تیره' : 'روشن'} تغییر یافت.`, 'info');
  });

  // Toast Helper
  function showToast(msg, type = 'success') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = msg;
    toastContainer.appendChild(toast);
    setTimeout(() => {
      toast.style.opacity = '0';
      toast.style.transform = 'translateY(10px)';
      toast.style.transition = 'all 0.2s';
      setTimeout(() => toast.remove(), 250);
    }, 4000);
  }

  // Check Status on Load
  async function checkServerStatus() {
    try {
      const resp = await fetch('/api/status');
      const data = await resp.json();
      if (data.latest_discount_name) {
        statusEl.innerHTML = `آخرین فایل کشف‌شده در Downloads: <span class="source-highlight">${data.latest_discount_name}</span> (${data.date_detected || 'تاریخ نامشخص'})`;
      } else {
        statusEl.textContent = 'هیچ فایل پیشنهاد درصد تخفیف در پوشه Downloads یافت نشد.';
      }
    } catch (e) {
      statusEl.textContent = 'خطا در برقراری ارتباط با وب‌سرور محلی.';
    }
  }

  // Load File (Latest or Specified)
  async function loadFile(filepath = null) {
    loadLatestBtn.disabled = true;
    loadLatestBtn.textContent = 'در حال پردازش گزارش...';
    try {
      const resp = await fetch('/api/load-file', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath: filepath })
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        showToast(data.error || 'خطا در بارگذاری فایل', 'error');
        return;
      }

      currentItems = data.missing_items || [];
      activeGrid.setData(currentItems);

      // Update KPI
      kpiTotal.textContent = (data.total_rows || 0).toLocaleString('fa-IR');
      kpiMissing.textContent = (data.missing_count || 0).toLocaleString('fa-IR');
      kpiConvertible.textContent = (data.convertible_count || 0).toLocaleString('fa-IR');
      kpiDeficits.textContent = (data.deficits_count || 0).toLocaleString('fa-IR');
      kpiNewGoods.textContent = (data.new_goods_count || 0).toLocaleString('fa-IR');
      kpiRequested.textContent = (data.requested_total || 0).toLocaleString('fa-IR');

      // Populate other tabs
      renderRequestedTab(data.requested_summary || []);
      renderNewGoodsTab(data.new_goods || []);
      renderSoodSetadTab(data.sood_setad_items || []);

      statusEl.innerHTML = `فایل بارگذاری‌شده: <span class="source-highlight">${data.filename}</span> — تاریخ گزارش: <span class="badge badge-cyan">${data.date_str}</span>`;
      showToast(`گزارش ${data.filename} با موفقیت بارگذاری شد (${data.missing_count} قلم نیازمند مقدار).`);
    } catch (e) {
      showToast('خطا در پردازش فایل: ' + e.message, 'error');
    } finally {
      loadLatestBtn.disabled = false;
      loadLatestBtn.textContent = '⚡ بارگذاری آخرین فایل امروز';
    }
  }

  // Trigger Debounced Recalculation
  function triggerRecalculate() {
    clearTimeout(recalculateTimer);
    recalculateTimer = setTimeout(async () => {
      try {
        const resp = await fetch('/api/recalculate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ items: currentItems })
        });
        const data = await resp.json();
        if (data.success && data.items) {
          currentItems = data.items;
          activeGrid.setData(currentItems);

          // Update deficits and convertible count
          const defs = currentItems.filter(it => it.status === 'کسری' || it.status === 'کسری فروشگاه').length;
          const convs = currentItems.filter(it => (it.conv_disc || it.proposed_convert_discount || 0) > 0).length;
          kpiDeficits.textContent = defs.toLocaleString('fa-IR');
          kpiConvertible.textContent = convs.toLocaleString('fa-IR');
          showToast('محاسبات حاشیه و تخفیف با مقادیر جدید به‌روزرسانی شد.', 'info');
        }
      } catch (e) {
        console.error('Recalculate error:', e);
      }
    }, 400);
  }

  // Export All Converts
  async function exportAllConverts() {
    exportAllBtn.disabled = true;
    exportAllBtn.textContent = 'در حال تولید فایل‌های کانورت...';
    try {
      const resp = await fetch('/api/generate-converts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await resp.json();
      if (!resp.ok || data.error) {
        showToast(data.error || 'خطا در خروجی فایل‌های کانورت', 'error');
        return;
      }

      const filesCount = (data.generated_files || []).length;
      showToast(`تعداد ${filesCount} فایل کانورت و تحلیلی با موفقیت تولید و در پوشه روز ذخیره شد!`, 'success');
    } catch (e) {
      showToast('خطا در ارتباط با سرور: ' + e.message, 'error');
    } finally {
      exportAllBtn.disabled = false;
      exportAllBtn.textContent = '💾 تولید و ذخیره تمام فایل‌های کانورت';
    }
  }

  // Copy Clipboard TSV
  async function copyTsv(mode) {
    try {
      const resp = await fetch(`/api/clipboard-tsv?mode=${mode}`);
      const data = await resp.json();
      if (!data.tsv) {
        showToast('داده‌ای برای کپی وجود ندارد', 'error');
        return;
      }
      await navigator.clipboard.writeText(data.tsv);
      const title = mode === 'setad' ? 'هزینه ستاد (۹۴۶)' : (mode === 'sood' ? 'سود فروشگاه (۹۴۰)' : 'سود ستاد (۸۰۰)');
      showToast(`داده‌های ${title} به تعداد ${data.count} سطر در کلیپ‌بورد کپی شد. آماده الصاق در ERP.`, 'success');
    } catch (e) {
      showToast('خطا در کپی کلیپ‌بورد: ' + e.message, 'error');
    }
  }

  // Open Today's Folder
  async function openFolder() {
    try {
      const resp = await fetch('/api/open-folder', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({})
      });
      const data = await resp.json();
      if (!resp.ok) {
        showToast(data.error || 'پوشه پیدا نشد', 'error');
      } else {
        showToast(`پوشه ${data.opened} باز شد.`, 'info');
      }
    } catch (e) {
      showToast('خطا در باز کردن پوشه: ' + e.message, 'error');
    }
  }

  // Render Tabs
  function renderRequestedTab(summaryList) {
    const container = document.getElementById('requestedTabBody');
    if (!summaryList || summaryList.length === 0) {
      container.innerHTML = `<tr><td colspan="7" style="text-align:center; padding: 20px;">اطلاعاتی یافت نشد.</td></tr>`;
      return;
    }
    container.innerHTML = summaryList.map((s, idx) => `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td style="font-weight: bold; color: var(--cyan);">${s.category}</td>
        <td style="text-align:center; font-weight: bold;">${s.count.toLocaleString('fa-IR')}</td>
        <td style="font-size: var(--fs-xs); color: var(--ink2);">${s.sample_items || '-'}</td>
        <td style="text-align:center;">${s.discount_range || '-'}</td>
        <td style="text-align:center;">${s.sood_range || '-'}</td>
        <td style="text-align:center;">${s.setad_range || '-'}</td>
      </tr>
    `).join('');
  }

  function renderNewGoodsTab(newGoods) {
    const container = document.getElementById('newGoodsTabBody');
    if (!newGoods || newGoods.length === 0) {
      container.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px;">کالای جدیدی نسبت به فایل مرجع قبل اضافه نشده است.</td></tr>`;
      return;
    }
    container.innerHTML = newGoods.map((it, idx) => `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td style="text-align:center; font-weight: bold; color: var(--cyan);">${it.code}</td>
        <td>${it.name}</td>
        <td>${it.brand || '-'}</td>
        <td style="font-size: var(--fs-xs); color: var(--ink2);">${it.category || '-'}</td>
        <td style="text-align:center;">${it.opening_date || '-'}</td>
      </tr>
    `).join('');
  }

  function renderSoodSetadTab(items) {
    const container = document.getElementById('soodSetadTabBody');
    if (!items || items.length === 0) {
      container.innerHTML = `<tr><td colspan="6" style="text-align:center; padding: 20px;">فایل عامل (سود ستاد) بررسی نشده یا اقلام فاقدی در آن وجود ندارد.</td></tr>`;
      return;
    }
    container.innerHTML = items.map((it, idx) => `
      <tr>
        <td style="text-align:center;">${idx + 1}</td>
        <td style="text-align:center; font-weight: bold; color: var(--cyan);">${it.code}</td>
        <td>${it.name}</td>
        <td>${it.brand || '-'}</td>
        <td>${it.category || '-'}</td>
        <td style="text-align:center; font-weight: bold; color: var(--tag);">${it.determined_sood_setad}٪ (${it.basis})</td>
      </tr>
    `).join('');
  }

  // Tab switching logic
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
      document.querySelectorAll('.tab-pane').forEach(p => p.style.display = 'none');

      btn.classList.add('active');
      const targetId = btn.dataset.tab;
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.style.display = 'block';
    });
  });

  // Attach button events
  loadLatestBtn.addEventListener('click', () => loadFile(null));
  exportAllBtn.addEventListener('click', exportAllConverts);
  copySetadBtn.addEventListener('click', () => copyTsv('setad'));
  copySoodBtn.addEventListener('click', () => copyTsv('sood'));
  openFolderBtn.addEventListener('click', openFolder);

  // Initialize status
  checkServerStatus();
});
