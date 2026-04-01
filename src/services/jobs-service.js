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

function normalizeBoolean(value, defaultValue = false) {
    if (value == null || value === '') {
        return defaultValue;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    const normalized = `${value}`.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }

    return defaultValue;
}

function normalizeAppliedJobId(jobId) {
    const normalized = `${jobId ?? ''}`.trim();
    if (!normalized) {
        throw httpError(400, 'A valid "jobId" is required.', 'bad_request');
    }

    return normalized;
}

function scoreItemsWithResumeMatcher(items, resumeMatcher) {
    return items.map((item) => ({
        ...item,
        resumeMatch: resumeMatcher.scoreJob(item),
    }));
}

function filterItemsByResumeMatchScoreRange(items, resumeMatchScoreRange) {
    if (!resumeMatchScoreRange) {
        return items;
    }

    return items.filter((item) =>
        item.resumeMatch.score >= resumeMatchScoreRange.min
        && item.resumeMatch.score <= resumeMatchScoreRange.max);
}

function filterItemsByAppliedJobIds(items, appliedJobIds) {
    if (!appliedJobIds || appliedJobIds.size === 0) {
        return items;
    }

    return items.filter((item) => !item.jobId || !appliedJobIds.has(item.jobId));
}

async function searchFilteredResults({
    input,
    logger,
    proxyConfiguration,
    resumeMatcher,
    resumeMatchScoreRange,
    appliedJobIds,
    scrapeJobs,
}) {
    const targetFilteredCount = input.pageNumber * input.rows;
    const sliceStart = (input.pageNumber - 1) * input.rows;
    const sliceEnd = sliceStart + input.rows;
    const filteredItems = [];
    const seenJobIds = new Set();
    let rawPageNumber = 1;
    let pagesScanned = 0;
    let resumeMatchScoredCount = 0;

    while (filteredItems.length < targetFilteredCount) {
        const rawResult = await scrapeJobs({
            ...input,
            pageNumber: rawPageNumber,
        }, {
            normalizedInput: true,
            proxyConfiguration,
            logger,
        });
        const scoredItems = (resumeMatcher ? scoreItemsWithResumeMatcher(rawResult.items, resumeMatcher) : rawResult.items)
            .filter((item) => {
                if (!item.jobId || seenJobIds.has(item.jobId)) {
                    return false;
                }

                seenJobIds.add(item.jobId);
                return true;
            });

        if (resumeMatcher) {
            resumeMatchScoredCount += scoredItems.length;
        }

        filteredItems.push(...filterItemsByAppliedJobIds(
            filterItemsByResumeMatchScoreRange(scoredItems, resumeMatchScoreRange),
            appliedJobIds,
        ));
        pagesScanned += rawResult.pagesScanned ?? 0;

        if (rawResult.items.length < input.rows) {
            break;
        }

        rawPageNumber += 1;
    }

    return {
        input,
        items: filteredItems.slice(sliceStart, sliceEnd),
        pagesScanned,
        totalUniqueJobsSeen: seenJobIds.size,
        ...(resumeMatcher ? { resumeMatchScoredCount } : {}),
        ...(resumeMatchScoreRange ? { resumeMatchScoreRangeApplied: resumeMatchScoreRange } : {}),
    };
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
    userRepository = null,
    createProxyConfiguration = defaultCreateProxyConfiguration,
    scrapeJobs = scrapeLinkedInJobs,
    createResumeMatcherFactory = createResumeMatcher,
} = {}) {
    function assertAppliedJobsConfigured() {
        if (!userRepository?.listAppliedJobs || !userRepository?.addAppliedJob || !userRepository?.removeAppliedJob || !userRepository?.clearAppliedJobs) {
            throw httpError(501, 'Applied-job persistence is not configured.', 'applied_jobs_not_configured');
        }
    }

    async function listStoredAppliedJobs(identity) {
        if (!userRepository?.listAppliedJobs || !identity?.clientId) {
            return [];
        }

        return userRepository.listAppliedJobs(identity.clientId);
    }

    async function searchWithOptionalResumeMatch(rawInput, { identity, includeApplied = false } = {}) {
        const { resumeUrl = null, resumeFile = null, ...scrapeInput } = rawInput ?? {};
        const resumeMatchScoreRange = normalizeResumeMatchScoreRange(rawInput, Boolean(resumeUrl || resumeFile));
        const input = normalizeScrapeInput(scrapeInput);
        const proxyConfiguration = await createProxyConfiguration(input.proxy);
        const resumeMatcher = await createResumeMatcherFactory({ resumeUrl, resumeFile });
        const storedAppliedJobs = normalizeBoolean(includeApplied)
            ? []
            : (await listStoredAppliedJobs(identity)) ?? [];
        const appliedJobIds = new Set(storedAppliedJobs.map((entry) => `${entry?.jobId ?? entry}`));

        if (resumeMatchScoreRange || appliedJobIds.size > 0) {
            return searchFilteredResults({
                input,
                logger,
                proxyConfiguration,
                resumeMatcher,
                resumeMatchScoreRange,
                appliedJobIds,
                scrapeJobs,
            });
        }

        const result = await scrapeJobs(input, {
            normalizedInput: true,
            proxyConfiguration,
            logger,
        });

        if (!resumeMatcher) {
            return result;
        }

        const scoredItems = scoreItemsWithResumeMatcher(result.items, resumeMatcher);

        return {
            ...result,
            items: scoredItems,
            resumeMatchScoredCount: scoredItems.length,
        };
    }

    return {
        async search(rawInput, options = {}) {
            return searchWithOptionalResumeMatch(rawInput, options);
        },

        async listAppliedJobs({ identity } = {}) {
            assertAppliedJobsConfigured();
            const items = await listStoredAppliedJobs(identity);
            return {
                count: items.length,
                items,
            };
        },

        async markAppliedJob(jobId, { identity } = {}) {
            assertAppliedJobsConfigured();
            const item = await userRepository.addAppliedJob(identity?.clientId, normalizeAppliedJobId(jobId));
            if (!item) {
                throw httpError(404, 'User profile not found.', 'not_found');
            }

            return item;
        },

        async unmarkAppliedJob(jobId, { identity } = {}) {
            assertAppliedJobsConfigured();
            const removed = await userRepository.removeAppliedJob(identity?.clientId, normalizeAppliedJobId(jobId));
            if (!removed) {
                throw httpError(404, 'User profile not found.', 'not_found');
            }

            return removed;
        },

        async clearAppliedJobs({ identity } = {}) {
            assertAppliedJobsConfigured();
            const cleared = await userRepository.clearAppliedJobs(identity?.clientId);
            if (!cleared) {
                throw httpError(404, 'User profile not found.', 'not_found');
            }

            return cleared;
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
