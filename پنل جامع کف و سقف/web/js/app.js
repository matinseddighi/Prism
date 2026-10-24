/**
 * ShelfMaster - Modern Frontend SPA Application Engine
 * High-performance, Persian RTL Single Page Application for ERP shelf limit management,
 * AI assistant, audit monitoring, diff tracking, and quick scenario presets.
 */

(function () {
    'use strict';

    // ─────────────────────────────────────────────────────────────────────────────
    // APPLICATION STATE
    // ─────────────────────────────────────────────────────────────────────────────
    const state = {
        currentTab: 'tab-convert',
        theme: localStorage.getItem('shelfmaster_theme') || 'dark',
        status: null,
        stores: [],
        currentStore: '',
        
        // Tab 1: Convert
        storeItems: [],
        filteredItems: [],
        editedItems: new Map(), // code -> { min, max }
        currentPage: 1,
        pageSize: 50,
        searchQuery: '',

        // Tab 2: AI Assistant
        aiImageBase64: null,
        aiItems: [],

        // Tab 3: Audit
        auditData: null,
        selectedAuditCategory: 'ALL',
        selectedAuditStore: 'ALL',

        // Tab 4: Diff
        diffData: null,
        selectedDiffStore: 'ALL',

        // Tab 5: Presets
        presets: {},
        selectedPreset: null,
        presetItems: [],
    };

    // ─────────────────────────────────────────────────────────────────────────────
    // DOM REFERENCES CACHE
    // ─────────────────────────────────────────────────────────────────────────────
    const dom = {
        // Global / Header
        themeBtn: document.getElementById('btnTheme'),
        openFolderBtn: document.getElementById('btnOpenFolder'),
        refreshBtn: document.getElementById('btnRefresh'),
        clockDisplay: document.getElementById('clockDisplay'),
        activeFileName: document.getElementById('activeFileName'),
        activeFileBadge: document.getElementById('activeFileBadge'),
        navTabs: document.getElementById('navTabs'),
        tabPanes: document.querySelectorAll('.tab-pane'),
        toastContainer: document.getElementById('toastContainer'),
        loadingOverlay: document.getElementById('loadingOverlay'),
        loadingText: document.getElementById('loadingText'),

        // Tab Badges
        badgeConvertCount: document.getElementById('badgeConvertCount'),
        badgeAuditCount: document.getElementById('badgeAuditCount'),

        // Tab 1: Convert
        storeSelect: document.getElementById('storeSelect'),
        searchConvert: document.getElementById('searchConvert'),
        convertVisibleCount: document.getElementById('convertVisibleCount'),
        convertTotalCount: document.getElementById('convertTotalCount'),
        convertTable: document.getElementById('convertTable'),
        convertTableBody: document.getElementById('convertTableBody'),
        btnExportStore: document.getElementById('btnExportStore'),
        btnCopyERP: document.getElementById('btnCopyERP'),
        btnExportAll: document.getElementById('btnExportAll'),
        btnUploadCustomExcel: document.getElementById('btnUploadCustomExcel'),
        customExcelInput: document.getElementById('customExcelInput'),
        customExcelBanner: document.getElementById('customExcelBanner'),
        customExcelTitle: document.getElementById('customExcelTitle'),
        customExcelStats: document.getElementById('customExcelStats'),
        btnCopyCustomERP: document.getElementById('btnCopyCustomERP'),
        btnOpenCustomFolder: document.getElementById('btnOpenCustomFolder'),
        btnCloseCustomBanner: document.getElementById('btnCloseCustomBanner'),
        btnFirstPage: document.getElementById('btnFirstPage'),
        btnPrevPage: document.getElementById('btnPrevPage'),
        btnNextPage: document.getElementById('btnNextPage'),
        btnLastPage: document.getElementById('btnLastPage'),
        convertPageInfo: document.getElementById('convertPageInfo'),
        pageSizeSelect: document.getElementById('pageSizeSelect'),

        // Tab 2: AI
        dropZone: document.getElementById('dropZone'),
        aiFileInput: document.getElementById('aiFileInput'),
        imagePreviewContainer: document.getElementById('imagePreviewContainer'),
        imagePreview: document.getElementById('imagePreview'),
        btnRemoveImage: document.getElementById('btnRemoveImage'),
        promptInput: document.getElementById('promptInput'),
        aiStoreSelect: document.getElementById('aiStoreSelect'),
        btnRunAI: document.getElementById('btnRunAI'),
        aiResultsToolbar: document.getElementById('aiResultsToolbar'),
        aiResultCount: document.getElementById('aiResultCount'),
        aiTableContainer: document.getElementById('aiTableContainer'),
        aiTable: document.getElementById('aiTable'),
        aiTableBody: document.getElementById('aiTableBody'),
        btnExportAI: document.getElementById('btnExportAI'),
        btnCopyAI: document.getElementById('btnCopyAI'),

        // Tab 3: Audit
        cardPishOverMax: document.getElementById('cardPishOverMax'),
        cardRoundOverMax: document.getElementById('cardRoundOverMax'),
        cardMinGeMax: document.getElementById('cardMinGeMax'),
        cardSopViolations: document.getElementById('cardSopViolations'),
        countPishOverMax: document.getElementById('countPishOverMax'),
        countRoundOverMax: document.getElementById('countRoundOverMax'),
        countMinGeMax: document.getElementById('countMinGeMax'),
        countSopViolations: document.getElementById('countSopViolations'),
        auditStoreSelect: document.getElementById('auditStoreSelect'),
        auditCategorySelect: document.getElementById('auditCategorySelect'),
        auditTotalFiltered: document.getElementById('auditTotalFiltered'),
        btnAutoFixAll: document.getElementById('btnAutoFixAll'),
        auditTableBody: document.getElementById('auditTableBody'),

        // Tab 4: Diff
        diffCountChanges: document.getElementById('diffCountChanges'),
        diffCountAdded: document.getElementById('diffCountAdded'),
        diffCountRemoved: document.getElementById('diffCountRemoved'),
        diffTableBody: document.getElementById('diffTableBody'),
        diffStoreSelect: document.getElementById('diffStoreSelect'),
        telegramBox: document.getElementById('telegramBox'),
        btnCopyTelegram: document.getElementById('btnCopyTelegram'),
        btnRefreshDiff: document.getElementById('btnRefreshDiff'),

        // Tab 5: Presets
        presetsCardsContainer: document.getElementById('presetsCardsContainer'),
        presetStoreSelect: document.getElementById('presetStoreSelect'),
        btnApplySelectedPreset: document.getElementById('btnApplySelectedPreset'),
        searchPresetGoods: document.getElementById('searchPresetGoods'),
        presetTableBody: document.getElementById('presetTableBody'),
        btnExportPreset: document.getElementById('btnExportPreset'),
        btnCopyPreset: document.getElementById('btnCopyPreset'),
    };

    // ─────────────────────────────────────────────────────────────────────────────
    // UTILITY & HELPER FUNCTIONS
    // ─────────────────────────────────────────────────────────────────────────────

    function showLoading(text = 'در حال پردازش عملیات...') {
        if (dom.loadingText) dom.loadingText.textContent = text;
        if (dom.loadingOverlay) dom.loadingOverlay.classList.add('active');
    }

    function hideLoading() {
        if (dom.loadingOverlay) dom.loadingOverlay.classList.remove('active');
    }

    function showToast(message, type = 'info', duration = 4000) {
        if (!dom.toastContainer) return;

        const toast = document.createElement('div');
        toast.className = `toast toast-${type}`;

        const icons = {
            success: '✅',
            error: '❌',
            warning: '⚠️',
            info: 'ℹ️'
        };

        toast.innerHTML = `
            <span class="toast-icon">${icons[type] || 'ℹ️'}</span>
            <div class="toast-message">${escapeHtml(message)}</div>
        `;

        dom.toastContainer.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(10px)';
            setTimeout(() => toast.remove(), 250);
        }, duration);
    }

    function escapeHtml(str) {
        if (str === null || str === undefined) return '';
        return String(str)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#039;');
    }

    function formatNumber(num) {
        if (num === null || num === undefined || isNaN(num)) return '۰';
        const rounded = Math.round(Number(num) * 100) / 100;
        return rounded.toLocaleString('fa-IR');
    }

    function copyToClipboard(text) {
        if (!text) {
            showToast('محتوایی برای کپی وجود ندارد', 'warning');
            return Promise.reject('Empty text');
        }

        if (navigator.clipboard && window.isSecureContext) {
            return navigator.clipboard.writeText(text)
                .then(() => true)
                .catch(() => fallbackCopy(text));
        } else {
            return Promise.resolve(fallbackCopy(text));
        }
    }

    function fallbackCopy(text) {
        const textarea = document.createElement('textarea');
        textarea.value = text;
        textarea.style.position = 'fixed';
        textarea.style.left = '-9999px';
        textarea.style.top = '0';
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        try {
            const success = document.execCommand('copy');
            document.body.removeChild(textarea);
            return success;
        } catch (err) {
            document.body.removeChild(textarea);
            return false;
        }
    }

    function updateClock() {
        const now = new Date();
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        if (dom.clockDisplay) {
            dom.clockDisplay.textContent = `${hours}:${minutes}:${seconds}`;
        }
    }

    function applyTheme(theme) {
        state.theme = theme;
        document.documentElement.setAttribute('data-theme', theme);
        localStorage.setItem('shelfmaster_theme', theme);
        if (dom.themeBtn) {
            dom.themeBtn.textContent = theme === 'dark' ? '☀️' : '🌙';
            dom.themeBtn.title = theme === 'dark' ? 'تغییر به پوسته روشن' : 'تغییر به پوسته تاریک';
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // REST API CLIENT
    // ─────────────────────────────────────────────────────────────────────────────
    const api = {
        async get(endpoint) {
            try {
                const res = await fetch(endpoint, {
                    headers: { 'Accept': 'application/json' },
                    cache: 'no-cache'
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ error: res.statusText }));
                    throw new Error(err.error || `HTTP ${res.status}`);
                }
                return await res.json();
            } catch (err) {
                console.error(`API GET error on ${endpoint}:`, err);
                throw err;
            }
        },

        async post(endpoint, data = {}) {
            try {
                const res = await fetch(endpoint, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json; charset=utf-8',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(data)
                });
                if (!res.ok) {
                    const err = await res.json().catch(() => ({ error: res.statusText }));
                    throw new Error(err.error || `HTTP ${res.status}`);
                }
                return await res.json();
            } catch (err) {
                console.error(`API POST error on ${endpoint}:`, err);
                throw err;
            }
        },

        getStatus(reload = false) {
            return this.get(`/api/status?reload=${reload ? 'true' : 'false'}`);
        },

        getStoreData(store) {
            return this.get(`/api/store-data?store=${encodeURIComponent(store)}`);
        },

        getAudit() {
            return this.get('/api/audit');
        },

        getDiff() {
            return this.get('/api/diff');
        },

        getPresets() {
            return this.get('/api/presets');
        },

        getTelegramSummary(store) {
            return this.get(`/api/telegram-summary?store=${encodeURIComponent(store)}`);
        },

        exportConvert(store, items = []) {
            return this.post('/api/export-convert', { store, items });
        },

        copyErp(store, items = []) {
            return this.post('/api/copy-erp', { store, items });
        },

        autoFixAudit(store = 'ALL') {
            return this.post('/api/audit/fix', { store });
        },

        applyPreset(preset, store = 'ALL') {
            return this.post('/api/presets/apply', { preset, store });
        },

        aiParse(text, imageBase64, store) {
            return this.post('/api/ai/parse', { text, image_base64: imageBase64, store });
        },

        openFolder(path = null) {
            return this.post('/api/open-folder', { path });
        },

        convertCustomExcel(fileBase64 = null, filePath = null, store = null) {
            return this.post('/api/convert-custom-excel', {
                file_base64: fileBase64,
                file_path: filePath,
                store: store
            });
        }
    };

    // ─────────────────────────────────────────────────────────────────────────────
    // TAB NAVIGATION
    // ─────────────────────────────────────────────────────────────────────────────
    function initTabs() {
        if (!dom.navTabs) return;

        const tabButtons = dom.navTabs.querySelectorAll('.tab-btn');
        tabButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const targetTabId = btn.getAttribute('data-tab');
                switchTab(targetTabId);
            });
        });

        // Handle URL hash on page load
        if (window.location.hash) {
            const hashTab = window.location.hash.replace('#', '');
            if (document.getElementById(hashTab)) {
                switchTab(hashTab);
            }
        }
    }

    function switchTab(tabId) {
        state.currentTab = tabId;
        window.location.hash = tabId;

        // Update tab buttons
        const tabButtons = dom.navTabs.querySelectorAll('.tab-btn');
        tabButtons.forEach(btn => {
            if (btn.getAttribute('data-tab') === tabId) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });

        // Update panes
        dom.tabPanes.forEach(pane => {
            if (pane.id === tabId) {
                pane.classList.add('active');
            } else {
                pane.classList.remove('active');
            }
        });

        // Lazy-load data for tab if needed
        if (tabId === 'tab-audit' && !state.auditData) {
            loadAuditData();
        } else if (tabId === 'tab-diff' && !state.diffData) {
            loadDiffData();
        } else if (tabId === 'tab-presets' && Object.keys(state.presets).length === 0) {
            loadPresets();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // GLOBAL APP INIT & STATUS
    // ─────────────────────────────────────────────────────────────────────────────
    async function loadAppStatus(forceReload = false) {
        try {
            showLoading(forceReload ? 'در حال اسکن و بارگذاری فایل جدید...' : 'در حال اتصال به سرور ShelfMaster...');
            const res = await api.getStatus(forceReload);

            if (res.ok) {
                state.status = res;
                state.stores = res.stores || [];

                // Update active file badge
                if (dom.activeFileName) {
                    const dateNote = res.target_date ? ` · تاریخ کانورت ${res.target_date}` : '';
                    dom.activeFileName.textContent = (res.file || 'فایلی یافت نشد') + dateNote;
                }
                if (dom.activeFileBadge) {
                    dom.activeFileBadge.title = res.file_path || 'Downloads و پوشه «گزارش‌ها/پیشنهاد ارسال» بررسی شد';
                }

                // Populate store dropdowns
                populateStoreDropdowns(state.stores);

                // Set default store (prefer فضل or first store)
                let defaultStore = state.stores[0] || '';
                for (const candidate of ['فضل', 'بوژان', '17 شهریور', 'الهیه']) {
                    if (state.stores.includes(candidate)) {
                        defaultStore = candidate;
                        break;
                    }
                }

                if (!state.currentStore && defaultStore) {
                    state.currentStore = defaultStore;
                    if (dom.storeSelect) dom.storeSelect.value = defaultStore;
                }

                // Load initial store records
                if (state.currentStore) {
                    await loadStoreData(state.currentStore);
                }

                // Background-load audit numbers to update header badge
                loadAuditData(true);

                if (forceReload) {
                    showToast(`فایل با موفقیت بروزرسانی شد: ${res.file}`, 'success');
                }
            }
        } catch (err) {
            showToast(`خطا در ارتباط با سرور: ${err.message}`, 'error');
            if (dom.activeFileName) {
                dom.activeFileName.textContent = 'خطا در بارگذاری فایل پیشنهاد ارسال';
            }
        } finally {
            hideLoading();
        }
    }

    function populateStoreDropdowns(stores) {
        const selects = [
            { el: dom.storeSelect, includeAll: false, defaultText: 'انتخاب شعبه...' },
            { el: dom.aiStoreSelect, includeAll: false, defaultText: 'انتخاب شعبه مقصد...' },
            { el: dom.auditStoreSelect, includeAll: true, defaultText: 'همه شعب' },
            { el: dom.diffStoreSelect, includeAll: true, defaultText: 'همه شعب شبکه' },
            { el: dom.presetStoreSelect, includeAll: false, defaultText: 'انتخاب شعبه...' },
        ];

        selects.forEach(({ el, includeAll, defaultText }) => {
            if (!el) return;
            const currentVal = el.value;
            el.innerHTML = '';

            if (includeAll) {
                const allOpt = document.createElement('option');
                allOpt.value = 'ALL';
                allOpt.textContent = defaultText;
                el.appendChild(allOpt);
            } else {
                const emptyOpt = document.createElement('option');
                emptyOpt.value = '';
                emptyOpt.textContent = defaultText;
                el.appendChild(emptyOpt);
            }

            stores.forEach(st => {
                const opt = document.createElement('option');
                opt.value = st;
                opt.textContent = st;
                el.appendChild(opt);
            });

            if (currentVal && stores.includes(currentVal)) {
                el.value = currentVal;
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TAB 1: ERP CONVERT IMPLEMENTATION
    // ─────────────────────────────────────────────────────────────────────────────
    async function loadStoreData(storeName) {
        if (!storeName) {
            state.storeItems = [];
            state.filteredItems = [];
            renderConvertTable();
            return;
        }

        try {
            showLoading(`در حال فراخوانی اقلام قفسه شعبه ${storeName}...`);
            const res = await api.getStoreData(storeName);

            if (res.ok) {
                state.storeItems = res.items || [];
                state.editedItems.clear(); // Reset inline edits on store change
                applyConvertFilter();

                if (dom.badgeConvertCount) {
                    dom.badgeConvertCount.textContent = formatNumber(state.storeItems.length);
                }
            }
        } catch (err) {
            showToast(`خطا در دریافت اطلاعات کالاها: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    function applyConvertFilter() {
        const query = (state.searchQuery || '').trim().toLowerCase();

        if (!query) {
            state.filteredItems = [...state.storeItems];
        } else {
            state.filteredItems = state.storeItems.filter(item => {
                const name = String(item.name || '').toLowerCase();
                const code = String(item.code || '');
                return name.includes(query) || code.includes(query);
            });
        }

        state.currentPage = 1;
        renderConvertTable();
    }

    function renderConvertTable() {
        if (!dom.convertTableBody) return;

        const total = state.storeItems.length;
        const visible = state.filteredItems.length;

        if (dom.convertVisibleCount) dom.convertVisibleCount.textContent = formatNumber(visible);
        if (dom.convertTotalCount) dom.convertTotalCount.textContent = formatNumber(total);

        if (visible === 0) {
            dom.convertTableBody.innerHTML = `
                <tr>
                    <td colspan="12" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                        ${total === 0 ? 'هیچ کالایی برای این شعبه یافت نشد.' : 'کالایی با مشخصات جستجوشده یافت نشد.'}
                    </td>
                </tr>
            `;
            updatePaginationInfo(0);
            return;
        }

        const pageSize = state.pageSize;
        const totalPages = Math.ceil(visible / pageSize) || 1;
        if (state.currentPage > totalPages) state.currentPage = totalPages;

        const startIdx = (state.currentPage - 1) * pageSize;
        const endIdx = Math.min(startIdx + pageSize, visible);
        const pageItems = state.filteredItems.slice(startIdx, endIdx);

        let rowsHtml = '';
        pageItems.forEach(item => {
            const itemCode = item.code;
            const edits = state.editedItems.get(itemCode) || {};
            const displayMin = edits.min !== undefined ? edits.min : (item.min ?? 0);
            const displayMax = edits.max !== undefined ? edits.max : (item.max ?? 0);
            const isMinChanged = edits.min !== undefined && edits.min !== item.min;
            const isMaxChanged = edits.max !== undefined && edits.max !== item.max;

            // Feasibility badge
            const feasibility = item.feasibility || 'green';
            let feasBadge = '';
            if (feasibility === 'green') {
                feasBadge = '<span class="badge badge-feasibility green">تأمین کامل</span>';
            } else if (feasibility === 'yellow') {
                feasBadge = '<span class="badge badge-feasibility yellow">کسری مرکز</span>';
            } else {
                feasBadge = '<span class="badge badge-feasibility red">ناموجود مرکز</span>';
            }

            // Status badge
            const statusStr = String(item.status || 'فعال');
            const isInactive = statusStr.includes('غیر') || statusStr.includes('حذف');
            const statusBadge = isInactive
                ? '<span class="badge badge-status inactive">غیرفعال</span>'
                : '<span class="badge badge-status active">فعال</span>';

            rowsHtml += `
                <tr data-code="${itemCode}">
                    <td class="col-num">${escapeHtml(item.store_code || item.wh_code || '')}</td>
                    <td class="col-num"><b>${escapeHtml(itemCode)}</b></td>
                    <td title="${escapeHtml(item.name || '')}">
                        ${escapeHtml(item.name || 'بدون نام')}
                    </td>
                    <td class="col-num">
                        <input type="number" 
                               class="table-input ${isMinChanged ? 'changed' : ''}" 
                               data-field="min" 
                               data-code="${itemCode}" 
                               value="${displayMin}" 
                               min="0" step="1">
                    </td>
                    <td class="col-num">
                        <input type="number" 
                               class="table-input ${isMaxChanged ? 'changed' : ''}" 
                               data-field="max" 
                               data-code="${itemCode}" 
                               value="${displayMax}" 
                               min="0" step="1">
                    </td>
                    <td class="col-num">${formatNumber(item.prev_min ?? item.old_min ?? item.min)}</td>
                    <td class="col-num">${formatNumber(item.prev_max ?? item.old_max ?? item.max)}</td>
                    <td class="col-num">${formatNumber(item.batch || 1)}</td>
                    <td style="text-align: center;">${statusBadge}</td>
                    <td class="col-num">${formatNumber(item.shelf_qty || 0)}</td>
                    <td class="col-num">${formatNumber(item.free_qty || 0)}</td>
                    <td style="text-align: center;">${feasBadge}</td>
                </tr>
            `;
        });

        dom.convertTableBody.innerHTML = rowsHtml;
        updatePaginationInfo(totalPages);
        attachTableInputListeners();
    }

    function updatePaginationInfo(totalPages) {
        if (!dom.convertPageInfo) return;
        const current = state.currentPage;
        dom.convertPageInfo.textContent = `صفحه ${formatNumber(current)} از ${formatNumber(totalPages || 1)}`;

        if (dom.btnPrevPage) dom.btnPrevPage.disabled = current <= 1;
        if (dom.btnFirstPage) dom.btnFirstPage.disabled = current <= 1;
        if (dom.btnNextPage) dom.btnNextPage.disabled = current >= totalPages;
        if (dom.btnLastPage) dom.btnLastPage.disabled = current >= totalPages;
    }

    function attachTableInputListeners() {
        if (!dom.convertTableBody) return;

        const inputs = dom.convertTableBody.querySelectorAll('.table-input');
        inputs.forEach(input => {
            input.addEventListener('change', (e) => {
                const code = Number(e.target.getAttribute('data-code'));
                const field = e.target.getAttribute('data-field');
                const val = Math.max(0, parseInt(e.target.value, 10) || 0);

                if (!state.editedItems.has(code)) {
                    state.editedItems.set(code, {});
                }
                state.editedItems.get(code)[field] = val;

                // Visual highlight (the original item.min/max stay untouched: they are the «previous» values)
                e.target.classList.add('changed');
            });
        });
    }

    // Items to send to the convert/ERP endpoints: inline edits become new_min/new_max,
    // and the report's own values travel as prev_min/prev_max (Excel «کف قبلی / سقف قبلی»).
    function buildExportItems() {
        return state.storeItems.map(item => {
            const edits = state.editedItems.get(item.code) || {};
            const out = { ...item };
            if (out.prev_min === undefined && out.old_min === undefined) out.prev_min = item.min;
            if (out.prev_max === undefined && out.old_max === undefined) out.prev_max = item.max;
            out.new_min = edits.min !== undefined ? edits.min : (item.new_min ?? item.min);
            out.new_max = edits.max !== undefined ? edits.max : (item.new_max ?? item.max);
            return out;
        });
    }

    // Select a store in the convert tab (adds the option if the dropdown doesn't have it)
    function selectConvertStore(name) {
        if (!name) return;
        state.currentStore = name;
        if (!dom.storeSelect) return;
        if (![...dom.storeSelect.options].some(o => o.value === name)) {
            const opt = document.createElement('option');
            opt.value = name;
            opt.textContent = name;
            dom.storeSelect.appendChild(opt);
        }
        dom.storeSelect.value = name;
    }

    // Export Store Convert File
    async function handleExportStore() {
        if (!state.currentStore) {
            showToast('لطفاً ابتدا یک شعبه را انتخاب نمایید', 'warning');
            return;
        }

        try {
            showLoading(`در حال تولید فایل اکسل کانورت برای شعبه ${state.currentStore}...`);
            const res = await api.exportConvert(state.currentStore, buildExportItems());

            if (res.ok) {
                showToast(`✅ فایل کانورت ${state.currentStore} تولید شد: ${res.filename}`, 'success', 6000);
            }
        } catch (err) {
            showToast(`خطا در تولید فایل کانورت: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    // Copy 5 Standard ERP Columns to Clipboard
    async function handleCopyERP() {
        if (!state.currentStore) {
            showToast('لطفاً ابتدا یک شعبه را انتخاب نمایید', 'warning');
            return;
        }

        try {
            showLoading('در حال تبدیل ۵ ستون استاندارد ERP...');
            const res = await api.copyErp(state.currentStore, buildExportItems());

            if (res.ok && res.tsv) {
                await copyToClipboard(res.tsv);
                showToast(`📋 ۵ ستون استاندارد ERP برای ${formatNumber(res.count)} کالا کپی شد (آماده پیست)`, 'success', 5000);
            } else {
                showToast('خطا در دریافت ساختار کلیپ‌بورد ERP', 'error');
            }
        } catch (err) {
            showToast(`خطا در کپی ERP: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    // Export All Stores Convert Files
    async function handleExportAll() {
        if (!confirm('آیا مایل به تولید فایل‌های کانورت برای تمام شعب شبکه هستید؟')) {
            return;
        }

        try {
            showLoading('در حال تولید فایل‌های کانورت کلیه شعب شبکه...');
            const res = await api.exportConvert('ALL');

            if (res.ok) {
                showToast(`🌐 کانورت کل شعب با موفقیت تولید شد (${formatNumber(res.count)} کالا)`, 'success', 6000);
            }
        } catch (err) {
            showToast(`خطا در تولید کانورت کل: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TAB 2: AI ASSISTANT & OCR/IMAGE HANDLER
    // ─────────────────────────────────────────────────────────────────────────────
    function initAiDropZone() {
        if (!dom.dropZone) return;

        // Click to open file dialog
        dom.dropZone.addEventListener('click', (e) => {
            if (e.target.id === 'btnRemoveImage' || e.target.closest('#btnRemoveImage')) return;
            if (dom.aiFileInput) dom.aiFileInput.click();
        });

        // File input change
        if (dom.aiFileInput) {
            dom.aiFileInput.addEventListener('change', (e) => {
                const file = e.target.files[0];
                if (file) handleIncomingFile(file);
            });
        }

        // Drag & Drop
        dom.dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dom.dropZone.classList.add('dragover');
        });

        dom.dropZone.addEventListener('dragleave', () => {
            dom.dropZone.classList.remove('dragover');
        });

        dom.dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dom.dropZone.classList.remove('dragover');
            if (e.dataTransfer.files && e.dataTransfer.files[0]) {
                handleIncomingFile(e.dataTransfer.files[0]);
            }
        });

        // Remove button
        if (dom.btnRemoveImage) {
            dom.btnRemoveImage.addEventListener('click', (e) => {
                e.stopPropagation();
                clearImagePreview();
            });
        }

        // Global Paste Listener for Ctrl+V Image
        window.addEventListener('paste', (e) => {
            if (state.currentTab !== 'tab-ai') return;
            const items = (e.clipboardData || e.originalEvent.clipboardData).items;
            for (const item of items) {
                if (item.type.indexOf('image') !== -1) {
                    const blob = item.getAsFile();
                    handleImageFile(blob);
                    showToast('تصویر از کلیپ‌بورد با موفقیت دریافت شد', 'info');
                    break;
                }
            }
        });
    }

    function handleIncomingFile(file) {
        if (!file) return;
        const name = (file.name || '').toLowerCase();
        if (name.endsWith('.xlsx') || name.endsWith('.xls')) {
            handleCustomExcelFile(file);
        } else {
            handleImageFile(file);
        }
    }

    async function handleCustomExcelFile(file) {
        const name = (file.name || '').toLowerCase();
        if (!name.endsWith('.xlsx') && !name.endsWith('.xls')) {
            showToast('لطفاً یک فایل اکسل معتبر (.xlsx یا .xls) انتخاب کنید', 'warning');
            return;
        }

        try {
            showLoading(`در حال بررسی انطباق بچ‌ها و قوانین SOP روی فایل «${file.name}»...`);
            const reader = new FileReader();
            reader.onload = async (e) => {
                const b64 = e.target.result;
                try {
                    const res = await api.convertCustomExcel(b64, null, state.currentStore || null);
                    if (res.ok) {
                        state.customExcelResult = res;

                        // Display banner in Tab 1
                        if (dom.customExcelBanner) {
                            dom.customExcelBanner.style.display = 'block';
                            if (dom.customExcelTitle) {
                                dom.customExcelTitle.innerHTML = `✅ فایل «${escapeHtml(file.name)}» با موفقیت بررسی و کانورت شد: <b>${escapeHtml(res.store_name)} (کد انبار ${res.store_code})</b>`;
                            }
                            if (dom.customExcelStats) {
                                const summ = res.audit_summary || {};
                                dom.customExcelStats.innerHTML = `
                                    <span>📦 تعداد اقلام: <b>${formatNumber(res.count)}</b></span>
                                    <span style="color: var(--color-success); font-weight: 700;">🎯 تطابق بچ ارسالی به فروشگاه: <b>${formatNumber(summ.batch_matches || res.count)}</b> (${summ.batch_mismatches === 0 ? '۱۰۰٪ انطباق کامل' : 'دارای اصلاح'})</span>
                                    <span>⚖️ اصلاح سقف (Max > Min): <b>${formatNumber(summ.auto_bumps || 0)}</b></span>
                                    <span>🚫 سقف و کف صفر (SOP): <b>${formatNumber(summ.zero_mandated || 0)}</b></span>
                                    <span>📁 فایل ذخیره‌شده: <b>${escapeHtml(res.filename)}</b></span>
                                `;
                            }
                        }

                        // Load items into Tab 1 table so user can inspect and edit
                        // (the file's store becomes the current store, so later exports use its warehouse code)
                        state.storeItems = res.items || [];
                        state.filteredItems = [...state.storeItems];
                        state.editedItems.clear();
                        state.currentPage = 1;
                        selectConvertStore(res.store_name);
                        renderConvertTable();

                        // Also populate AI table if user is in AI tab
                        if (dom.aiTableBody) {
                            renderAiResults(res.items || []);
                        }

                        // If user is currently in AI tab, switch tab to convert view so they immediately see the result
                        if (state.currentTab === 'tab-ai') {
                            switchTab('tab-convert');
                        }

                        showToast(`🚀 تحلیل فایل «${file.name}» با موفقیت انجام شد: ${formatNumber(res.count)} قلم برای ${res.store_name} (کد انبار ${res.store_code})`, 'success');
                    } else {
                        showToast(`خطا در بررسی فایل: ${res.error || 'خطای ناشناخته'}`, 'error');
                    }
                } catch (err) {
                    showToast(`خطا در پردازش فایل اکسل: ${err.message}`, 'error');
                } finally {
                    hideLoading();
                }
            };
            reader.readAsDataURL(file);
        } catch (err) {
            hideLoading();
            showToast(`خطا در خواندن فایل: ${err.message}`, 'error');
        }
    }

    function handleImageFile(file) {
        if (!file.type.startsWith('image/')) {
            showToast('لطفاً یک فایل تصویری معتبر انتخاب کنید', 'warning');
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            state.aiImageBase64 = e.target.result;
            if (dom.imagePreview) dom.imagePreview.src = state.aiImageBase64;
            if (dom.imagePreviewContainer) dom.imagePreviewContainer.style.display = 'block';
        };
        reader.readAsDataURL(file);
    }

    function clearImagePreview() {
        state.aiImageBase64 = null;
        if (dom.imagePreview) dom.imagePreview.src = '';
        if (dom.imagePreviewContainer) dom.imagePreviewContainer.style.display = 'none';
        if (dom.aiFileInput) dom.aiFileInput.value = '';
    }

    async function handleRunAI() {
        const text = (dom.promptInput ? dom.promptInput.value : '').trim();
        const image = state.aiImageBase64;
        const store = dom.aiStoreSelect ? dom.aiStoreSelect.value : '';

        if (!text && !image) {
            showToast('لطفاً یک تصویر بارگذاری کنید یا دستور متنی وارد نمایید', 'warning');
            return;
        }

        try {
            showLoading('دستیار هوش مصنوعی در حال استخراج و انطباق اقلام است...');
            const res = await api.aiParse(text, image, store);
            if (!res.ok) {
                showToast(res.error || 'خطا در پردازش درخواست', 'error', 7000);
                return;
            }

            if (res.ok) {
                if (res.audit_summary) {
                    state.customExcelResult = res;
                    state.storeItems = res.items || [];
                    state.filteredItems = [...state.storeItems];
                    state.editedItems.clear();
                    state.currentPage = 1;
                    selectConvertStore(res.store_name);
                    renderConvertTable();

                    if (dom.customExcelBanner) {
                        dom.customExcelBanner.style.display = 'block';
                        if (dom.customExcelTitle) {
                            dom.customExcelTitle.innerHTML = `✅ فایل با موفقیت بررسی و کانورت شد: <b>${escapeHtml(res.store_name)} (کد انبار ${res.store_code})</b>`;
                        }
                        if (dom.customExcelStats) {
                            const summ = res.audit_summary || {};
                            dom.customExcelStats.innerHTML = `
                                <span>📦 تعداد اقلام: <b>${formatNumber(res.count)}</b></span>
                                <span style="color: var(--color-success); font-weight: 700;">🎯 تطابق بچ شناسنامه: <b>${formatNumber(summ.batch_matches || res.count)}</b></span>
                                <span>⚖️ اصلاح سقف (Max > Min): <b>${formatNumber(summ.auto_bumps || 0)}</b></span>
                                <span>🚫 سقف و کف صفر (SOP): <b>${formatNumber(summ.zero_mandated || 0)}</b></span>
                                <span>📁 فایل ذخیره‌شده: <b>${escapeHtml(res.filename)}</b></span>
                            `;
                        }
                    }

                    renderAiResults(res.items || []);
                    switchTab('tab-convert');
                    showToast(`🚀 تحلیل فایل با موفقیت انجام شد: ${formatNumber(res.count)} قلم برای ${res.store_name}`, 'success');
                    return;
                }

                state.aiItems = res.items || [];
                renderAiResults(state.aiItems);

                if (res.warning) {
                    showToast(res.warning, 'warning', 7000);
                }
                if (state.aiItems.length > 0) {
                    showToast(`✨ تعداد ${formatNumber(state.aiItems.length)} کالا توسط هوش مصنوعی شناسایی شد`, 'success');
                } else {
                    showToast('کالایی منطبق بر دستور در پایگاه داده یافت نشد', 'warning');
                }
            }
        } catch (err) {
            showToast(`خطای دستیار هوشمند: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    function renderAiResults(items) {
        if (!dom.aiTableBody) return;

        if (dom.aiResultCount) dom.aiResultCount.textContent = `${formatNumber(items.length)} کالا`;
        if (dom.aiResultsToolbar) dom.aiResultsToolbar.style.display = items.length > 0 ? 'flex' : 'none';
        if (dom.aiTableContainer) dom.aiTableContainer.style.display = items.length > 0 ? 'block' : 'none';

        let rowsHtml = '';
        items.forEach(item => {
            rowsHtml += `
                <tr>
                    <td class="col-num">${escapeHtml(item.store_code || item.wh_code || '')}</td>
                    <td class="col-num"><b>${escapeHtml(item.code || '')}</b></td>
                    <td>${escapeHtml(item.name || '')}</td>
                    <td class="col-num"><b>${formatNumber(item.min)}</b></td>
                    <td class="col-num"><b>${formatNumber(item.max)}</b></td>
                    <td class="col-num">${formatNumber(item.batch || 1)}</td>
                    <td style="text-align: center;"><span class="badge badge-status active">فعال</span></td>
                    <td style="color: var(--text-secondary); font-size: 0.8rem;">
                        ${escapeHtml(item.matched_keyword || item.reason || 'انطباق هوشمند')}
                    </td>
                </tr>
            `;
        });

        dom.aiTableBody.innerHTML = rowsHtml;
    }

    async function handleExportAI() {
        if (!state.aiItems || state.aiItems.length === 0) {
            showToast('کالایی برای ذخیره وجود ندارد', 'warning');
            return;
        }

        const store = dom.aiStoreSelect ? dom.aiStoreSelect.value : state.currentStore;
        try {
            showLoading('در حال ایجاد فایل کانورت اقلام هوش مصنوعی...');
            const res = await api.exportConvert(store || 'اصلاحی', state.aiItems);

            if (res.ok) {
                showToast(`💾 فایل کانورت اصلاحی با موفقیت ذخیره شد: ${res.filename}`, 'success');
            }
        } catch (err) {
            showToast(`خطا در ذخیره فایل: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    async function handleCopyAI() {
        if (!state.aiItems || state.aiItems.length === 0) {
            showToast('کالایی برای کپی وجود ندارد', 'warning');
            return;
        }

        const store = dom.aiStoreSelect ? dom.aiStoreSelect.value : state.currentStore;
        try {
            showLoading('در حال آماده‌سازی کلیپ‌بورد...');
            const res = await api.copyErp(store || 'اصلاحی', state.aiItems);

            if (res.ok && res.tsv) {
                await copyToClipboard(res.tsv);
                showToast('📋 ۵ ستون اقلام هوش مصنوعی در کلیپ‌بورد کپی شد', 'success');
            }
        } catch (err) {
            showToast(`خطا در کپی: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TAB 3: AUDIT & HEALTH MONITORING
    // ─────────────────────────────────────────────────────────────────────────────
    async function loadAuditData(silent = false) {
        try {
            if (!silent) showLoading('در حال پایش جامع مغایرت‌های سیستم و انطباق با SOP...');
            const res = await api.getAudit();

            if (res.ok) {
                state.auditData = res;
                updateAuditCounters();
                renderAuditTable();
            }
        } catch (err) {
            if (!silent) showToast(`خطا در دریافت گزارش پایش: ${err.message}`, 'error');
        } finally {
            if (!silent) hideLoading();
        }
    }

    function updateAuditCounters() {
        if (!state.auditData) return;

        const data = state.auditData;
        const counts = data.counts || {};

        const pishOver = counts.pish_over_max ?? (data.pish_over_max ? data.pish_over_max.length : 0);
        const roundOver = counts.round_over_max ?? (data.round_over_max ? data.round_over_max.length : 0);
        const minGeMax = counts.min_ge_max ?? (data.min_ge_max ? data.min_ge_max.length : 0);
        const sopViolations = counts.sop_violations ?? (data.sop_violations ? data.sop_violations.length : 0);
        const total = data.total_anomalies || (pishOver + roundOver + minGeMax + sopViolations);

        if (dom.countPishOverMax) dom.countPishOverMax.textContent = formatNumber(pishOver);
        if (dom.countRoundOverMax) dom.countRoundOverMax.textContent = formatNumber(roundOver);
        if (dom.countMinGeMax) dom.countMinGeMax.textContent = formatNumber(minGeMax);
        if (dom.countSopViolations) dom.countSopViolations.textContent = formatNumber(sopViolations);

        if (dom.badgeAuditCount) {
            dom.badgeAuditCount.textContent = formatNumber(total);
        }
    }

    function renderAuditTable() {
        if (!dom.auditTableBody || !state.auditData) return;

        const data = state.auditData;
        const catFilter = state.selectedAuditCategory;
        const storeFilter = state.selectedAuditStore;

        let items = [];

        // Collect items according to category
        if (catFilter === 'ALL' || catFilter === 'pish_over_max') {
            (data.pish_over_max || []).forEach(it => items.push({ ...it, anomalyType: 'pish_over_max' }));
        }
        if (catFilter === 'ALL' || catFilter === 'round_over_max') {
            (data.round_over_max || []).forEach(it => items.push({ ...it, anomalyType: 'round_over_max' }));
        }
        if (catFilter === 'ALL' || catFilter === 'min_ge_max') {
            (data.min_ge_max || []).forEach(it => items.push({ ...it, anomalyType: 'min_ge_max' }));
        }
        if (catFilter === 'ALL' || catFilter === 'sop_violations') {
            (data.sop_violations || []).forEach(it => items.push({ ...it, anomalyType: 'sop_violations' }));
        }

        // Apply store filter
        if (storeFilter && storeFilter !== 'ALL') {
            items = items.filter(it => {
                const wh = String(it.wh_name || it.store || '');
                return wh.includes(storeFilter);
            });
        }

        if (dom.auditTotalFiltered) {
            dom.auditTotalFiltered.textContent = formatNumber(items.length);
        }

        if (items.length === 0) {
            dom.auditTableBody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 3rem; color: var(--color-success); font-weight: 600;">
                        ✨ هیچ مغایرتی در این بخش یافت نشد. تمام اقلام در سلامت کامل هستند.
                    </td>
                </tr>
            `;
            return;
        }

        const categoryBadges = {
            pish_over_max: '<span class="badge badge-anomaly danger">پیشنهاد > سقف</span>',
            round_over_max: '<span class="badge badge-anomaly orange">گردشده > سقف</span>',
            min_ge_max: '<span class="badge badge-anomaly warning">کف ≥ سقف</span>',
            sop_violations: '<span class="badge badge-anomaly purple">نقض قوانین SOP</span>',
        };

        let rowsHtml = '';
        items.forEach(it => {
            const badge = categoryBadges[it.anomalyType] || '<span class="badge">مغایرت</span>';
            const problem = it.anomaly_reason || it.problem || it.reason || it.description || 'مغایرت در فرمول سقف یا کف';
            const fix = it.suggested_fix || it.fix || 'اصلاح سقف بر مبنای کارتن مادر و کف مصوب';

            rowsHtml += `
                <tr>
                    <td><b>${escapeHtml(it.wh_name || it.store || 'همه')}</b></td>
                    <td class="col-num">${escapeHtml(it.code || '')}</td>
                    <td title="${escapeHtml(it.name || '')}">${escapeHtml(it.name || '')}</td>
                    <td style="text-align: center;">${badge}</td>
                    <td class="col-num">${formatNumber(it.min ?? it.curr_min)}</td>
                    <td class="col-num">${formatNumber(it.max ?? it.curr_max)}</td>
                    <td class="col-num">${formatNumber(it.pish_round ?? it.pish_raw ?? 0)}</td>
                    <td style="color: var(--color-danger); font-size: 0.82rem;">${escapeHtml(problem)}</td>
                    <td style="color: var(--color-success); font-size: 0.82rem; font-weight: 600;">${escapeHtml(fix)}</td>
                </tr>
            `;
        });

        dom.auditTableBody.innerHTML = rowsHtml;
    }

    async function handleAutoFixAll() {
        const store = dom.auditStoreSelect ? dom.auditStoreSelect.value : 'ALL';
        try {
            showLoading(`در حال اصلاح خودکار تمام مغایرت‌ها برای ${store === 'ALL' ? 'کل شبکه' : store}...`);
            const res = await api.autoFixAudit(store);

            if (res.ok) {
                if (res.count > 0) {
                    showToast(`🛠️ تعداد ${formatNumber(res.count)} مغایرت اصلاح شد و فایل تعادل تولید گردید: ${res.filename}`, 'success', 6000);
                    // Reload audit data
                    await loadAuditData();
                } else {
                    showToast('هیچ مغایرتی برای اصلاح یافت نشد', 'info');
                }
            }
        } catch (err) {
            showToast(`خطا در اصلاح خودکار: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TAB 4: DIFF TRACKER & TELEGRAM SUMMARY
    // ─────────────────────────────────────────────────────────────────────────────
    async function loadDiffData() {
        try {
            showLoading('در حال بارگذاری و تحلیل تغییرات میان فایل‌ها...');
            const res = await api.getDiff();

            if (res.ok) {
                state.diffData = res;
                const counts = res.counts || {};

                if (dom.diffCountChanges) dom.diffCountChanges.textContent = formatNumber(counts.total_changes || 0);
                if (dom.diffCountAdded) dom.diffCountAdded.textContent = formatNumber(counts.added || 0);
                if (dom.diffCountRemoved) dom.diffCountRemoved.textContent = formatNumber(counts.removed || 0);

                renderDiffTable(res.changes || []);
                await loadTelegramSummary(dom.diffStoreSelect ? dom.diffStoreSelect.value : 'ALL');
            } else {
                if (dom.diffTableBody) {
                    dom.diffTableBody.innerHTML = `
                        <tr>
                            <td colspan="8" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                                ${escapeHtml(res.message || 'حداقل دو فایل پیشنهاد ارسال برای مقایسه نیاز است.')}
                            </td>
                        </tr>
                    `;
                }
                if (dom.telegramBox) {
                    dom.telegramBox.textContent = 'جهت صدور گزارش تلگرام، وجود دو فایل پیشنهاد ارسال در پوشه الزامی است.';
                }
            }
        } catch (err) {
            showToast(`خطا در دریافت مقایسه تغییرات: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    function renderDiffTable(changes) {
        if (!dom.diffTableBody) return;

        if (!changes || changes.length === 0) {
            dom.diffTableBody.innerHTML = `
                <tr>
                    <td colspan="8" style="text-align: center; padding: 3rem; color: var(--color-success);">
                        تغییری در سقف و کف نسبت به فایل قبل ثبت نشده است.
                    </td>
                </tr>
            `;
            return;
        }

        let rowsHtml = '';
        changes.slice(0, 300).forEach(c => {
            const minDiff = (c.curr_min ?? 0) - (c.prev_min ?? 0);
            const maxDiff = (c.curr_max ?? 0) - (c.prev_max ?? 0);

            let diffBadge = '';
            if (minDiff > 0 || maxDiff > 0) {
                diffBadge = `<span class="badge badge-feasibility green">افزایش (+${formatNumber(Math.max(minDiff, maxDiff))})</span>`;
            } else {
                diffBadge = `<span class="badge badge-feasibility red">کاهش (${formatNumber(Math.min(minDiff, maxDiff))})</span>`;
            }

            rowsHtml += `
                <tr>
                    <td><b>${escapeHtml(c.wh_name || '')}</b></td>
                    <td class="col-num">${escapeHtml(c.code || '')}</td>
                    <td title="${escapeHtml(c.name || '')}">${escapeHtml(c.name || '')}</td>
                    <td class="col-num">${formatNumber(c.prev_min)}</td>
                    <td class="col-num"><b>${formatNumber(c.curr_min)}</b></td>
                    <td class="col-num">${formatNumber(c.prev_max)}</td>
                    <td class="col-num"><b>${formatNumber(c.curr_max)}</b></td>
                    <td>${diffBadge}</td>
                </tr>
            `;
        });

        dom.diffTableBody.innerHTML = rowsHtml;
    }

    async function loadTelegramSummary(storeName) {
        if (!dom.telegramBox) return;

        try {
            dom.telegramBox.textContent = 'در حال تدوین متن گزارش...';
            const res = await api.getTelegramSummary(storeName);

            if (res.ok) {
                dom.telegramBox.textContent = res.summary || 'تغییری برای گزارش وجود ندارد.';
            }
        } catch (err) {
            dom.telegramBox.textContent = `خطا در دریافت خلاصه پیام: ${err.message}`;
        }
    }

    async function handleCopyTelegram() {
        if (!dom.telegramBox || !dom.telegramBox.textContent) {
            showToast('متنی برای کپی وجود ندارد', 'warning');
            return;
        }

        await copyToClipboard(dom.telegramBox.textContent);
        showToast('📋 متن گزارش تلگرام برای مدیر فروشگاه کپی شد', 'success');
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // TAB 5: PRESETS & SCENARIOS
    // ─────────────────────────────────────────────────────────────────────────────
    async function loadPresets() {
        try {
            showLoading('در حال بارگذاری شناسنامه و سناریوها...');
            const res = await api.getPresets();
            state.presets = res || {};
            renderPresetCards();
        } catch (err) {
            showToast(`خطا در دریافت سناریوها: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    function renderPresetCards() {
        if (!dom.presetsCardsContainer) return;

        const presetIcons = {
            'روغن و برنج': '🌾',
            'شوینده و بهداشتی': '🧼',
            'ماکارونی و غلات': '🍝',
            'قند و چای': '☕',
            'صفر کردن اقلام خاص': '🚫',
        };

        let cardsHtml = '';
        Object.entries(state.presets).forEach(([name, p]) => {
            const icon = presetIcons[name] || '⚡';
            const isSelected = state.selectedPreset === name;

            cardsHtml += `
                <div class="preset-card ${isSelected ? 'selected' : ''}" data-preset="${escapeHtml(name)}">
                    <div>
                        <div class="preset-header">
                            <span class="preset-title">${icon} ${escapeHtml(name)}</span>
                        </div>
                        <div class="preset-limits">
                            <span class="preset-limit-badge">کف: ${formatNumber(p.default_min)}</span>
                            <span class="preset-limit-badge">سقف: ${formatNumber(p.default_max)}</span>
                        </div>
                        <div class="preset-desc">${escapeHtml(p.description || '')}</div>
                    </div>
                    <button class="btn btn-secondary btn-sm" style="margin-top: 1rem; width: 100%;">
                        ${isSelected ? '✓ انتخاب شده' : 'انتخاب سناریو'}
                    </button>
                </div>
            `;
        });

        dom.presetsCardsContainer.innerHTML = cardsHtml;

        // Card click listeners
        const cards = dom.presetsCardsContainer.querySelectorAll('.preset-card');
        cards.forEach(c => {
            c.addEventListener('click', () => {
                const presetName = c.getAttribute('data-preset');
                state.selectedPreset = presetName;
                renderPresetCards();
            });
        });
    }

    async function handleApplyPreset() {
        if (!state.selectedPreset) {
            showToast('لطفاً ابتدا یکی از کارت‌های سناریو را انتخاب کنید', 'warning');
            return;
        }

        const store = dom.presetStoreSelect ? dom.presetStoreSelect.value : '';
        if (!store) {
            showToast('لطفاً شعبه هدف را انتخاب کنید', 'warning');
            return;
        }

        try {
            showLoading(`در حال اعمال سناریوی «${state.selectedPreset}» روی شعبه ${store}...`);
            const res = await api.applyPreset(state.selectedPreset, store);

            if (res.ok) {
                state.presetItems = res.items || [];
                renderPresetTable(state.presetItems);

                if (dom.btnExportPreset) dom.btnExportPreset.disabled = state.presetItems.length === 0;
                if (dom.btnCopyPreset) dom.btnCopyPreset.disabled = state.presetItems.length === 0;

                showToast(`⚡ سناریو روی ${formatNumber(res.count)} کالا با موفقیت اعمال گردید`, 'success');
            }
        } catch (err) {
            showToast(`خطا در اعمال سناریو: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    function renderPresetTable(items) {
        if (!dom.presetTableBody) return;

        if (!items || items.length === 0) {
            dom.presetTableBody.innerHTML = `
                <tr>
                    <td colspan="9" style="text-align: center; padding: 3rem; color: var(--text-muted);">
                        کالایی منطبق بر کلمات کلیدی این سناریو یافت نشد.
                    </td>
                </tr>
            `;
            return;
        }

        let rowsHtml = '';
        items.forEach(it => {
            rowsHtml += `
                <tr>
                    <td class="col-num">${escapeHtml(it.store_code || it.wh_code || '')}</td>
                    <td class="col-num"><b>${escapeHtml(it.code || '')}</b></td>
                    <td>${escapeHtml(it.name || '')}</td>
                    <td class="col-num"><b style="color: var(--color-primary);">${formatNumber(it.new_min ?? it.min)}</b></td>
                    <td class="col-num"><b style="color: var(--color-cyan);">${formatNumber(it.new_max ?? it.max)}</b></td>
                    <td class="col-num">${formatNumber(it.prev_min ?? it.min)}</td>
                    <td class="col-num">${formatNumber(it.prev_max ?? it.max)}</td>
                    <td class="col-num">${formatNumber(it.batch || 1)}</td>
                    <td><span class="badge badge-status active">${escapeHtml(state.selectedPreset || '')}</span></td>
                </tr>
            `;
        });

        dom.presetTableBody.innerHTML = rowsHtml;
    }

    async function handleExportPreset() {
        if (!state.presetItems || state.presetItems.length === 0) return;
        const store = dom.presetStoreSelect ? dom.presetStoreSelect.value : 'سناریو';
        try {
            showLoading('در حال ایجاد فایل کانورت سناریو...');
            const res = await api.exportConvert(store, state.presetItems);
            if (res.ok) {
                showToast(`💾 فایل کانورت سناریو تولید شد: ${res.filename}`, 'success');
            }
        } catch (err) {
            showToast(`خطا در ذخیره فایل: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    async function handleCopyPreset() {
        if (!state.presetItems || state.presetItems.length === 0) return;
        const store = dom.presetStoreSelect ? dom.presetStoreSelect.value : 'سناریو';
        try {
            showLoading('در حال آماده‌سازی کلیپ‌بورد...');
            const res = await api.copyErp(store, state.presetItems);
            if (res.ok && res.tsv) {
                await copyToClipboard(res.tsv);
                showToast('📋 ۵ ستون اقلام سناریو در کلیپ‌بورد کپی شد', 'success');
            }
        } catch (err) {
            showToast(`خطا در کپی: ${err.message}`, 'error');
        } finally {
            hideLoading();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // EVENT LISTENERS BINDING
    // ─────────────────────────────────────────────────────────────────────────────
    function bindEvents() {
        // Theme Toggle
        if (dom.themeBtn) {
            dom.themeBtn.addEventListener('click', () => {
                const nextTheme = state.theme === 'dark' ? 'light' : 'dark';
                applyTheme(nextTheme);
            });
        }

        // Open Folder
        if (dom.openFolderBtn) {
            dom.openFolderBtn.addEventListener('click', async () => {
                try {
                    const res = await api.openFolder();
                    if (res.ok) {
                        showToast(`📂 پوشه روزانه باز شد: ${res.opened}`, 'info');
                    }
                } catch (err) {
                    showToast(`خطا در باز کردن پوشه: ${err.message}`, 'error');
                }
            });
        }

        // Refresh File
        if (dom.refreshBtn) {
            dom.refreshBtn.addEventListener('click', () => {
                loadAppStatus(true);
            });
        }

        // Tab 1: Store Select
        if (dom.storeSelect) {
            dom.storeSelect.addEventListener('change', (e) => {
                state.currentStore = e.target.value;
                loadStoreData(state.currentStore);
            });
        }

        // Tab 1: Search input (debounced)
        if (dom.searchConvert) {
            let timeout = null;
            dom.searchConvert.addEventListener('input', (e) => {
                clearTimeout(timeout);
                timeout = setTimeout(() => {
                    state.searchQuery = e.target.value;
                    applyConvertFilter();
                }, 150);
            });
        }

        // Tab 1: Buttons
        if (dom.btnExportStore) dom.btnExportStore.addEventListener('click', handleExportStore);
        if (dom.btnCopyERP) dom.btnCopyERP.addEventListener('click', handleCopyERP);
        if (dom.btnExportAll) dom.btnExportAll.addEventListener('click', handleExportAll);

        // Tab 1: Custom Excel Upload & Banner Buttons
        if (dom.btnUploadCustomExcel && dom.customExcelInput) {
            dom.btnUploadCustomExcel.addEventListener('click', () => {
                dom.customExcelInput.click();
            });
            dom.customExcelInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files[0]) {
                    handleCustomExcelFile(e.target.files[0]);
                }
            });
        }
        if (dom.btnCloseCustomBanner) {
            dom.btnCloseCustomBanner.addEventListener('click', () => {
                if (dom.customExcelBanner) dom.customExcelBanner.style.display = 'none';
            });
        }
        if (dom.btnCopyCustomERP) {
            dom.btnCopyCustomERP.addEventListener('click', async () => {
                if (!state.customExcelResult || !state.customExcelResult.tsv) {
                    showToast('داده‌ای برای کپی وجود ندارد', 'warning');
                    return;
                }
                const success = await copyToClipboard(state.customExcelResult.tsv);
                if (success) {
                    showToast(`📋 ۵ ستون استاندارد ERP برای ${formatNumber(state.customExcelResult.count)} کالا با موفقیت کپی شد`, 'success');
                }
            });
        }
        if (dom.btnOpenCustomFolder) {
            dom.btnOpenCustomFolder.addEventListener('click', () => {
                api.openFolder();
            });
        }

        // Tab 1: Pagination
        if (dom.pageSizeSelect) {
            dom.pageSizeSelect.addEventListener('change', (e) => {
                state.pageSize = parseInt(e.target.value, 10) || 50;
                state.currentPage = 1;
                renderConvertTable();
            });
        }
        if (dom.btnFirstPage) {
            dom.btnFirstPage.addEventListener('click', () => {
                state.currentPage = 1;
                renderConvertTable();
            });
        }
        if (dom.btnPrevPage) {
            dom.btnPrevPage.addEventListener('click', () => {
                if (state.currentPage > 1) {
                    state.currentPage--;
                    renderConvertTable();
                }
            });
        }
        if (dom.btnNextPage) {
            dom.btnNextPage.addEventListener('click', () => {
                const totalPages = Math.ceil(state.filteredItems.length / state.pageSize) || 1;
                if (state.currentPage < totalPages) {
                    state.currentPage++;
                    renderConvertTable();
                }
            });
        }
        if (dom.btnLastPage) {
            dom.btnLastPage.addEventListener('click', () => {
                const totalPages = Math.ceil(state.filteredItems.length / state.pageSize) || 1;
                state.currentPage = totalPages;
                renderConvertTable();
            });
        }

        // Tab 2: AI
        initAiDropZone();
        if (dom.btnRunAI) dom.btnRunAI.addEventListener('click', handleRunAI);
        if (dom.btnExportAI) dom.btnExportAI.addEventListener('click', handleExportAI);
        if (dom.btnCopyAI) dom.btnCopyAI.addEventListener('click', handleCopyAI);

        // Tab 3: Audit Metric Cards & Filters
        const auditCards = [
            { el: dom.cardPishOverMax, cat: 'pish_over_max' },
            { el: dom.cardRoundOverMax, cat: 'round_over_max' },
            { el: dom.cardMinGeMax, cat: 'min_ge_max' },
            { el: dom.cardSopViolations, cat: 'sop_violations' },
        ];

        auditCards.forEach(({ el, cat }) => {
            if (!el) return;
            el.addEventListener('click', () => {
                if (state.selectedAuditCategory === cat) {
                    state.selectedAuditCategory = 'ALL';
                    el.classList.remove('active');
                } else {
                    state.selectedAuditCategory = cat;
                    auditCards.forEach(c => c.el && c.el.classList.remove('active'));
                    el.classList.add('active');
                }
                if (dom.auditCategorySelect) dom.auditCategorySelect.value = state.selectedAuditCategory;
                renderAuditTable();
            });
        });

        if (dom.auditCategorySelect) {
            dom.auditCategorySelect.addEventListener('change', (e) => {
                state.selectedAuditCategory = e.target.value;
                auditCards.forEach(c => {
                    if (c.el) {
                        c.el.classList.toggle('active', c.cat === state.selectedAuditCategory);
                    }
                });
                renderAuditTable();
            });
        }

        if (dom.auditStoreSelect) {
            dom.auditStoreSelect.addEventListener('change', (e) => {
                state.selectedAuditStore = e.target.value;
                renderAuditTable();
            });
        }

        if (dom.btnAutoFixAll) dom.btnAutoFixAll.addEventListener('click', handleAutoFixAll);

        // Tab 4: Diff
        if (dom.diffStoreSelect) {
            dom.diffStoreSelect.addEventListener('change', (e) => {
                state.selectedDiffStore = e.target.value;
                loadTelegramSummary(state.selectedDiffStore);
            });
        }
        if (dom.btnCopyTelegram) dom.btnCopyTelegram.addEventListener('click', handleCopyTelegram);
        if (dom.btnRefreshDiff) dom.btnRefreshDiff.addEventListener('click', loadDiffData);

        // Tab 5: Presets
        if (dom.btnApplySelectedPreset) dom.btnApplySelectedPreset.addEventListener('click', handleApplyPreset);
        if (dom.btnExportPreset) dom.btnExportPreset.addEventListener('click', handleExportPreset);
        if (dom.btnCopyPreset) dom.btnCopyPreset.addEventListener('click', handleCopyPreset);
        if (dom.searchPresetGoods) {
            dom.searchPresetGoods.addEventListener('input', (e) => {
                const q = e.target.value.trim().toLowerCase();
                if (!q) {
                    renderPresetTable(state.presetItems);
                } else {
                    const filtered = state.presetItems.filter(it => 
                        String(it.name || '').toLowerCase().includes(q) || 
                        String(it.code || '').includes(q)
                    );
                    renderPresetTable(filtered);
                }
            });
        }
    }

    // ─────────────────────────────────────────────────────────────────────────────
    // APP ENTRY POINT
    // ─────────────────────────────────────────────────────────────────────────────
    document.addEventListener('DOMContentLoaded', () => {
        applyTheme(state.theme);
        initTabs();
        bindEvents();
        updateClock();
        setInterval(updateClock, 1000);
        loadAppStatus(false);
    });

})();
