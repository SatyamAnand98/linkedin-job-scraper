import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

test('vercel routes include social preview and SEO assets', async () => {
    const vercelConfig = JSON.parse(await readFile(new URL('../vercel.json', import.meta.url), 'utf8'));
    const assetRoute = vercelConfig.routes.find((route) =>
        route.src === '^/(favicon\\.svg|social-preview\\.png|social-preview\\.svg|robots\\.txt|sitemap\\.xml)$',
    );

    assert.ok(assetRoute, 'expected Vercel route for social preview and SEO assets');
    assert.equal(assetRoute.dest, '/api/web?path=/$1');
});
