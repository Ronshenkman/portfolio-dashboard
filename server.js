const express = require('express');
const cors = require('cors');
const { google } = require('googleapis'); // No longer needed, left for backward compat before cleanup
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Authentication Middleware ────────────────────────────────────────────────
const APP_PASSWORD = process.env.APP_PASSWORD || '010699';
app.use((req, res, next) => {
    // Allow CORS preflight and allow anyone to bypass for specific public endpoints if we had any
    if (req.method === 'OPTIONS') return next();

    const b64auth = (req.headers.authorization || '').split(' ')[1] || '';
    const [login, password] = Buffer.from(b64auth, 'base64').toString().split(':');

    // We allow either username or password to be the required password (just in case they put it in the wrong field)
    if (password === APP_PASSWORD || login === APP_PASSWORD) {
        return next();
    }

    res.set('WWW-Authenticate', 'Basic realm="Portfolio Dashboard"');
    res.status(401).send('Authentication required.');
});

// Removed Google Sheets vars

const fs = require('fs');
const axios = require('axios');
const cheerio = require('cheerio');

const DATA_FILE = path.join(__dirname, 'portfolio_data.json');

// ─── Data Helpers ─────────────────────────────────────────────────────────────
function readData() {
    if (!fs.existsSync(DATA_FILE)) {
        return { originalDeposit: 0, accounts: {} };
    }
    return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

function writeData(data) {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ─── Scraping Helper ──────────────────────────────────────────────────────────
const priceCache = {};
const exchangeRateCache = {};
const CACHE_TTL = 15 * 60 * 1000; // 15 mins

// Fetch exchange rate (e.g., USD→ILS, GBP→ILS) from Yahoo Finance
async function getExchangeRate(currency) {
    if (currency === 'ILA' || currency === 'ILS') return 100; // Already ILS, return ×100 for agorot
    const cacheKey = currency + 'ILS';
    if (exchangeRateCache[cacheKey] && (Date.now() - exchangeRateCache[cacheKey].timestamp < CACHE_TTL)) {
        return exchangeRateCache[cacheKey].rate;
    }
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${cacheKey}=X`;
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
        });
        const rate = data.chart.result[0].meta.regularMarketPrice;
        exchangeRateCache[cacheKey] = { rate, timestamp: Date.now() };
        return rate;
    } catch (err) {
        console.error(`Exchange rate failed for ${currency}:`, err.message);
        return exchangeRateCache[cacheKey]?.rate || 1;
    }
}

// Fetch price from Yahoo Finance for foreign tickers (returns Agorot-equivalent)
async function getLivePriceForeign(ticker, exchange) {
    const yahooTicker = ticker + (exchange === 'LON' ? '.L' : '');
    try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yahooTicker}`;
        const { data } = await axios.get(url, {
            headers: { 'User-Agent': 'Mozilla/5.0' }, timeout: 8000
        });
        const meta = data.chart.result[0].meta;
        const price = meta.regularMarketPrice;
        const currency = meta.currency;

        // Convert foreign price to ILS Agorot: price × exchangeRate × 100
        const rate = await getExchangeRate(currency);
        const priceAgorot = price * rate * 100;

        console.log(`Yahoo: ${yahooTicker} = ${price} ${currency} → ${(priceAgorot / 100).toFixed(2)} ILS`);
        return priceAgorot;
    } catch (err) {
        console.error(`Yahoo failed for ${yahooTicker}:`, err.message);
        return 0;
    }
}

async function getLivePrice(ticker) {
    if (priceCache[ticker] && (Date.now() - priceCache[ticker].timestamp < CACHE_TTL)) {
        return priceCache[ticker].price;
    }

    const isNumeric = /^\d+$/.test(ticker);
    let priceAgorot = 0;

    if (isNumeric) {
        // Israeli ETF — scrape TheMarker (returns Agorot)
        try {
            const url = `https://finance.themarker.com/etf/${ticker}`;
            const { data } = await axios.get(url, {
                headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
                timeout: 8000
            });
            const $ = cheerio.load(data);
            $('*').each((i, el) => {
                if ($(el).children().length === 0) {
                    const text = $(el).text().trim();
                    if (/^\d{1,3}(,\d{3})*\.\d{2}$/.test(text) || /^\d+\.\d{2}$/.test(text)) {
                        if (priceAgorot === 0) priceAgorot = parseFloat(text.replace(/,/g, ''));
                    }
                }
            });
        } catch (err) {
            console.error(`TheMarker failed for ${ticker}:`, err.message);
        }
    } else {
        // Foreign ETF — use Yahoo Finance (returns Agorot-equivalent after conversion)
        // Determine exchange from portfolio data
        const db = readData();
        let exchange = 'LON'; // default
        for (const key in db.accounts) {
            const asset = (db.accounts[key].assets || []).find(a => a.ticker === ticker);
            if (asset && asset.exchange) { exchange = asset.exchange; break; }
        }
        priceAgorot = await getLivePriceForeign(ticker, exchange);
    }

    if (priceAgorot > 0) {
        priceCache[ticker] = { price: priceAgorot, timestamp: Date.now() };
    }
    return priceCache[ticker]?.price || 0;
}

// ─── API Endpoints ────────────────────────────────────────────────────────────

// Get original deposit (backward compatibility with previous frontend version)
app.get('/deposit', (req, res) => {
    try {
        const data = readData();
        res.json({ value: data.originalDeposit || 0 });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update original deposit
app.post('/deposit', (req, res) => {
    const { value } = req.body;
    if (typeof value !== 'number' || isNaN(value) || value < 0) {
        return res.status(400).json({ error: 'Invalid value' });
    }
    try {
        const data = readData();
        data.originalDeposit = value;
        writeData(data);
        res.json({ ok: true, value });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Update quantity and cost for a specific asset in a specific account
app.put('/api/portfolio/:gid/:ticker', (req, res) => {
    try {
        const { gid, ticker } = req.params;
        const { quantity, cost } = req.body;
        const db = readData();

        if (!db.accounts[gid]) {
            return res.status(404).json({ error: 'Account not found' });
        }

        const account = db.accounts[gid];
        const assetIndex = account.assets.findIndex(a => a.ticker === ticker);

        if (assetIndex >= 0) {
            // Update existing asset
            if (quantity !== undefined) account.assets[assetIndex].quantity = Number(quantity);
            if (cost !== undefined) account.assets[assetIndex].cost = Number(cost);
        } else {
            // Asset doesn't exist in this account yet — find it from another account for metadata
            let template = null;
            for (const key in db.accounts) {
                const found = (db.accounts[key].assets || []).find(a => a.ticker === ticker);
                if (found) { template = found; break; }
            }
            if (template) {
                account.assets.push({
                    category: template.category,
                    name: template.name,
                    ticker: ticker,
                    quantity: Number(quantity) || 0,
                    cost: Number(cost) || 0,
                    dividend: 0
                });
            }
        }

        writeData(db);
        res.json({ ok: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Fetch full portfolio data for a specific account (or 0 for all)
app.get('/api/portfolio/:gid', async (req, res) => {
    try {
        const { gid } = req.params;
        const db = readData();
        const assetsRaw = [];

        if (gid === '0') {
            // Aggregate all accounts – merge by ticker
            const merged = {};
            for (const key in db.accounts) {
                for (const asset of (db.accounts[key].assets || [])) {
                    if (merged[asset.ticker]) {
                        merged[asset.ticker].quantity += asset.quantity;
                        merged[asset.ticker].cost += asset.cost;
                        merged[asset.ticker].dividend += (asset.dividend || 0);
                    } else {
                        merged[asset.ticker] = { ...asset, dividend: asset.dividend || 0 };
                    }
                }
            }
            assetsRaw.push(...Object.values(merged));
        } else {
            // Specific account — but include ALL securities from master list
            // Securities not held in this account get quantity=0, cost=0
            const masterTickers = {};
            for (const key in db.accounts) {
                for (const asset of (db.accounts[key].assets || [])) {
                    if (!masterTickers[asset.ticker]) {
                        masterTickers[asset.ticker] = { ...asset, quantity: 0, cost: 0, dividend: 0 };
                    }
                }
            }
            // Override with this account's actual data
            if (db.accounts[gid]) {
                for (const asset of (db.accounts[gid].assets || [])) {
                    masterTickers[asset.ticker] = { ...asset };
                }
            }
            assetsRaw.push(...Object.values(masterTickers));
        }

        // Parallel fetch of live prices for all unique tickers
        const uniqueTickers = [...new Set(assetsRaw.map(a => a.ticker))];
        await Promise.all(uniqueTickers.map(t => getLivePrice(t)));

        // Compute live values
        // Prices are in Agorot, so: value = priceAgorot * quantity / 100
        const assets = assetsRaw.map(asset => {
            const priceAgorot = priceCache[asset.ticker]?.price || 0;
            const priceILS = Math.round(priceAgorot / 100 * 100) / 100; // round to 2 decimals
            const liveValue = priceAgorot * asset.quantity / 100;
            const profit = liveValue - asset.cost;
            const profitPercent = asset.cost > 0 ? (profit / asset.cost) * 100 : 0;

            return {
                ...asset,
                currentPrice: priceILS,
                value: Math.round(liveValue),
                profit: Math.round(profit),
                profitPercent
            };
        });

        res.json({
            originalDeposit: db.originalDeposit,
            assets
        });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Serve the dashboard HTML files statically as well (optional convenience)
app.use(express.static(__dirname));

const PORT = process.env.PORT || 3001;
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🚀 Portfolio server running at http://localhost:${PORT}`);
    console.log(`   Dashboard: http://localhost:${PORT}/index.html`);
    console.log(`   GET  http://localhost:${PORT}/deposit  — read deposit`);
    console.log(`   POST http://localhost:${PORT}/deposit  — write deposit\n`);
});
