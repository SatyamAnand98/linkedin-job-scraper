import assert from 'node:assert/strict';
import test from 'node:test';

import { createJobsService } from '../src/services/jobs-service.js';

function createJob(jobId, score) {
    return {
        jobId: `${jobId}`,
        title: `Job ${jobId}`,
        url: `https://example.com/jobs/${jobId}`,
        mockScore: score,
    };
}

function createResumeMatcherFactory() {
    return async () => ({
        scoreJob(item) {
            return {
                score: item.mockScore,
            };
        },
    });
}

test('fills the requested filtered page when resume score filtering removes jobs from the first raw page', async () => {
    const pages = new Map([
        [1, [10, 9, 8, 7, 7, 8, 6, 5, 4, 3].map((score, index) => createJob(index + 1, score))],
        [2, [10, 9, 8, 7, 7, 8, 9, 6, 5, 4].map((score, index) => createJob(index + 11, score))],
    ]);
    const calls = [];
    const jobsService = createJobsService({
        createProxyConfiguration: async () => undefined,
        createResumeMatcherFactory: createResumeMatcherFactory(),
        scrapeJobs: async (input) => {
            calls.push({
                pageNumber: input.pageNumber,
                rows: input.rows,
            });

            return {
                input,
                items: pages.get(input.pageNumber) ?? [],
                pagesScanned: input.pageNumber,
            };
        },
    });

    const result = await jobsService.search({
        title: 'Software Engineer',
        rows: 10,
        pageNumber: 1,
        resumeUrl: 'https://example.com/resume.pdf',
        resumeMatchMinScore: 7,
        resumeMatchMaxScore: 10,
    });

    assert.deepEqual(calls, [
        { pageNumber: 1, rows: 10 },
        { pageNumber: 2, rows: 10 },
    ]);
    assert.equal(result.items.length, 10);
    assert.deepEqual(result.items.map((item) => item.jobId), ['1', '2', '3', '4', '5', '6', '11', '12', '13', '14']);
    assert.equal(result.resumeMatchScoredCount, 20);
    assert.equal(result.pagesScanned, 3);
    assert.deepEqual(result.resumeMatchScoreRangeApplied, { min: 7, max: 10 });
});

test('applies pagination after resume score filtering for later filtered pages', async () => {
    const pages = new Map([
        [1, [10, 9, 8, 7, 7, 8, 9, 6, 5, 4].map((score, index) => createJob(index + 1, score))],
        [2, [10, 9, 8, 7, 7, 8, 9, 6, 5, 4].map((score, index) => createJob(index + 11, score))],
        [3, [10, 9, 8, 7, 7, 8, 9, 6, 5, 4].map((score, index) => createJob(index + 21, score))],
    ]);
    const calls = [];
    const jobsService = createJobsService({
        createProxyConfiguration: async () => undefined,
        createResumeMatcherFactory: createResumeMatcherFactory(),
        scrapeJobs: async (input) => {
            calls.push(input.pageNumber);

            return {
                input,
                items: pages.get(input.pageNumber) ?? [],
                pagesScanned: 1,
            };
        },
    });

    const result = await jobsService.search({
        title: 'Software Engineer',
        rows: 10,
        pageNumber: 2,
        resumeUrl: 'https://example.com/resume.pdf',
        resumeMatchMinScore: 7,
        resumeMatchMaxScore: 10,
    });

    assert.deepEqual(calls, [1, 2, 3]);
    assert.equal(result.items.length, 10);
    assert.deepEqual(result.items.map((item) => item.jobId), ['14', '15', '16', '17', '21', '22', '23', '24', '25', '26']);
    assert.equal(result.resumeMatchScoredCount, 30);
    assert.equal(result.pagesScanned, 3);
});

test('backfills additional raw pages when applied jobs are hidden from search results', async () => {
    const pages = new Map([
        [1, Array.from({ length: 10 }, (_, index) => createJob(index + 1, 7))],
        [2, Array.from({ length: 10 }, (_, index) => createJob(index + 11, 7))],
    ]);
    const calls = [];
    const jobsService = createJobsService({
        createProxyConfiguration: async () => undefined,
        userRepository: {
            async listAppliedJobs(clientId) {
                assert.equal(clientId, 'user_123');
                return ['1', '2', '3', '4'].map((jobId) => ({
                    jobId,
                    appliedAt: '2026-04-01T00:00:00.000Z',
                }));
            },
        },
        scrapeJobs: async (input) => {
            calls.push(input.pageNumber);

            return {
                input,
                items: pages.get(input.pageNumber) ?? [],
                pagesScanned: input.pageNumber,
            };
        },
    });

    const result = await jobsService.search({
        title: 'Product Manager',
        rows: 10,
        pageNumber: 1,
    }, {
        identity: {
            clientId: 'user_123',
        },
    });

    assert.deepEqual(calls, [1, 2]);
    assert.equal(result.items.length, 10);
    assert.deepEqual(result.items.map((item) => item.jobId), ['5', '6', '7', '8', '9', '10', '11', '12', '13', '14']);
    assert.equal(result.totalUniqueJobsSeen, 20);
    assert.equal(result.pagesScanned, 3);
});

test('returns applied jobs when the caller explicitly includes them', async () => {
    const calls = [];
    const jobsService = createJobsService({
        createProxyConfiguration: async () => undefined,
        userRepository: {
            async listAppliedJobs() {
                throw new Error('Applied jobs should not be loaded when includeApplied is true.');
            },
        },
        scrapeJobs: async (input) => {
            calls.push(input.pageNumber);

            return {
                input,
                items: Array.from({ length: 10 }, (_, index) => createJob(index + 1, 7)),
                pagesScanned: 1,
                totalUniqueJobsSeen: 10,
            };
        },
    });

    const result = await jobsService.search({
        title: 'Product Manager',
        rows: 10,
        pageNumber: 1,
    }, {
        identity: {
            clientId: 'user_123',
        },
        includeApplied: true,
    });

    assert.deepEqual(calls, [1]);
    assert.equal(result.items.length, 10);
    assert.deepEqual(result.items.map((item) => item.jobId), ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10']);
});
