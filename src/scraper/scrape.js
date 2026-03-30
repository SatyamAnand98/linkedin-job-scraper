import { randomUUID } from 'node:crypto';

import { EMPTY_PAGE_LIMIT, SEARCH_PAGE_SIZE } from './constants.js';
import { assertNotBlocked, fetchHtml } from './http.js';
import { normalizeScrapeInput } from './input.js';
import {
    buildDetailUrl,
    buildSearchUrl,
    extractSearchCards,
    matchesCompanyName,
    parseJobDetail,
} from './parsers.js';
import { chunk, createNoopLogger, sleep } from './utils.js';

function computeMaxPages(input) {
    const requestedWindowSize = input.rows * input.pageNumber;
    const basePages = Math.ceil(requestedWindowSize / SEARCH_PAGE_SIZE);
    const multiplier = input.companyName.length > 0 && input.companyId.length === 0 ? 8 : 3;
    return Math.max(basePages * multiplier, 10);
}

export async function scrapeLinkedInJobs(rawInput, options = {}) {
    const input = options.normalizedInput ? rawInput : normalizeScrapeInput(rawInput);
    const logger = options.logger ?? createNoopLogger();
    const proxyConfiguration = options.proxyConfiguration;
    const sessionId = options.sessionId ?? randomUUID();
    const onItem = options.onItem ?? (async () => {});

    const items = [];
    const seenJobIds = new Set();
    const maxPages = computeMaxPages(input);
    const jobsToSkip = (input.pageNumber - 1) * input.rows;
    let skippedJobs = 0;
    let searchPageNumber = 0;
    let start = 0;
    let emptyPages = 0;
    let pagesScanned = 0;

    while (items.length < input.rows && searchPageNumber < maxPages && emptyPages < EMPTY_PAGE_LIMIT) {
        const searchUrl = buildSearchUrl(input, start);
        logger.info('Fetching search page', {
            pageNumber: searchPageNumber + 1,
            requestedPageNumber: input.pageNumber,
            start,
            searchUrl,
        });

        const searchHtml = await fetchHtml(searchUrl, { proxyConfiguration, sessionId });
        pagesScanned += 1;
        assertNotBlocked(searchHtml, searchUrl);

        const matchingCards = extractSearchCards(searchHtml)
            .filter((card) => !seenJobIds.has(card.jobId))
            .filter((card) => (input.companyId.length > 0 ? true : matchesCompanyName(card.companyName, input.companyName)));

        if (matchingCards.length === 0) {
            emptyPages += 1;
            searchPageNumber += 1;
            start += SEARCH_PAGE_SIZE;
            await sleep(input.requestDelayMs);
            continue;
        }

        emptyPages = 0;

        for (const card of matchingCards) {
            seenJobIds.add(card.jobId);
        }

        let cards = matchingCards;
        if (skippedJobs < jobsToSkip) {
            const cardsToSkip = Math.min(cards.length, jobsToSkip - skippedJobs);
            skippedJobs += cardsToSkip;
            cards = cards.slice(cardsToSkip);
        }

        if (cards.length === 0) {
            searchPageNumber += 1;
            start += SEARCH_PAGE_SIZE;
            await sleep(input.requestDelayMs);
            continue;
        }

        const remaining = input.rows - items.length;
        const pendingCards = cards.slice(0, remaining);

        for (const cardBatch of chunk(pendingCards, input.detailConcurrency)) {
            const batchResults = await Promise.all(
                cardBatch.map(async (card) => {
                    try {
                        const detailHtml = await fetchHtml(buildDetailUrl(card.jobId), {
                            proxyConfiguration,
                            sessionId,
                        });
                        assertNotBlocked(detailHtml, card.url);
                        return parseJobDetail(card, detailHtml, input);
                    } catch (error) {
                        logger.warn('Failed to scrape job detail page', {
                            jobId: card.jobId,
                            url: card.url,
                            error: error.message,
                        });
                        return null;
                    }
                }),
            );

            for (const item of batchResults) {
                if (!item) {
                    continue;
                }

                items.push(item);
                await onItem(item);

                if (items.length >= input.rows) {
                    return {
                        items,
                        input,
                        pagesScanned,
                        totalUniqueJobsSeen: seenJobIds.size,
                    };
                }
            }

            await sleep(input.requestDelayMs);
        }

        if (matchingCards.length < SEARCH_PAGE_SIZE) {
            break;
        }

        searchPageNumber += 1;
        start += SEARCH_PAGE_SIZE;
        await sleep(input.requestDelayMs);
    }

    return {
        items,
        input,
        pagesScanned,
        totalUniqueJobsSeen: seenJobIds.size,
    };
}
