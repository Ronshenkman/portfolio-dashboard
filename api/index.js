const url = require('url');
const app = require('../server.js');

module.exports = (req, res) => {
    const parsedUrl = url.parse(req.url, true);
    if (parsedUrl.query && parsedUrl.query.url) {
        let targetUrl = parsedUrl.query.url;
        
        // Re-append other query parameters
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
