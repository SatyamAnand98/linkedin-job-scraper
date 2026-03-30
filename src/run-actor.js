import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

import { Actor, log } from 'apify';

import { normalizeScrapeInput } from './scraper/input.js';
import { scrapeLinkedInJobs } from './scraper/scrape.js';

async function loadActorInput() {
    const actorInput = await Actor.getInput();
    if (actorInput) {
        return actorInput;
    }

    try {
        const inputText = await readFile(new URL('../INPUT.json', import.meta.url), 'utf8');
        return JSON.parse(inputText);
    } catch {
        return {};
    }
}

function createActorLogger() {
    return {
        info(message, metadata) {
            log.info(message, metadata);
        },
        warn(message, metadata) {
            log.warning(message, metadata);
        },
        error(message, metadata) {
            log.error(message, metadata);
        },
    };
}

export async function runActor() {
    await Actor.init();

    try {
        const rawInput = await loadActorInput();
        const input = normalizeScrapeInput(rawInput);
        const proxyConfiguration = input.proxy ? await Actor.createProxyConfiguration(input.proxy) : undefined;

        log.info('Starting LinkedIn jobs scrape', {
            title: input.title,
            location: input.location,
            companyName: input.companyName,
            companyId: input.companyId,
            rows: input.rows,
            proxy: Boolean(proxyConfiguration),
        });

        const result = await scrapeLinkedInJobs(input, {
            normalizedInput: true,
            proxyConfiguration,
            sessionId: randomUUID(),
            logger: createActorLogger(),
            onItem: async (item) => {
                await Actor.pushData(item);
            },
        });

        if (result.items.length === 0) {
            log.warning('No jobs were scraped for the provided input.');
        } else {
            log.info('Scrape finished', {
                scrapedCount: result.items.length,
                pagesScanned: result.pagesScanned,
            });
        }

        return result;
    } catch (error) {
        log.exception(error, 'LinkedIn jobs scrape failed');
        throw error;
    } finally {
        await Actor.exit();
    }
}
