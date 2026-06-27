const app = require('../server.js');

module.exports = (req, res) => {
    const parsedUrl = new URL(req.url, 'http://localhost');
    const urlParam = parsedUrl.searchParams.get('url');

    if (urlParam !== null) {
        let targetUrl = urlParam || '/';

        // Ensure it starts with /
        if (!targetUrl.startsWith('/')) {
            targetUrl = '/' + targetUrl;
        }

        // Re-append other query parameters (excluding 'url')
        parsedUrl.searchParams.delete('url');
        const search = parsedUrl.searchParams.toString();
        if (search) {
            targetUrl += '?' + search;
        }

        req.url = targetUrl;
    }
    return app(req, res);
};
