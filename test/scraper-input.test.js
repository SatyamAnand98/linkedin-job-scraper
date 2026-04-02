import assert from 'node:assert/strict';
import test from 'node:test';

import { normalizeScrapeInput } from '../src/scraper/input.js';

test('uses the 10-job default page size and default crawler timings when omitted', () => {
    const input = normalizeScrapeInput({
        title: 'Product Manager',
    });

    assert.equal(input.rows, 10);
    assert.equal(input.pageNumber, 1);
    assert.equal(input.requestDelayMs, 600);
    assert.equal(input.detailConcurrency, 3);
});
