const BASE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1OaBBapoMTT2u4lnoca2CVsLAub9lV-eQb56MI6iffLY/export?format=csv&gid=';
const ORIGINAL_DEPOSIT_KEY = 'portfolioDashboard_originalDeposit';
// Determine server URL: if on localhost use absolute path for local dev, otherwise use relative path for production
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3001' : '';

// Multiple CORS proxies in priority order — if one fails, the next is tried
const CORS_PROXIES = [
    (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
    (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
    (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`,
];

let currentGid = '0';
let accountCache = {}; // { gid: data[] }
let charts = {};

document.addEventListener('DOMContentLoaded', () => {
    initApp();

    document.getElementById('refresh-btn').addEventListener('click', () => {
        delete accountCache[currentGid];
        initApp();
    });

    document.getElementById('account-selector').addEventListener('change', (e) => {
        currentGid = e.target.value;
        initApp();
    });

    document.getElementById('search-input').addEventListener('keyup', (e) => {
        const term = e.target.value.toLowerCase();
        filterTable(term);
    });
});

// Try fetching through each proxy in order; return text on first success
async function fetchWithFallback(sheetUrl) {
    let lastError;
    for (const proxyFn of CORS_PROXIES) {
        try {
            const proxyUrl = proxyFn(sheetUrl);
            const response = await fetch(proxyUrl, { signal: AbortSignal.timeout(8000) });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const text = await response.text();
            // Sanity-check: a valid CSV will contain a comma or be non-empty
            if (text && text.length > 10) return text;
            throw new Error('Empty or invalid response');
        } catch (err) {
            lastError = err;
            console.warn(`Proxy failed, trying next...`, err.message);
        }
    }
    throw lastError;
}

async function initApp() {
    toggleLoader(true);

    if (accountCache[currentGid]) {
        renderWithData(accountCache[currentGid]);
        toggleLoader(false);
        return;
    }

    try {
        const csvText = await fetchWithFallback(BASE_SHEET_URL + currentGid);

        Papa.parse(csvText, {
            complete: function (results) {
                const processed = processData(results.data);
                accountCache[currentGid] = processed;
                renderWithData(processed);
                toggleLoader(false);
            }
        });
    } catch (error) {
        console.error('All proxies failed:', error);
        alert('שגיאה בטעינת הנתונים מ-Google Sheets. אנא נסה לרענן שוב.');
        toggleLoader(false);
    }
}

function processData(rows) {
    const data = [];
    if (!rows || rows.length === 0) return data;

    // Find header row and indices
    let colIndices = {
        category: 0,
        name: 1,
        ticker: 2,
        quantity: 7,
        cost: -1,
        value: -1,
        profit: -1,
        profitPercent: -1,
        dividend: -1
    };

    // Look for a row that contains our headers
    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i];
        if (row.includes('Ticker') || row.includes('טיקר')) {
            headerRowIndex = i;
            // Map indices based on labels
            row.forEach((cell, idx) => {
                const text = cell.trim();
                if (text === 'Ticker' || text === 'טיקר') colIndices.ticker = idx;
                if (text === 'עלות' || text === 'מחיר ממוצע') colIndices.cost = idx;
                if (text === 'סכום' || text === 'שווי') colIndices.value = idx;
                if (text === 'רווח') colIndices.profit = idx;
                if (text === 'רווח %') colIndices.profitPercent = idx;
                if (text === 'דיבידנד') colIndices.dividend = idx;
            });
            break;
        }
    }

    // Fallback if header detection fails (use defaults or 'הכל' structure)
    if (headerRowIndex === -1) {
        headerRowIndex = 0;
        colIndices.cost = 6;
        colIndices.value = 8;
        colIndices.profit = 9;
        colIndices.profitPercent = 10;
        colIndices.dividend = 12;
    }

    // Parse data rows starting AFTER the header row
    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];

        // A row is valid if it has content in ticker and cost/value columns
        const ticker = row[colIndices.ticker];
        const costStr = row[colIndices.cost];

        if (ticker && costStr && (costStr.includes('₪') || costStr.includes('$') || !isNaN(parseMoney(costStr)))) {
            // Filter out summary/subtotal rows (usually don't have a ticker or name)
            if (ticker.trim() === '' || ticker.includes('סה"כ')) continue;

            const cost = parseMoney(row[colIndices.cost]);
            const value = parseMoney(row[colIndices.value]);
            const profit = parseMoney(row[colIndices.profit]);
            const profitPercent = parseMoney(row[colIndices.profitPercent]);

            // Skip empty/invalid rows that might have passed the first check
            if (isNaN(cost) && isNaN(value)) continue;

            const dividend = colIndices.dividend >= 0 ? parseMoney(row[colIndices.dividend]) : 0;

            data.push({
                category: row[colIndices.category] || 'אחר',
                name: row[colIndices.name] || ticker,
                ticker: ticker,
                quantity: row[colIndices.quantity],
                cost: cost,
                value: value,
                profit: profit,
                profitPercent: profitPercent,
                dividend: dividend
            });
        }
    }
    // The user specified that the original deposit (סכום מקורי) is at cell Q5.
    // In a 0-indexed CSV parser where row 1 is index 0 and column A is index 0:
    // Q is the 17th letter of the alphabet, so column Q is index 16.
    // Row 5 is index 4.
    let originalDeposit = 0;
    if (rows.length > 4 && rows[4].length > 16) {
        originalDeposit = parseMoney(rows[4][16]);
    }

    return { assets: data, originalDeposit };
}

async function renderWithData(result) {
    const assets = result.assets || result; // backward compat
    let originalDeposit = 0;

    // 1. Try the local server first (authoritative source)
    try {
        const resp = await fetch(`${SERVER_URL}/deposit`, { signal: AbortSignal.timeout(2000) });
        if (resp.ok) {
            const data = await resp.json();
            originalDeposit = data.value || 0;
            // Sync localStorage to match the server value
            if (originalDeposit > 0) localStorage.setItem(ORIGINAL_DEPOSIT_KEY, originalDeposit);
        }
    } catch {
        // Server not running — fall back to localStorage override or sheet value
        const stored = parseFloat(localStorage.getItem(ORIGINAL_DEPOSIT_KEY));
        originalDeposit = stored > 0 ? stored : (result.originalDeposit || 0);
    }

    updateKPIs(assets, originalDeposit);
    renderCharts(assets);
    renderTable(assets);
}

function updateKPIs(data, originalDeposit) {
    let totalCost = 0;
    let totalValue = 0;
    let totalDividend = 0;

    data.forEach(asset => {
        totalCost += asset.cost;
        totalValue += asset.value;
        totalDividend += asset.dividend || 0;
    });

    // Profit on open positions (cost already adjusted for dividends in sheet)
    const totalProfit = totalValue - totalCost;
    const totalPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    document.getElementById('kpi-total-value').innerText = formatILS(totalValue);
    document.getElementById('kpi-total-cost').innerText = formatILS(totalCost);

    const profitEl = document.getElementById('kpi-total-profit');
    profitEl.innerText = formatILS(totalProfit);
    profitEl.className = totalProfit >= 0 ? 'positive-text' : 'negative-text';

    const percentEl = document.getElementById('kpi-total-percent');
    percentEl.innerText = totalPercent.toFixed(2) + '%';
    percentEl.className = totalPercent >= 0 ? 'positive-text' : 'negative-text';

    // Dividend KPI
    const divCard = document.getElementById('kpi-dividend-card');
    if (divCard) {
        if (totalDividend > 0) {
            divCard.classList.remove('hidden');
            document.getElementById('kpi-total-dividend').innerText = formatILS(totalDividend);
        } else {
            divCard.classList.add('hidden');
        }
    }

    // Original deposit + true profit section
    const origSection = document.getElementById('kpi-original-section');
    const origEl = document.getElementById('kpi-original-deposit');
    const trueProfit = document.getElementById('kpi-true-profit');
    const trueProfitPct = document.getElementById('kpi-true-profit-pct');

    if (origSection) {
        if (currentGid !== '0') {
            origSection.classList.add('hidden');
        } else if (originalDeposit > 0) {
            origSection.classList.remove('hidden');
            // Render the editable deposit field
            origEl.innerHTML = `
                <span class="deposit-display" id="deposit-display-val">${formatILS(originalDeposit)}</span>
                <button class="edit-deposit-btn" title="ערוך סכום" onclick="startEditDeposit(${originalDeposit})">
                    <i class="fa-solid fa-pen"></i>
                </button>
            `;
            const tp = totalValue - originalDeposit;
            const tpPct = (tp / originalDeposit) * 100;
            trueProfit.innerText = formatILS(tp);
            trueProfit.className = tp >= 0 ? 'positive-text' : 'negative-text';
            trueProfitPct.innerText = (tpPct >= 0 ? '+' : '') + tpPct.toFixed(2) + '%';
            trueProfitPct.className = tpPct >= 0 ? 'positive-text' : 'negative-text';
        } else {
            // originalDeposit is 0 — still show the section with a prompt to set it
            origSection.classList.remove('hidden');
            origEl.innerHTML = `
                <span class="deposit-display" style="color:var(--text-secondary)">לא הוגדר</span>
                <button class="edit-deposit-btn" title="הגדר סכום" onclick="startEditDeposit(0)">
                    <i class="fa-solid fa-pen"></i>
                </button>
            `;
            trueProfit.innerText = '—';
            trueProfitPct.innerText = '—';
        }
    }
}

function startEditDeposit(currentVal) {
    const origEl = document.getElementById('kpi-original-deposit');
    const rawNum = currentVal || '';
    origEl.innerHTML = `
        <input id="deposit-input" type="number" class="deposit-input"
            value="${rawNum}" placeholder="הזן סכום" autocomplete="off">
        <button class="save-deposit-btn" onclick="saveDeposit()">שמור</button>
    `;
    const inp = document.getElementById('deposit-input');
    inp.focus();
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') saveDeposit(); if (e.key === 'Escape') cancelEditDeposit(currentVal); });
}

async function saveDeposit() {
    const inp = document.getElementById('deposit-input');
    if (!inp) return;
    const val = parseFloat(inp.value);

    // Show saving state
    const saveBtn = inp.nextElementSibling;
    if (saveBtn) { saveBtn.textContent = 'שומר...'; saveBtn.disabled = true; }

    if (!isNaN(val) && val > 0) {
        // Try to write to server (Google Sheets)
        let savedToSheet = false;
        try {
            const resp = await fetch(`${SERVER_URL}/deposit`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ value: val }),
                signal: AbortSignal.timeout(5000)
            });
            if (resp.ok) {
                savedToSheet = true;
                localStorage.setItem(ORIGINAL_DEPOSIT_KEY, val);
            }
        } catch {
            // Server not available — fall back to localStorage
        }

        if (!savedToSheet) {
            localStorage.setItem(ORIGINAL_DEPOSIT_KEY, val);
            console.warn('Server unavailable — saved to localStorage only');
        }
    } else {
        localStorage.removeItem(ORIGINAL_DEPOSIT_KEY);
    }

    // Re-render KPIs
    const cached = accountCache[currentGid];
    if (cached) {
        const deposit = parseFloat(localStorage.getItem(ORIGINAL_DEPOSIT_KEY)) || (cached.originalDeposit || 0);
        updateKPIs(cached.assets || cached, deposit);
    }
}

function cancelEditDeposit(originalValue) {
    const cached = accountCache[currentGid];
    if (cached) {
        const storedDeposit = parseFloat(localStorage.getItem(ORIGINAL_DEPOSIT_KEY)) || (cached.originalDeposit || originalValue);
        updateKPIs(cached.assets || cached, storedDeposit);
    }
}

function renderCharts(data) {
    const chartsSection = document.querySelector('.charts-grid');
    if (chartsSection) {
        if (currentGid !== '0') {
            chartsSection.classList.add('hidden');
            return;
        } else {
            chartsSection.classList.remove('hidden');
        }
    }

    if (charts.allocation) charts.allocation.destroy();
    if (charts.performance) charts.performance.destroy();

    const ctxAlloc = document.getElementById('allocationChart').getContext('2d');

    // Group by category/name for allocation
    const allocation = {};
    data.forEach(asset => {
        const key = asset.category || asset.name;
        if (!allocation[key]) allocation[key] = 0;
        allocation[key] += asset.value;
    });

    const allocLabels = Object.keys(allocation);
    const allocValues = Object.values(allocation);

    const bgColors = [
        '#3b82f6', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444',
        '#6366f1', '#14b8a6', '#f43f5e', '#ec4899', '#84cc16'
    ];

    Chart.defaults.color = '#94a3b8';
    Chart.defaults.font.family = 'Outfit';

    charts.allocation = new Chart(ctxAlloc, {
        type: 'doughnut',
        data: {
            labels: allocLabels,
            datasets: [{
                data: allocValues,
                backgroundColor: bgColors.slice(0, allocLabels.length),
                borderWidth: 0,
                hoverOffset: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { position: 'right', rtl: true, labels: { font: { size: 11 } } },
                tooltip: {
                    callbacks: {
                        label: (context) => ` ${context.label}: ${formatILS(context.raw)}`
                    }
                }
            }
        }
    });

    const ctxPerf = document.getElementById('performanceChart').getContext('2d');
    const perfLabels = data.map(a => a.name);
    const perfValues = data.map(a => a.profitPercent);
    const perfColors = perfValues.map(val => val >= 0 ? 'rgba(16, 185, 129, 0.8)' : 'rgba(239, 68, 68, 0.8)');

    charts.performance = new Chart(ctxPerf, {
        type: 'bar',
        data: {
            labels: perfLabels,
            datasets: [{
                label: 'תשואה (%)',
                data: perfValues,
                backgroundColor: perfColors,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { ticks: { display: false }, grid: { display: false } },
                y: { grid: { color: 'rgba(255,255,255,0.05)' } }
            },
            plugins: {
                legend: { display: false }
            }
        }
    });
}

function renderTable(data) {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    // Show dividend column header only if some assets have dividends
    const hasDividends = data.some(a => a.dividend && a.dividend > 0);
    const divHeader = document.getElementById('th-dividend');
    if (divHeader) divHeader.style.display = hasDividends ? '' : 'none';

    // Show profit/return columns only in the "All" view (gid = '0')
    const showProfits = currentGid === '0';
    const profitHeader = document.getElementById('th-profit');
    const returnHeader = document.getElementById('th-return');
    if (profitHeader) profitHeader.style.display = showProfits ? '' : 'none';
    if (returnHeader) returnHeader.style.display = showProfits ? '' : 'none';

    data.forEach(asset => {
        const tr = document.createElement('tr');
        const profitClass = asset.profit >= 0 ? 'positive' : 'negative';
        const profitSign = asset.profit >= 0 ? '+' : '';
        const divCell = hasDividends
            ? `<td class="positive-text">${asset.dividend > 0 ? formatILS(asset.dividend) : '—'}</td>`
            : '';

        const profitCells = showProfits
            ? `<td class="${asset.profit >= 0 ? 'positive-text' : 'negative-text'}">${formatILS(asset.profit)}</td>
               <td>
                   <span class="profit-pill ${profitClass}">
                       ${profitSign}${asset.profitPercent.toFixed(2)}%
                   </span>
               </td>`
            : '';

        tr.innerHTML = `
            <td><strong>${asset.category}</strong></td>
            <td>${asset.name}</td>
            <td><small>${asset.ticker}</small></td>
            <td>${formatILS(asset.cost)}</td>
            <td>${formatILS(asset.value)}</td>
            ${profitCells}
            ${divCell}
        `;
        tbody.appendChild(tr);
    });
}

function filterTable(term) {
    const currentData = accountCache[currentGid] || [];
    const filtered = currentData.filter(asset => {
        return asset.category.toLowerCase().includes(term) ||
            asset.name.toLowerCase().includes(term) ||
            asset.ticker.toLowerCase().includes(term);
    });
    renderTable(filtered);
}

// Helpers
function parseMoney(str) {
    if (!str) return 0;
    const clean = str.replace(/[₪,%"]/g, '').replace('(', '-').replace(')', '');
    return parseFloat(clean) || 0;
}

function formatILS(num) {
    return new Intl.NumberFormat('he-IL', {
        style: 'currency',
        currency: 'ILS',
        maximumFractionDigits: 0,
        minimumFractionDigits: 0
    }).format(num);
}

function toggleLoader(show) {
    const loader = document.getElementById('loader');
    const main = document.getElementById('main-content');
    if (show) {
        loader.classList.remove('hidden');
        main.classList.add('hidden');
    } else {
        loader.classList.add('hidden');
        main.classList.remove('hidden');
        main.style.opacity = 0;
        setTimeout(() => {
            main.style.transition = 'opacity 0.5s ease';
            main.style.opacity = 1;
        }, 50);
    }
}
