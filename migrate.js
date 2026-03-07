const fs = require('fs');
const axios = require('axios');
const Papa = require('papaparse');
const path = require('path');

const BASE_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1OaBBapoMTT2u4lnoca2CVsLAub9lV-eQb56MI6iffLY/export?format=csv&gid=';
const DATA_FILE = path.join(__dirname, 'portfolio_data.json');

const accounts = {
    "705892337": "סבתא קה\"ש",
    "400753915": "סבתא גמל",
    "1420240376": "סבתא גמל 190",
    "414516043": "סבא קה\"ש",
    "635774371": "סבא גמל",
};

function parseMoney(str) {
    if (!str) return 0;
    const clean = str.replace(/[₪,%"]/g, '').replace('(', '-').replace(')', '');
    return parseFloat(clean) || 0;
}

function processData(rows) {
    const data = [];
    if (!rows || rows.length === 0) return data;

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

    let headerRowIndex = -1;
    for (let i = 0; i < Math.min(rows.length, 10); i++) {
        const row = rows[i];
        if (row.includes('Ticker') || row.includes('טיקר')) {
            headerRowIndex = i;
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

    if (headerRowIndex === -1) {
        headerRowIndex = 0;
        colIndices.cost = 6;
        colIndices.value = 8;
        colIndices.profit = 9;
        colIndices.profitPercent = 10;
        colIndices.dividend = 12;
    }

    for (let i = headerRowIndex + 1; i < rows.length; i++) {
        const row = rows[i];
        const ticker = row[colIndices.ticker];
        const costStr = row[colIndices.cost];

        if (ticker && costStr && (costStr.includes('₪') || costStr.includes('$') || !isNaN(parseMoney(costStr)))) {
            if (ticker.trim() === '' || ticker.includes('סה"כ')) continue;

            const cost = parseMoney(row[colIndices.cost]);
            const quantity = parseMoney(row[colIndices.quantity]) || 1; // Try to extract quantity or default to 1

            if (isNaN(cost)) continue;

            const dividend = colIndices.dividend >= 0 ? parseMoney(row[colIndices.dividend]) : 0;

            // Notice we only need static data: category, name, ticker, quantity, cost, dividend
            // Value and profit are dynamically calculated by server.js
            data.push({
                category: row[colIndices.category] || 'אחר',
                name: row[colIndices.name] || ticker,
                ticker: ticker,
                quantity: quantity,
                cost: cost,
                dividend: dividend
            });
        }
    }

    return data; // just return assets 
}

async function fetchAndParse(gid) {
    console.log(`Fetching tab ${gid}...`);
    const resp = await axios.get(BASE_SHEET_URL + gid);
    const parsed = Papa.parse(resp.data);
    return processData(parsed.data);
}

async function migrate() {
    console.log('Starting migration...');
    const result = {
        originalDeposit: 0,
        accounts: {}
    };

    // 1. Fetch "הכל" tab (gid 0) to get original deposit
    try {
        const resp0 = await axios.get(BASE_SHEET_URL + '0');
        const parsed0 = Papa.parse(resp0.data);
        const rows = parsed0.data;
        if (rows.length > 4 && rows[4].length > 16) {
            result.originalDeposit = parseMoney(rows[4][16]);
            console.log(`Original deposit found: ₪${result.originalDeposit}`);
        }
    } catch (e) {
        console.warn('Could not fetch original deposit.');
    }

    // 2. Fetch specific accounts
    for (const [gid, name] of Object.entries(accounts)) {
        try {
            const assets = await fetchAndParse(gid);
            result.accounts[gid] = {
                name: name,
                assets: assets
            };
            console.log(`  -> Migrated ${assets.length} items for ${name}`);
        } catch (e) {
            console.error(`Error migrating ${name}:`, e.message);
            result.accounts[gid] = { name: name, assets: [] };
        }
    }

    // Write to file
    fs.writeFileSync(DATA_FILE, JSON.stringify(result, null, 2), 'utf8');
    console.log('Migration complete. Saved to portfolio_data.json');
}

migrate();
