const url = require('url');
const app = require('../server.js');

module.exports = (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.query && parsedUrl.query.url !== undefined) {
        let targetUrl = parsedUrl.query.url || '/';

        // Ensure it starts with /
        if (!targetUrl.startsWith('/')) {
            targetUrl = '/' + targetUrl;
        }

        // Re-append other query parameters (excluding our own 'url' key)
        const queryParams = { ...parsedUrl.query };
        delete queryParams.url;

        const searchParams = new URLSearchParams(queryParams).toString();
        if (searchParams) {
            targetUrl += '?' + searchParams;
        }

        req.url = targetUrl;
    }
    return app(req, res);
};
