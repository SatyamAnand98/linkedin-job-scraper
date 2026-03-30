import { randomUUID } from 'node:crypto';

import { CronExpressionParser } from 'cron-parser';

import { normalizeScrapeInput, toSearchMetadata } from '../scraper/input.js';
import { createNoopLogger } from '../scraper/utils.js';

const MAX_STORED_SENT_JOB_IDS = 5000;

function httpError(statusCode, message, code = 'bad_request') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function validateEmail(value) {
    const normalized = `${value ?? ''}`.trim();
    if (!normalized) {
        throw httpError(400, 'Input field "deliveryEmail" is required.');
    }

    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw httpError(400, 'Input field "deliveryEmail" must be a valid email address.');
    }

    return normalized;
}

function normalizeCronExpression(value) {
    const cronExpression = `${value ?? ''}`.trim();
    if (!cronExpression) {
        throw httpError(400, 'Input field "cronExpression" is required for email alerts.');
    }

    try {
        CronExpressionParser.parse(cronExpression);
    } catch (error) {
        throw httpError(400, `Invalid cron expression: ${error.message}`);
    }

    return cronExpression;
}

function serializeResumeFile(resumeFile) {
    if (!resumeFile) {
        return null;
    }

    return {
        bufferBase64: Buffer.from(resumeFile.buffer).toString('base64'),
        contentType: resumeFile.contentType ?? '',
        fileName: resumeFile.fileName ?? 'resume',
    };
}

function deserializeResumeFile(serializedResumeFile) {
    if (!serializedResumeFile) {
        return null;
    }

    return {
        buffer: Buffer.from(serializedResumeFile.bufferBase64, 'base64'),
        contentType: serializedResumeFile.contentType,
        fileName: serializedResumeFile.fileName,
    };
}

function serializeSearchInput(rawInput = {}) {
    const { deliveryEmail, cronExpression, ...searchInput } = rawInput;
    return {
        ...searchInput,
        resumeFile: serializeResumeFile(searchInput.resumeFile),
    };
}

function deserializeSearchInput(serializedSearchInput = {}) {
    return {
        ...serializedSearchInput,
        resumeFile: deserializeResumeFile(serializedSearchInput.resumeFile),
    };
}

function computeNextRunAt(cronExpression, currentDate = new Date()) {
    return CronExpressionParser
        .parse(cronExpression, { currentDate })
        .next()
        .toDate()
        .toISOString();
}

function summarizeAlert(alert) {
    if (!alert) {
        return null;
    }

    return {
        id: alert.id,
        recipientEmail: alert.recipientEmail,
        cronExpression: alert.cronExpression,
        createdAt: alert.createdAt,
        updatedAt: alert.updatedAt,
        nextRunAt: alert.nextRunAt,
        lastTriggeredAt: alert.lastTriggeredAt ?? null,
        lastSentAt: alert.lastSentAt ?? null,
        lastResultCount: alert.lastResultCount ?? 0,
        totalEmailsSent: alert.totalEmailsSent ?? 0,
        totalJobsSent: alert.totalJobsSent ?? 0,
        lastError: alert.lastError ?? null,
        searchMetadata: alert.searchMetadata ?? null,
    };
}

function mergeSentJobIds(existingIds, items) {
    const merged = [...new Set([
        ...(existingIds ?? []),
        ...items.map((item) => item.jobId).filter(Boolean),
    ])];

    if (merged.length <= MAX_STORED_SENT_JOB_IDS) {
        return merged;
    }

    return merged.slice(-MAX_STORED_SENT_JOB_IDS);
}

export function createJobsDeliveryService({
    jobsService,
    alertRepository,
    emailService,
    logger = createNoopLogger(),
    pollIntervalMs = 60000,
} = {}) {
    if (!jobsService) {
        throw new Error('Jobs service is required.');
    }

    if (!emailService) {
        throw new Error('Email service is required.');
    }

    if (!alertRepository) {
        throw new Error('Alert repository is required.');
    }

    let timer = null;
    let isProcessing = false;

    function ensureEmailConfigured() {
        if (!emailService.isConfigured) {
            throw httpError(500, 'Email delivery is not configured. Set SMTP_EMAIL and SMTP_PASSWORD in .env.', 'email_not_configured');
        }
    }

    async function sendInstant(rawInput) {
        ensureEmailConfigured();
        const recipientEmail = validateEmail(rawInput.deliveryEmail);
        const searchInput = serializeSearchInput(rawInput);
        const result = await jobsService.search(deserializeSearchInput(searchInput));
        const delivery = await emailService.sendJobsDigest({
            recipientEmail,
            deliveryMode: 'instant',
            searchInput: deserializeSearchInput(searchInput),
            result,
        });

        return {
            deliveryMode: 'instant',
            recipientEmail,
            deliveredAt: delivery.sentAt,
            count: result.items.length,
            resumeMatchScoredCount: result.resumeMatchScoredCount ?? null,
            resumeMatchScoreRangeApplied: result.resumeMatchScoreRangeApplied ?? null,
            email: delivery,
        };
    }

    async function createAlert(rawInput) {
        ensureEmailConfigured();
        const recipientEmail = validateEmail(rawInput.deliveryEmail);
        const cronExpression = normalizeCronExpression(rawInput.cronExpression);
        const searchInput = serializeSearchInput(rawInput);
        const searchMetadata = toSearchMetadata(normalizeScrapeInput(deserializeSearchInput(searchInput)));
        const createdAt = new Date().toISOString();
        const alert = {
            id: randomUUID(),
            recipientEmail,
            cronExpression,
            createdAt,
            updatedAt: createdAt,
            nextRunAt: computeNextRunAt(cronExpression, new Date()),
            lastTriggeredAt: null,
            lastSentAt: null,
            lastResultCount: 0,
            totalEmailsSent: 0,
            totalJobsSent: 0,
            lastError: null,
            sentJobIds: [],
            searchMetadata,
            searchInput,
        };

        await alertRepository.saveAlert(alert);
        return summarizeAlert(alert);
    }

    async function listAlerts() {
        const alerts = await alertRepository.listAlerts();
        return alerts.map(summarizeAlert);
    }

    async function deleteAlert(alertId) {
        const existingAlert = await alertRepository.getAlert(alertId);
        if (!existingAlert) {
            throw httpError(404, 'Alert not found.', 'not_found');
        }

        await alertRepository.deleteAlert(alertId);
    }

    async function processAlert(alert) {
        const now = new Date();
        const nowIso = now.toISOString();
        const searchInput = deserializeSearchInput(alert.searchInput);

        try {
            const result = await jobsService.search(searchInput);
            const sentJobIds = new Set(alert.sentJobIds ?? []);
            const freshItems = result.items.filter((item) => !item.jobId || !sentJobIds.has(item.jobId));
            const updatedAlert = {
                ...alert,
                updatedAt: nowIso,
                nextRunAt: computeNextRunAt(alert.cronExpression, now),
                lastTriggeredAt: nowIso,
                lastResultCount: result.items.length,
                lastError: null,
            };

            if (freshItems.length > 0) {
                await emailService.sendJobsDigest({
                    recipientEmail: alert.recipientEmail,
                    deliveryMode: 'alert',
                    searchInput,
                    result: {
                        ...result,
                        items: freshItems,
                    },
                    alert,
                });

                updatedAlert.lastSentAt = nowIso;
                updatedAlert.totalEmailsSent = (alert.totalEmailsSent ?? 0) + 1;
                updatedAlert.totalJobsSent = (alert.totalJobsSent ?? 0) + freshItems.length;
                updatedAlert.sentJobIds = mergeSentJobIds(alert.sentJobIds, freshItems);
            }

            await alertRepository.saveAlert(updatedAlert);

            return {
                processed: true,
                sentEmail: freshItems.length > 0,
                sentJobsCount: freshItems.length,
            };
        } catch (error) {
            logger.error?.('Email alert execution failed.', {
                alertId: alert.id,
                error: error.message,
            });

            await alertRepository.saveAlert({
                ...alert,
                updatedAt: nowIso,
                nextRunAt: computeNextRunAt(alert.cronExpression, now),
                lastTriggeredAt: nowIso,
                lastError: error.message,
            });

            return {
                processed: true,
                sentEmail: false,
                sentJobsCount: 0,
                error: error.message,
            };
        }
    }

    async function processDueAlerts() {
        if (isProcessing) {
            return {
                skipped: true,
                reason: 'already_processing',
                dueAlerts: 0,
                processedAlerts: 0,
                emailsSent: 0,
                jobsSent: 0,
            };
        }

        isProcessing = true;

        try {
            const alerts = await alertRepository.listAlerts();
            const now = Date.now();
            const summary = {
                skipped: false,
                dueAlerts: 0,
                processedAlerts: 0,
                emailsSent: 0,
                jobsSent: 0,
            };

            for (const alert of alerts) {
                if (!alert.nextRunAt || Number.isNaN(Date.parse(alert.nextRunAt))) {
                    continue;
                }

                if (Date.parse(alert.nextRunAt) <= now) {
                    summary.dueAlerts += 1;
                    const result = await processAlert(alert);
                    summary.processedAlerts += result?.processed ? 1 : 0;
                    summary.emailsSent += result?.sentEmail ? 1 : 0;
                    summary.jobsSent += result?.sentJobsCount ?? 0;
                }
            }

            return summary;
        } finally {
            isProcessing = false;
        }
    }

    function startScheduler() {
        if (timer) {
            return;
        }

        timer = setInterval(() => {
            processDueAlerts().catch((error) => {
                logger.error?.('Email alert scheduler failed.', { error: error.message });
            });
        }, pollIntervalMs);

        timer.unref?.();

        processDueAlerts().catch((error) => {
            logger.error?.('Initial email alert poll failed.', { error: error.message });
        });
    }

    function stopScheduler() {
        if (timer) {
            clearInterval(timer);
            timer = null;
        }
    }

    return {
        sendInstant,
        createAlert,
        listAlerts,
        deleteAlert,
        processDueAlerts,
        startScheduler,
        stopScheduler,
    };
}
