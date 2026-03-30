import { gotScraping } from 'got-scraping';

import { DEFAULT_HEADERS } from './constants.js';

export async function fetchHtml(url, { proxyConfiguration, sessionId } = {}) {
    const proxyUrl = proxyConfiguration ? await proxyConfiguration.newUrl(sessionId) : undefined;

    const response = await gotScraping({
        url,
        proxyUrl,
        headers: DEFAULT_HEADERS,
        timeout: {
            request: 45000,
        },
        retry: {
            limit: 2,
        },
    });

    return response.body;
}

export function assertNotBlocked(html, url) {
    const lowerHtml = html.toLowerCase();
    const blockMarkers = [
        'captcha',
        'security verification',
        'let us know you\'re human',
        'challenge-form',
    ];

    if (blockMarkers.some((marker) => lowerHtml.includes(marker))) {
        throw new Error(`LinkedIn appears to be blocking requests for ${url}. Try enabling proxy rotation.`);
    }
}
