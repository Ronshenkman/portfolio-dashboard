const express = require('express');
const cors = require('cors');
const { google } = require('googleapis');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// ─── Config ───────────────────────────────────────────────────────────────────
const SPREADSHEET_ID = '1OaBBapoMTT2u4lnoca2CVsLAub9lV-eQb56MI6iffLY';
const SERVICE_ACCOUNT_FILE = path.join(__dirname, 'credentials.json.json');

// The cell that holds "סכום מקורי" VALUE in the 'הכל' sheet
// Based on the user's latest update, this is located at Q5
const DEPOSIT_CELL = "'הכל'!Q5";
// ──────────────────────────────────────────────────────────────────────────────

async function getSheetsClient() {
    let auth;
    if (process.env.GOOGLE_CREDENTIALS) {
        // Use environment variable for deployment
        const credentials = JSON.parse(process.env.GOOGLE_CREDENTIALS);
        auth = new google.auth.GoogleAuth({
            credentials,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
    } else {
        // Fallback to local file for development
        auth = new google.auth.GoogleAuth({
            keyFile: SERVICE_ACCOUNT_FILE,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
    }
    const authClient = await auth.getClient();
    return google.sheets({ version: 'v4', auth: authClient });
}

// GET /deposit — read the current original deposit from the sheet
app.get('/deposit', async (req, res) => {
    try {
        const sheets = await getSheetsClient();
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: DEPOSIT_CELL,
        });
        const raw = response.data.values?.[0]?.[0] || '0';
        // Strip currency symbols and commas for clean number
        const value = parseFloat(raw.replace(/[₪,\s]/g, '')) || 0;
        res.json({ value });
    } catch (err) {
        console.error('GET /deposit error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// POST /deposit — write a new original deposit value to the sheet
// Body: { value: 2345609 }
app.post('/deposit', async (req, res) => {
    const { value } = req.body;
    if (typeof value !== 'number' || isNaN(value) || value < 0) {
        return res.status(400).json({ error: 'Invalid value' });
    }
    try {
        const sheets = await getSheetsClient();
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: DEPOSIT_CELL,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [[value]] },
        });
        console.log(`✅ Updated deposit to ₪${value.toLocaleString()}`);
        res.json({ ok: true, value });
    } catch (err) {
        console.error('POST /deposit error:', err.message);
        res.status(500).json({ error: err.message });
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
