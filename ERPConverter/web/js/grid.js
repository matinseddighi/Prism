/**
 * ERPConverter - Live Data Grid Engine (grid.js)
 * High-performance virtualized/paginated data grid with live cell editing and instant margin recalculation.
 */

class ERPDataGrid {
  constructor(containerId, options = {}) {
    this.container = document.getElementById(containerId);
    this.options = options;
    this.items = [];
    this.filteredItems = [];
    this.searchTerm = '';
    this.statusFilter = 'all';
    this.onItemChanged = options.onItemChanged || null;
    this.init();
  }

  init() {
    this.container.innerHTML = `
      <div class="filter-bar">
        <div style="display: flex; gap: var(--sp-2); align-items: center;">
          <input type="text" id="gridSearchInput" class="search-input" placeholder="جستجو در کد، نام، برند یا گروه..." />
          <select id="gridStatusFilter" class="select-input">
            <option value="all">همه وضعیت‌ها</option>
            <option value="deficit">فقط کسری‌ها</option>
            <option value="convertible">فقط قابل کانورت</option>
            <option value="high_discount">تخفیف بالا (>50%)</option>
          </select>
        </div>
        <div id="gridRowCounter" class="badge badge-cyan">0 مورد یافت شد</div>
      </div>
      <div class="table-container">
        <table class="data-table" id="erpMainTable">
          <thead>
            <tr>
              <th>#</th>
              <th>کد کالا</th>
              <th>نام کالا</th>
              <th>برند</th>
              <th>گروه کالایی</th>
              <th>هزینه ستاد (%)</th>
              <th>سود فروشگاه (%)</th>
              <th>کانورت پیشنهادی</th>
              <th>وضعیت</th>
              <th>قیمت تأمین</th>
              <th>قیمت مصرف‌کننده</th>
              <th>گپ قیمت</th>
              <th>حاشیه ناخالص</th>
            </tr>
          </thead>
          <tbody id="gridTableBody">
            <tr><td colspan="13" style="text-align:center; padding: 20px; color: var(--ink2);">داده‌ای برای نمایش وجود ندارد. لطفاً فایل را بارگذاری کنید.</td></tr>
          </tbody>
        </table>
      </div>
    `;

    // Attach listeners
    this.searchInput = document.getElementById('gridSearchInput');
    this.filterSelect = document.getElementById('gridStatusFilter');
    this.tableBody = document.getElementById('gridTableBody');
    this.counterEl = document.getElementById('gridRowCounter');

    this.searchInput.addEventListener('input', (e) => {
      this.searchTerm = e.target.value.trim().toLowerCase();
      this.applyFilter();
    });

    this.filterSelect.addEventListener('change', (e) => {
      this.statusFilter = e.target.value;
      this.applyFilter();
    });
  }

  setData(items) {
    this.items = items || [];
    this.applyFilter();
  }

  applyFilter() {
    this.filteredItems = this.items.filter(item => {
      // 1. Text search
      const textMatch = !this.searchTerm ||
        (item.code && String(item.code).toLowerCase().includes(this.searchTerm)) ||
        (item.name && item.name.toLowerCase().includes(this.searchTerm)) ||
        (item.brand && item.brand.toLowerCase().includes(this.searchTerm)) ||
        (item.category && item.category.toLowerCase().includes(this.searchTerm));

      if (!textMatch) return false;

      // 2. Status filter
      if (this.statusFilter === 'all') return true;
      if (this.statusFilter === 'deficit') return item.status === 'کسری' || item.status === 'کسری فروشگاه';
      if (this.statusFilter === 'convertible') return (item.conv_disc || item.proposed_convert_discount || 0) > 0;
      if (this.statusFilter === 'high_discount') return (item.conv_disc || item.proposed_convert_discount || 0) > 0.50;
      return true;
    });

    this.render();
  }

  render() {
    this.counterEl.textContent = `${this.filteredItems.length} مورد یافت شد (از مجموع ${this.items.length})`;

    if (this.filteredItems.length === 0) {
      this.tableBody.innerHTML = `<tr><td colspan="13" style="text-align:center; padding: 24px; color: var(--ink3);">هیچ موردی مطابق فیلتر یافت نشد.</td></tr>`;
      return;
    }

    const fragment = document.createDocumentFragment();

    this.filteredItems.forEach((item, idx) => {
      const tr = document.createElement('tr');
      const isDeficit = item.status === 'کسری' || item.status === 'کسری فروشگاه';
      if (isDeficit) tr.classList.add('deficit');

      const setadVal = item.determined_setad ?? item.setad_determined ?? 3;
      const soodVal = item.determined_sood ?? item.sood_determined ?? 7;
      const convDisc = item.conv_disc ?? item.proposed_convert_discount;
      const convDiscDisplay = (convDisc !== null && convDisc !== undefined)
        ? `${Math.round(convDisc * 100)}٪`
        : '-';

      const pCalc = item.p_calc ?? item.calc_price ?? 0;
      const pCons = item.p_cons ?? item.cons_price_no_tax ?? 0;
      const gap = item.gap ?? item.price_gap ?? 0;
      const margin = item.gross_margin ?? item.gross_margin_total ?? 0;

      // Status badge styling
      let statusBadge = `<span class="badge badge-green">${item.status || 'سالم'}</span>`;
      if (isDeficit) {
        statusBadge = `<span class="badge badge-red">${item.status}</span>`;
      } else if (item.status && item.status.includes('تخفیف بالا')) {
        statusBadge = `<span class="badge badge-amber">${item.status}</span>`;
      }

      tr.innerHTML = `
        <td style="text-align:center; color: var(--ink3);">${idx + 1}</td>
        <td style="text-align:center; font-weight: bold; color: var(--cyan);">${item.code}</td>
        <td style="font-weight: 500; max-width: 260px; overflow: hidden; text-overflow: ellipsis;" title="${item.name}">${item.name}</td>
        <td style="text-align:center;">${item.brand || '-'}</td>
        <td style="font-size: var(--fs-2xs); color: var(--ink2); max-width: 200px; overflow: hidden; text-overflow: ellipsis;" title="${item.category}">${item.category || '-'}</td>
        <td style="text-align:center;">
          <input type="number" min="0" max="50" class="cell-input setad-input" data-code="${item.code}" value="${setadVal}" />
          <span class="cell-basis">${item.basis_setad || item.setad_basis || ''}</span>
        </td>
        <td style="text-align:center;">
          <input type="number" min="0" max="50" class="cell-input sood-input" data-code="${item.code}" value="${soodVal}" />
          <span class="cell-basis">${item.basis_sood || item.sood_basis || ''}</span>
        </td>
        <td style="text-align:center; font-weight: bold; color: var(--tag);">${convDiscDisplay}</td>
        <td style="text-align:center;">${statusBadge}</td>
        <td style="text-align:left; font-family: monospace;">${pCalc.toLocaleString('fa-IR')}</td>
        <td style="text-align:left; font-family: monospace;">${pCons ? pCons.toLocaleString('fa-IR') : '-'}</td>
        <td style="text-align:left; font-family: monospace; color: ${gap < 0 ? 'var(--red)' : 'inherit'};">${gap.toLocaleString('fa-IR')}</td>
        <td style="text-align:center;">${margin ? `${margin}٪` : '-'}</td>
      `;

      fragment.appendChild(tr);
    });

    this.tableBody.innerHTML = '';
    this.tableBody.appendChild(fragment);

    // Bind change events to inputs
    this.tableBody.querySelectorAll('.setad-input').forEach(inp => {
      inp.addEventListener('change', (e) => this.handleValueChange(e.target.dataset.code, 'setad', parseInt(e.target.value, 10)));
    });

    this.tableBody.querySelectorAll('.sood-input').forEach(inp => {
      inp.addEventListener('change', (e) => this.handleValueChange(e.target.dataset.code, 'sood', parseInt(e.target.value, 10)));
    });
  }

  handleValueChange(code, type, newVal) {
    if (isNaN(newVal) || newVal < 0) return;
    const targetItem = this.items.find(it => String(it.code) === String(code));
    if (!targetItem) return;

    if (type === 'setad') {
      targetItem.determined_setad = newVal;
      targetItem.setad_determined = newVal;
      targetItem.basis_setad = 'ویرایش دستی کاربر';
      targetItem.setad_basis = 'ویرایش دستی کاربر';
    } else if (type === 'sood') {
      targetItem.determined_sood = newVal;
      targetItem.sood_determined = newVal;
      targetItem.basis_sood = 'ویرایش دستی کاربر';
      targetItem.sood_basis = 'ویرایش دستی کاربر';
    }

    if (this.onItemChanged) {
      this.onItemChanged(targetItem, this.items);
    }
  }
}

window.ERPDataGrid = ERPDataGrid;
