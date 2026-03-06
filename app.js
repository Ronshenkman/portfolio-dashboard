const ORIGINAL_DEPOSIT_KEY = 'portfolioDashboard_originalDeposit';
// Determine server URL: if on localhost use absolute path for local dev, otherwise use relative path for production
const SERVER_URL = window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' ? 'http://localhost:3001' : '';

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

async function initApp() {
    toggleLoader(true);

    if (accountCache[currentGid]) {
        renderWithData(accountCache[currentGid]);
        toggleLoader(false);
        return;
    }

    try {
        const response = await fetch(`${SERVER_URL}/api/portfolio/${currentGid}`);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const data = await response.json();

        accountCache[currentGid] = data;
        renderWithData(data);
        toggleLoader(false);
    } catch (error) {
        console.error('Failed to fetch from server:', error);
        alert('שגיאה בטעינת הנתונים מהשרת. כנראה השרת לא רץ.');
        toggleLoader(false);
    }
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

    // Profit on open positions (now includes dividends)
    const totalProfit = totalValue - totalCost + totalDividend;
    const totalPercent = totalCost > 0 ? (totalProfit / totalCost) * 100 : 0;

    document.getElementById('kpi-total-value').innerText = formatILS(totalValue);
    document.getElementById('kpi-total-cost').innerText = formatILS(totalCost);

    const profitEl = document.getElementById('kpi-total-profit');
    profitEl.innerText = formatILS(totalProfit);
    profitEl.className = totalProfit >= 0 ? 'positive-text' : 'negative-text';

    const percentEl = document.getElementById('kpi-total-percent');
    percentEl.innerText = totalPercent.toFixed(2) + '%';
    percentEl.className = totalPercent >= 0 ? 'positive-text' : 'negative-text';


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

    // Calculate portfolio totals for contribution
    let totalPProfit = 0;
    let totalPCost = 0;
    data.forEach(a => {
        totalPProfit += a.profit;
        totalPCost += a.cost;
    });
    const totalPYield = totalPCost > 0 ? (totalPProfit / totalPCost) * 100 : 0;

    const perfValues = data.map(a => {
        if (totalPProfit === 0) return 0;
        return totalPYield * (a.profit / totalPProfit);
    });

    const perfColors = perfValues.map(val => val >= 0 ? 'rgba(16, 185, 129, 0.8)' : 'rgba(239, 68, 68, 0.8)');

    charts.performance = new Chart(ctxPerf, {
        type: 'bar',
        data: {
            labels: perfLabels,
            datasets: [{
                label: 'תרומה לתשואה (%)',
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
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (context) => ` ${context.label}: ${context.raw.toFixed(2)}%`
                    }
                }
            }
        }
    });
}

function renderTable(data) {
    const tbody = document.getElementById('table-body');
    tbody.innerHTML = '';

    const isAllView = currentGid === '0';

    // Dividend column is visible only in specific account views
    const divHeader = document.getElementById('th-dividend');
    if (divHeader) divHeader.style.display = isAllView ? 'none' : '';

    // Show profit/return columns only in the "All" view (gid = '0')
    const showProfits = isAllView;
    const profitHeader = document.getElementById('th-profit');
    const returnHeader = document.getElementById('th-return');
    const contribHeader = document.getElementById('th-contribution');
    if (profitHeader) profitHeader.style.display = showProfits ? '' : 'none';
    if (returnHeader) returnHeader.style.display = showProfits ? '' : 'none';
    if (contribHeader) contribHeader.style.display = showProfits ? '' : 'none';

    // Calculate portfolio totals for contribution calculation
    let totalPortfolioProfit = 0;
    let totalPortfolioCost = 0;
    if (showProfits) {
        data.forEach(asset => {
            totalPortfolioProfit += asset.profit;
            totalPortfolioCost += asset.cost;
        });
    }
    const totalPortfolioYield = totalPortfolioCost > 0 ? (totalPortfolioProfit / totalPortfolioCost) * 100 : 0;

    data.forEach(asset => {
        const tr = document.createElement('tr');
        const profitClass = asset.profit >= 0 ? 'positive' : 'negative';
        const profitSign = asset.profit >= 0 ? '+' : '';
        const divValue = asset.dividend || 0;

        let contributionCells = '';
        if (showProfits) {
            const contribution = (totalPortfolioProfit !== 0)
                ? totalPortfolioYield * (asset.profit / totalPortfolioProfit)
                : 0;
            const contribClass = contribution >= 0 ? 'positive-text' : 'negative-text';
            const contribSign = contribution >= 0 ? '+' : '';

            contributionCells = `
                <td class="${asset.profit >= 0 ? 'positive-text' : 'negative-text'}">${formatILS(asset.profit)}</td>
                <td>
                    <span class="profit-pill ${profitClass}">
                        ${profitSign}${asset.profitPercent.toFixed(2)}%
                    </span>
                </td>
                <td class="${contribClass}">
                    ${contribSign}${contribution.toFixed(2)}%
                </td>
            `;
        }

        const divCell = !isAllView
            ? `<td class="editable-cell positive-text" data-field="dividend" data-ticker="${asset.ticker}">${divValue > 0 ? formatILS(divValue) : '—'}</td>`
            : '';

        const priceDisplay = asset.currentPrice > 0 ? '₪' + asset.currentPrice.toFixed(2) : 'לא זמין';

        tr.innerHTML = `
            <td class="${isAllView ? 'meta-editable-cell' : ''}" data-meta-field="category" data-ticker="${asset.ticker}"><strong>${asset.category}</strong></td>
            <td class="${isAllView ? 'meta-editable-cell' : ''}" data-meta-field="name" data-ticker="${asset.ticker}">${asset.name}</td>
            <td class="${isAllView ? 'meta-editable-cell' : ''}" data-meta-field="ticker" data-ticker="${asset.ticker}"><small>${asset.ticker}</small></td>
            <td class="${!isAllView ? 'editable-cell' : ''}" data-field="quantity" data-ticker="${asset.ticker}">${asset.quantity}</td>
            <td>${priceDisplay}</td>
            <td class="${!isAllView ? 'editable-cell' : ''}" data-field="cost" data-ticker="${asset.ticker}">${formatILS(asset.cost)}</td>
            <td>${formatILS(asset.value)}</td>
            ${contributionCells}
            ${divCell}
        `;

        // Add click-to-edit for editable cells (quantity/cost/dividend in account views)
        if (!isAllView) {
            tr.querySelectorAll('.editable-cell').forEach(cell => {
                cell.addEventListener('click', () => startCellEdit(cell, asset));
            });
        }

        // Add click-to-edit for metadata cells (category/name/ticker in All view)
        if (isAllView) {
            tr.querySelectorAll('.meta-editable-cell').forEach(cell => {
                cell.addEventListener('click', () => startMetaEdit(cell, asset));
            });
        }

        tbody.appendChild(tr);
    });
}

function startMetaEdit(cell, asset) {
    if (cell.querySelector('input')) return;

    const field = cell.dataset.metaField;
    const rawValue = asset[field];

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'cell-edit-input';
    input.value = rawValue;

    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    const save = () => saveMetaEdit(cell, asset, field, input.value);
    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { input.removeEventListener('blur', save); save(); }
        if (e.key === 'Escape') {
            input.removeEventListener('blur', save);
            cell.innerHTML = field === 'category' ? `<strong>${rawValue}</strong>` : (field === 'ticker' ? `<small>${rawValue}</small>` : rawValue);
        }
    });
}

async function saveMetaEdit(cell, asset, field, newValue) {
    if (!newValue.trim()) {
        cell.innerHTML = field === 'category' ? `<strong>${asset[field]}</strong>` : (field === 'ticker' ? `<small>${asset[field]}</small>` : asset[field]);
        return;
    }

    cell.textContent = '...';

    try {
        const body = {};
        body[field] = newValue.trim();

        const resp = await fetch(`${SERVER_URL}/api/asset/${encodeURIComponent(asset.ticker)}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!resp.ok) throw new Error('Save failed');

        // Clear all caches and refresh
        for (const key in accountCache) delete accountCache[key];
        await initApp();
    } catch (err) {
        console.error('Failed to save metadata:', err);
        cell.innerHTML = field === 'category' ? `<strong>${asset[field]}</strong>` : (field === 'ticker' ? `<small>${asset[field]}</small>` : asset[field]);
        alert('שגיאה בשמירת הנתונים');
    }
}

function startCellEdit(cell, asset) {
    if (cell.querySelector('input')) return; // already editing

    const field = cell.dataset.field;
    const rawValue = field === 'quantity' ? asset.quantity : (field === 'cost' ? asset.cost : (asset.dividend || 0));

    const input = document.createElement('input');
    input.type = 'number';
    input.className = 'cell-edit-input';
    input.value = rawValue;
    input.step = field === 'quantity' ? '1' : '1';

    cell.textContent = '';
    cell.appendChild(input);
    input.focus();
    input.select();

    const save = () => saveCellEdit(cell, asset, field, input.value);
    input.addEventListener('blur', save);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { input.removeEventListener('blur', save); save(); }
        if (e.key === 'Escape') {
            input.removeEventListener('blur', save);
            cell.textContent = field === 'quantity' ? rawValue : formatILS(rawValue);
        }
    });
}

async function saveCellEdit(cell, asset, field, newValue) {
    const numValue = Number(newValue);
    if (isNaN(numValue) || numValue < 0) {
        cell.textContent = field === 'quantity' ? asset[field] : formatILS(asset[field]);
        return;
    }

    cell.textContent = '...';

    try {
        const body = {};
        body[field] = numValue;

        const resp = await fetch(`${SERVER_URL}/api/portfolio/${currentGid}/${asset.ticker}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });

        if (!resp.ok) throw new Error('Save failed');

        // Clear cache and refresh
        delete accountCache[currentGid];
        delete accountCache['0']; // Also clear "All" cache since it sums
        await initApp();
    } catch (err) {
        console.error('Failed to save:', err);
        cell.textContent = field === 'quantity' ? asset[field] : formatILS(asset[field]);
        alert('שגיאה בשמירת הנתונים');
    }
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
