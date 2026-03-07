const axios = require('axios');
const cheerio = require('cheerio');

async function testScrape(ticker) {
    try {
        const url = `https://finance.themarker.com/etf/${ticker}`;
        const { data } = await axios.get(url, {
            headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
        });
        const $ = cheerio.load(data);

        // Let's print the title
        console.log('Title:', $('h1').first().text().trim());

        // Find numbers that look like prices
        const priceCandidates = [];
        $('*').each((i, el) => {
            if ($(el).children().length === 0) {
                const text = $(el).text().trim();
                // match numbers like 123.45 or 1,234.56
                if (/^\d{1,3}(,\d{3})*\.\d{2}$/.test(text) || /^\d+\.\d{2}$/.test(text)) {
                    priceCandidates.push(text);
                }
            }
        });

        console.log('Possible prices:', priceCandidates.slice(0, 10));

        // TheMarker often uses specific classes for the big price in the header, like .price or similar.
        // Also look at the element the xpath targets: /html/body/div[1]/div[4]/main/div/div[1]/div[2]/div/div[1]/div[1]/div[1]/span[2]
        // Let's just find the largest price font or the one next to the title usually it is the first or second one.
    } catch (err) {
        console.error('Error:', err.message);
    }
}

testScrape('1159250');
