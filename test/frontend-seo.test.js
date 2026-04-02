import assert from 'node:assert/strict';
import test from 'node:test';

import { createApiServer } from '../src/api/server.js';
import { loadConfig } from '../src/config/env.js';

test('serves social metadata and crawl discovery files for the homepage', async (t) => {
    const config = loadConfig({
        NODE_ENV: 'test',
        LINKEDIN_JOBS_STORAGE_PROVIDER: 'file',
        LINKEDIN_JOBS_USE_IN_PROCESS_SCHEDULER: 'false',
    });
    const { server } = createApiServer({ config });
    t.after(async () => {
        await server.close();
    });

    const response = await server.inject({
        method: 'GET',
        url: '/',
        headers: {
            host: 'applydesk.example',
            'x-forwarded-proto': 'https',
        },
    });

    assert.equal(response.statusCode, 200);
    assert.match(response.body, /<meta name="description" content="ApplyDesk Cloud helps you stop mass applying/i);
    assert.match(response.body, /<meta property="og:image" content="https:\/\/applydesk\.example\/social-preview\.png">/i);
    assert.match(response.body, /<meta name="twitter:card" content="summary_large_image">/i);
    assert.match(response.body, /<link rel="canonical" href="https:\/\/applydesk\.example\/">/i);
    assert.match(response.body, /<script type="application\/ld\+json">/i);

    const robots = await server.inject({
        method: 'GET',
        url: '/robots.txt',
        headers: {
            host: 'applydesk.example',
            'x-forwarded-proto': 'https',
        },
    });

    assert.equal(robots.statusCode, 200);
    assert.match(robots.body, /Disallow: \/app\//);
    assert.match(robots.body, /Sitemap: https:\/\/applydesk\.example\/sitemap\.xml/);

    const sitemap = await server.inject({
        method: 'GET',
        url: '/sitemap.xml',
        headers: {
            host: 'applydesk.example',
            'x-forwarded-proto': 'https',
        },
    });

    assert.equal(sitemap.statusCode, 200);
    assert.match(sitemap.body, /<loc>https:\/\/applydesk\.example\/<\/loc>/);
    assert.match(sitemap.body, /<loc>https:\/\/applydesk\.example\/terms<\/loc>/);
    assert.match(sitemap.body, /<loc>https:\/\/applydesk\.example\/contact<\/loc>/);

    const socialPreview = await server.inject({
        method: 'GET',
        url: '/social-preview.png',
    });

    assert.equal(socialPreview.statusCode, 200);
    assert.equal(socialPreview.headers['content-type'], 'image/png');
});
