const fs = require('fs');
const path = require('path');

const dataFile = path.join(__dirname, 'portfolio_data.json');

const categoryMap = {
    'מדד עולמי': 'מניות - חו"ל',
    'S&P 500': 'מניות - חו"ל',
    'אגח דירוג נמוך ארהב': 'אג"ח סיכון - חו"ל',
    'אגח חברות דירוג גבוה ארהב': 'אג"ח דירוג גבוה - חו"ל',
    'אגח': 'אג"ח דירוג גבוה - ישראל',
    'אגח חברות דירוג גבוה עולמי': 'אג"ח דירוג גבוה - חו"ל',
    'אג"ח שקלי ישראל': 'אג"ח דירוג גבוה - ישראל',
    'תא 125': 'מניות - ישראל',
    'אגח ממשלת ארהב 3-7 שנים': 'אג"ח דירוג גבוה - חו"ל',
    'אגח ממשלת ארהב 1-3 שנים': 'אג"ח דירוג גבוה - חו"ל',
    'אג"ח שקלי ישראל קצר': 'אג"ח דירוג גבוה - ישראל',
    'אג"ח צמוד ישראל': 'אג"ח דירוג גבוה - ישראל'
};

function migrate() {
    try {
        let rawData = fs.readFileSync(dataFile, 'utf-8');
        let db = JSON.parse(rawData);

        // Backup
        fs.writeFileSync(path.join(__dirname, 'portfolio_data_backup.json'), rawData);

        let count = 0;
        for (const key in db.accounts) {
            const acc = db.accounts[key];
            if (acc.assets) {
                acc.assets.forEach(asset => {
                    const original = asset.category;
                    if (categoryMap[original]) {
                        asset.category = categoryMap[original];
                        count++;
                    }
                });
            }
        }

        fs.writeFileSync(dataFile, JSON.stringify(db, null, 4));
        console.log(`Successfully migrated ${count} assets to standard categories.`);
    } catch (err) {
        console.error('Error during migration:', err);
    }
}

migrate();
