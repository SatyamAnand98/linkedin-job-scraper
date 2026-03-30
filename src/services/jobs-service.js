import { randomUUID } from 'node:crypto';

import { Actor } from 'apify';

import { normalizeScrapeInput } from '../scraper/input.js';
import { scrapeLinkedInJobs } from '../scraper/scrape.js';
import { createNoopLogger } from '../scraper/utils.js';
import { createResumeMatcher } from './resume-match-service.js';

async function defaultCreateProxyConfiguration(proxy) {
    return proxy ? Actor.createProxyConfiguration(proxy) : undefined;
}

function httpError(statusCode, message, code = 'bad_request') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function parseOptionalScore(value, fieldName) {
    if (value == null || value === '') {
        return null;
    }

    const parsed = Number.parseFloat(`${value}`);
    if (!Number.isFinite(parsed) || parsed < 1 || parsed > 10) {
        throw httpError(400, `Input field "${fieldName}" must be a number between 1 and 10.`);
    }

    return parsed;
}

function normalizeResumeMatchScoreRange(rawInput = {}, hasResumeInput) {
    let rangeObject = rawInput.resumeMatchScoreRange ?? null;

    if (typeof rangeObject === 'string' && rangeObject.trim()) {
        try {
            rangeObject = JSON.parse(rangeObject);
        } catch {
            throw httpError(400, 'Input field "resumeMatchScoreRange" must be a valid JSON object.');
        }
    }

    if (rangeObject != null && (typeof rangeObject !== 'object' || Array.isArray(rangeObject))) {
        throw httpError(400, 'Input field "resumeMatchScoreRange" must be an object with optional "min" and "max" values.');
    }

    const min = parseOptionalScore(rawInput.resumeMatchMinScore ?? rangeObject?.min, 'resumeMatchMinScore');
    const max = parseOptionalScore(rawInput.resumeMatchMaxScore ?? rangeObject?.max, 'resumeMatchMaxScore');

    if (min == null && max == null) {
        return null;
    }

    if (!hasResumeInput) {
        throw httpError(400, 'Provide "resumeUrl" or "resumeFile" when using resume match score filtering.');
    }

    const range = {
        min: min ?? 1,
        max: max ?? 10,
    };

    if (range.min > range.max) {
        throw httpError(400, '"resumeMatchMinScore" cannot be greater than "resumeMatchMaxScore".');
    }

    return range;
}

function isAdminIdentity(identity) {
    return identity?.role === 'admin';
}

function canAccessOwnedResource(resource, identity) {
    if (!resource) {
        return false;
    }

    if (!resource.ownerClientId || isAdminIdentity(identity)) {
        return true;
    }

    return resource.ownerClientId === identity?.clientId;
}

export function createJobsService({
    logger = createNoopLogger(),
    runRepository,
    createProxyConfiguration = defaultCreateProxyConfiguration,
    scrapeJobs = scrapeLinkedInJobs,
} = {}) {
    async function searchWithOptionalResumeMatch(rawInput) {
        const { resumeUrl = null, resumeFile = null, ...scrapeInput } = rawInput ?? {};
        const resumeMatchScoreRange = normalizeResumeMatchScoreRange(rawInput, Boolean(resumeUrl || resumeFile));
        const input = normalizeScrapeInput(scrapeInput);
        const proxyConfiguration = await createProxyConfiguration(input.proxy);
        const resumeMatcher = await createResumeMatcher({ resumeUrl, resumeFile });
        const result = await scrapeJobs(input, {
            normalizedInput: true,
            proxyConfiguration,
            logger,
        });

        if (!resumeMatcher) {
            return result;
        }

        const scoredItems = result.items.map((item) => ({
            ...item,
            resumeMatch: resumeMatcher.scoreJob(item),
        }));
        const filteredItems = resumeMatchScoreRange
            ? scoredItems.filter((item) =>
                item.resumeMatch.score >= resumeMatchScoreRange.min
                && item.resumeMatch.score <= resumeMatchScoreRange.max)
            : scoredItems;

        return {
            ...result,
            items: filteredItems,
            resumeMatchScoredCount: scoredItems.length,
            resumeMatchScoreRangeApplied: resumeMatchScoreRange,
        };
    }

    return {
        async search(rawInput) {
            return searchWithOptionalResumeMatch(rawInput);
        },

        async createRun(rawInput, { identity } = {}) {
            if (!runRepository) {
                throw new Error('Run repository is required for createRun().');
            }

            const input = normalizeScrapeInput(rawInput);
            const runId = randomUUID();
            const createdAt = new Date().toISOString();

            await runRepository.saveRun({
                id: runId,
                status: 'running',
                createdAt,
                updatedAt: createdAt,
                itemCount: 0,
                ownerClientId: identity?.clientId ?? null,
                ownerEmail: identity?.email ?? null,
                input,
                items: [],
            });

            try {
                const proxyConfiguration = await createProxyConfiguration(input.proxy);
                const result = await scrapeJobs(input, {
                    normalizedInput: true,
                    proxyConfiguration,
                    logger,
                });

                const completedRun = {
                    id: runId,
                    status: 'succeeded',
                    createdAt,
                    updatedAt: new Date().toISOString(),
                    completedAt: new Date().toISOString(),
                    itemCount: result.items.length,
                    ownerClientId: identity?.clientId ?? null,
                    ownerEmail: identity?.email ?? null,
                    input: result.input,
                    pagesScanned: result.pagesScanned,
                    totalUniqueJobsSeen: result.totalUniqueJobsSeen,
                    items: result.items,
                };

                await runRepository.saveRun(completedRun);
                return completedRun;
            } catch (error) {
                const failedRun = {
                    id: runId,
                    status: 'failed',
                    createdAt,
                    updatedAt: new Date().toISOString(),
                    completedAt: new Date().toISOString(),
                    itemCount: 0,
                    ownerClientId: identity?.clientId ?? null,
                    ownerEmail: identity?.email ?? null,
                    input,
                    items: [],
                    errorMessage: error.message,
                };

                await runRepository.saveRun(failedRun);
                return failedRun;
            }
        },

        async getRun(runId, { identity } = {}) {
            if (!runRepository) {
                throw new Error('Run repository is required for getRun().');
            }

            const run = await runRepository.getRun(runId);
            return canAccessOwnedResource(run, identity) ? run : null;
        },

        async getRunItems(runId, { identity } = {}) {
            if (!runRepository) {
                throw new Error('Run repository is required for getRunItems().');
            }

            const run = await runRepository.getRun(runId);
            return canAccessOwnedResource(run, identity) ? (run.items ?? []) : null;
        },
    };
}
