import { readFile } from 'node:fs/promises';
import Fastify from 'fastify';
import multipart from '@fastify/multipart';

import { createAuthService } from '../auth/service.js';
import { loadConfig } from '../config/env.js';
import { createNoopLogger } from '../scraper/utils.js';
import { createEmailService } from '../services/email-service.js';
import { createJobsDeliveryService } from '../services/jobs-delivery-service.js';
import { createJobsService } from '../services/jobs-service.js';
import { MAX_RESUME_FILE_BYTES } from '../services/resume-match-service.js';
import { BlobAlertRepository } from '../storage/blob-alert-repository.js';
import { BlobRunRepository } from '../storage/blob-run-repository.js';
import { FileAlertRepository } from '../storage/file-alert-repository.js';
import { FileRunRepository } from '../storage/file-run-repository.js';
import {
    MongoAlertRepository,
    MongoCollectionProvider,
    MongoOtpRepository,
    MongoRunRepository,
    MongoUserRepository,
    migrateLegacyMongoStorage,
} from '../storage/mongo-repositories.js';
import { parseJobsSearchRequest } from './search-request.js';

function replyWithError(reply, error) {
    const statusCode = error.statusCode ?? 500;
    reply.code(statusCode).send({
        error: error.message,
        code: error.code ?? 'internal_error',
    });
}

function toRunSummary(run) {
    if (!run) {
        return null;
    }

    const { items, ...summary } = run;
    return summary;
}

function createServiceLogger() {
    return {
        info(message, metadata) {
            console.log(message, metadata ?? '');
        },
        warn(message, metadata) {
            console.warn(message, metadata ?? '');
        },
        error(message, metadata) {
            console.error(message, metadata ?? '');
        },
    };
}

const frontendAssetCache = new Map();

function createDevReloadScript(reloadToken) {
    return `
<script>
(() => {
  const currentToken = ${JSON.stringify(reloadToken)};
  const poll = async () => {
    try {
      const response = await fetch('/app/dev/reload', { cache: 'no-store' });
      if (response.ok) {
        const payload = await response.json();
        if (payload && payload.reloadToken && payload.reloadToken !== currentToken) {
          window.location.reload();
          return;
        }
      }
    } catch {}
    window.setTimeout(poll, 1000);
  };
  window.setTimeout(poll, 1000);
})();
</script>`;
}

async function loadFrontendAsset(fileName) {
    if (!frontendAssetCache.has(fileName)) {
        frontendAssetCache.set(fileName, readFile(new URL(`../frontend/${fileName}`, import.meta.url), 'utf8'));
    }

    return frontendAssetCache.get(fileName);
}

export function createApiServer(options = {}) {
    const config = options.config ?? loadConfig();
    const logger = options.logger ?? createNoopLogger();
    const serviceLogger = options.serviceLogger ?? createServiceLogger();
    const isDevFrontendMode = !config.platform.isVercel && config.nodeEnv !== 'production';
    const reloadToken = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    const emailService = options.emailService ?? createEmailService(config.email, {
        logger: serviceLogger,
    });
    const useMongoStorage = config.storage.provider === 'mongo';
    const useBlobStorage = config.storage.provider === 'vercel-blob';
    const mongoProviders = useMongoStorage
        ? {
            runs: new MongoCollectionProvider({
                uri: config.storage.mongo.uri,
                databaseName: config.storage.mongo.databaseName,
                collectionName: config.storage.mongo.collections.runs,
            }),
            alerts: new MongoCollectionProvider({
                uri: config.storage.mongo.uri,
                databaseName: config.storage.mongo.databaseName,
                collectionName: config.storage.mongo.collections.alerts,
            }),
            users: new MongoCollectionProvider({
                uri: config.storage.mongo.uri,
                databaseName: config.storage.mongo.databaseName,
                collectionName: config.storage.mongo.collections.users,
            }),
            otps: new MongoCollectionProvider({
                uri: config.storage.mongo.uri,
                databaseName: config.storage.mongo.databaseName,
                collectionName: config.storage.mongo.collections.otps,
            }),
        }
        : null;
    const runRepository = options.runRepository ?? (useMongoStorage
        ? new MongoRunRepository({ provider: mongoProviders.runs })
        : useBlobStorage
        ? new BlobRunRepository({ prefix: `${config.storage.blobPrefix}/runs` })
        : new FileRunRepository({ runsDir: config.storage.runsDir }));
    const alertRepository = options.alertRepository ?? (useMongoStorage
        ? new MongoAlertRepository({ provider: mongoProviders.alerts })
        : useBlobStorage
        ? new BlobAlertRepository({ prefix: `${config.storage.blobPrefix}/alerts` })
        : new FileAlertRepository({ alertsDir: config.storage.alertsDir }));
    const userRepository = options.userRepository ?? (useMongoStorage
        ? new MongoUserRepository({ provider: mongoProviders.users })
        : null);
    const otpRepository = options.otpRepository ?? (useMongoStorage
        ? new MongoOtpRepository({ provider: mongoProviders.otps })
        : null);
    const authService = options.authService ?? createAuthService(config.auth, {
        userRepository,
        otpRepository,
        emailService,
    });
    const jobsService = options.jobsService ?? createJobsService({
        logger: serviceLogger,
        runRepository,
    });
    const jobsDeliveryService = options.jobsDeliveryService ?? createJobsDeliveryService({
        jobsService,
        alertRepository,
        emailService,
        logger: serviceLogger,
        pollIntervalMs: config.alerts.pollIntervalMs,
    });

    const server = Fastify({
        logger: false,
    });

    async function sendFrontendPage(reply, fileName) {
        let body = await loadFrontendAsset(fileName);
        if (isDevFrontendMode && body.includes('</body>')) {
            body = body.replace('</body>', `${createDevReloadScript(reloadToken)}</body>`);
        }

        reply
            .header('cache-control', isDevFrontendMode ? 'no-store' : 'public, max-age=0, must-revalidate')
            .type('text/html; charset=utf-8')
            .send(body);
    }

    async function sendFrontendAsset(reply, fileName, contentType) {
        reply
            .header('cache-control', isDevFrontendMode ? 'no-store' : 'public, max-age=0, must-revalidate')
            .type(contentType)
            .send(await loadFrontendAsset(fileName));
    }

    let initializationPromise = null;
    let legacyMigrationPromise = null;
    let schedulerStarted = false;

    async function ensureInitialized() {
        if (!initializationPromise) {
            initializationPromise = (async () => {
                if (useMongoStorage && !legacyMigrationPromise) {
                    legacyMigrationPromise = migrateLegacyMongoStorage({
                        ...config.storage.mongo,
                        collectionNames: config.storage.mongo.collections,
                        logger: serviceLogger,
                    }).catch((error) => {
                        legacyMigrationPromise = null;
                        throw error;
                    });
                }

                await legacyMigrationPromise;
                await runRepository.init();
                await alertRepository.init();
                await userRepository?.init?.();
                await otpRepository?.init?.();

                if (config.platform.isVercel && !useBlobStorage && !useMongoStorage) {
                    serviceLogger.warn('Vercel deployment is using file-backed storage. Runs and alerts will not persist across instances.', {
                        storageProvider: config.storage.provider,
                    });
                }

                if (config.platform.isVercel && !config.alerts.useInProcessScheduler && !config.alerts.cronSecret) {
                    serviceLogger.warn('Vercel deployment has no CRON_SECRET. Saved alerts will persist but will not run automatically until Vercel Cron is configured.', {
                        schedulerMode: 'external',
                    });
                }

                if (config.alerts.useInProcessScheduler && !schedulerStarted) {
                    jobsDeliveryService.startScheduler?.();
                    schedulerStarted = true;
                }
            })().catch((error) => {
                initializationPromise = null;
                serviceLogger.error('API dependency initialization failed.', {
                    error: error.message,
                    storageProvider: config.storage.provider,
                });
                throw error;
            });
        }

        await initializationPromise;
    }

    server.register(multipart, {
        limits: {
            files: 1,
            fileSize: MAX_RESUME_FILE_BYTES,
        },
    });

    async function authenticate(request) {
        await ensureInitialized();

        if (!request.identity) {
            request.identity = await authService.authenticateRequest(request.headers);
        }

        return request.identity;
    }

    function requireAuth() {
        return async (request, reply) => {
            try {
                await authenticate(request);
            } catch (error) {
                return replyWithError(reply, error);
            }
        };
    }

    function requirePermission(permission) {
        return async (request, reply) => {
            try {
                const identity = await authenticate(request);
                authService.authorize(identity, permission);
            } catch (error) {
                return replyWithError(reply, error);
            }
        };
    }

    function requireCronSecretOrPermission(permission) {
        return async (request, reply) => {
            const cronSecret = config.alerts.cronSecret;
            if (cronSecret) {
                const authorization = request.headers.authorization ?? '';
                if (authorization === `Bearer ${cronSecret}`) {
                    return;
                }
            }

            return requirePermission(permission)(request, reply);
        };
    }

    server.get('/health', async () => ({
        status: 'ok',
        service: 'linkedin-jobs-scraper-api',
        storageProvider: config.storage.provider,
        schedulerMode: config.alerts.useInProcessScheduler ? 'in_process' : 'external',
        schedulerConfigured: config.alerts.useInProcessScheduler || Boolean(config.alerts.cronSecret),
    }));

    server.get('/', async (request, reply) => {
        await sendFrontendPage(reply, 'index.html');
    });

    server.get('/terms', async (request, reply) => {
        await sendFrontendPage(reply, 'terms.html');
    });

    server.get('/contact', async (request, reply) => {
        await sendFrontendPage(reply, 'contact.html');
    });

    server.get('/app/app.js', async (request, reply) => {
        await sendFrontendAsset(reply, 'app.js', 'text/javascript; charset=utf-8');
    });

    server.get('/app/styles.css', async (request, reply) => {
        await sendFrontendAsset(reply, 'styles.css', 'text/css; charset=utf-8');
    });

    server.get('/app/dev/reload', async () => ({
        reloadToken,
    }));

    server.get('/app', async (request, reply) => {
        reply.redirect('/login');
    });

    server.get('/login', async (request, reply) => {
        await sendFrontendPage(reply, 'login.html');
    });

    server.get('/app/login', async (request, reply) => {
        reply.redirect('/login');
    });

    server.get('/signup', async (request, reply) => {
        await sendFrontendPage(reply, 'signup.html');
    });

    server.get('/app/signup', async (request, reply) => {
        reply.redirect('/signup');
    });

    server.get('/app/search', async (request, reply) => {
        await sendFrontendPage(reply, 'search.html');
    });

    server.get('/app/alerts', async (request, reply) => {
        await sendFrontendPage(reply, 'alerts.html');
    });

    server.get('/app/account', async (request, reply) => {
        await sendFrontendPage(reply, 'account.html');
    });

    server.addHook('onClose', async () => {
        if (schedulerStarted) {
            jobsDeliveryService.stopScheduler?.();
        }

        if (useMongoStorage) {
            await Promise.all(Object.values(mongoProviders).map((provider) => provider.close()));
        }
    });

    if (config.alerts.useInProcessScheduler) {
        void ensureInitialized().catch(() => {});
    }

    server.post('/v1/auth/tokens', async (request, reply) => {
        try {
            await ensureInitialized();

            const { clientId, clientSecret } = request.body ?? {};
            if (!clientId || !clientSecret) {
                throw Object.assign(new Error('Both "clientId" and "clientSecret" are required.'), {
                    statusCode: 400,
                    code: 'bad_request',
                });
            }

            reply.code(201).send(await authService.issueAccessToken({ clientId, clientSecret }));
        } catch (error) {
            replyWithError(reply, error);
        }
    });

    server.post('/v1/auth/email/request-otp', async (request, reply) => {
        try {
            await ensureInitialized();

            const result = await authService.requestEmailOtp({
                email: request.body?.email,
                name: request.body?.name,
            });
            reply.code(202).send(result);
        } catch (error) {
            replyWithError(reply, error);
        }
    });

    server.post('/v1/auth/email/verify-otp', async (request, reply) => {
        try {
            await ensureInitialized();

            const result = await authService.verifyEmailOtp({
                email: request.body?.email,
                otp: request.body?.otp,
                name: request.body?.name,
            });
            reply.code(201).send(result);
        } catch (error) {
            replyWithError(reply, error);
        }
    });

    server.get('/v1/auth/me', { preHandler: requireAuth() }, async (request) => ({
        identity: request.identity,
    }));

    server.post('/v1/jobs/search', { preHandler: requirePermission('jobs:run') }, async (request, reply) => {
        try {
            await ensureInitialized();
            const result = await jobsService.search(await parseJobsSearchRequest(request));
            const payload = {
                count: result.items.length,
                items: result.items,
                pagesScanned: result.pagesScanned,
                totalUniqueJobsSeen: result.totalUniqueJobsSeen,
            };

            if (result.resumeMatchScoredCount != null) {
                payload.resumeMatchScoredCount = result.resumeMatchScoredCount;
            }

            if (result.resumeMatchScoreRangeApplied) {
                payload.resumeMatchScoreRangeApplied = result.resumeMatchScoreRangeApplied;
            }

            reply.send(payload);
        } catch (error) {
            logger.error?.('Synchronous jobs search failed.', { error: error.message });
            replyWithError(reply, Object.assign(error, {
                statusCode: error.statusCode ?? 502,
                code: error.code ?? 'scrape_failed',
            }));
        }
    });

    server.post('/v1/jobs/deliveries/send', { preHandler: requirePermission('jobs:run') }, async (request, reply) => {
        try {
            await ensureInitialized();
            const result = await jobsDeliveryService.sendInstant(await parseJobsSearchRequest(request));
            reply.send(result);
        } catch (error) {
            logger.error?.('Instant jobs email delivery failed.', { error: error.message });
            replyWithError(reply, Object.assign(error, {
                statusCode: error.statusCode ?? 502,
                code: error.code ?? 'delivery_failed',
            }));
        }
    });

    server.post('/v1/jobs/alerts', { preHandler: requirePermission('jobs:run') }, async (request, reply) => {
        try {
            await ensureInitialized();
            const alerts = await jobsDeliveryService.createAlerts(await parseJobsSearchRequest(request), {
                identity: request.identity,
            });
            reply.code(201).send({
                count: alerts.length,
                alert: alerts[0] ?? null,
                alerts,
            });
        } catch (error) {
            logger.error?.('Creating jobs email alert failed.', { error: error.message });
            replyWithError(reply, Object.assign(error, {
                statusCode: error.statusCode ?? 502,
                code: error.code ?? 'alert_create_failed',
            }));
        }
    });

    server.get('/v1/jobs/alerts', { preHandler: requirePermission('jobs:run') }, async (request, reply) => {
        try {
            await ensureInitialized();
            const alerts = await jobsDeliveryService.listAlerts({
                identity: request.identity,
            });
            reply.send({
                count: alerts.length,
                alerts,
            });
        } catch (error) {
            replyWithError(reply, Object.assign(error, {
                statusCode: error.statusCode ?? 500,
                code: error.code ?? 'alert_list_failed',
            }));
        }
    });

    server.get('/v1/jobs/alerts/process', { preHandler: requireCronSecretOrPermission('jobs:run') }, async (request, reply) => {
        try {
            await ensureInitialized();
            const result = await jobsDeliveryService.processDueAlerts();
            reply.send(result);
        } catch (error) {
            replyWithError(reply, Object.assign(error, {
                statusCode: error.statusCode ?? 500,
                code: error.code ?? 'alert_process_failed',
            }));
        }
    });

    server.delete('/v1/jobs/alerts/:alertId', { preHandler: requirePermission('jobs:run') }, async (request, reply) => {
        try {
            await ensureInitialized();
            await jobsDeliveryService.deleteAlert(request.params.alertId, {
                identity: request.identity,
            });
            reply.code(204).send();
        } catch (error) {
            replyWithError(reply, Object.assign(error, {
                statusCode: error.statusCode ?? 500,
                code: error.code ?? 'alert_delete_failed',
            }));
        }
    });

    server.post('/v1/jobs/runs', { preHandler: requirePermission('jobs:run') }, async (request, reply) => {
        await ensureInitialized();
        const run = await jobsService.createRun(request.body?.input ?? request.body ?? {}, {
            identity: request.identity,
        });
        const summary = toRunSummary(run);

        if (run.status === 'failed') {
            return reply.code(502).send({
                run: summary,
                error: run.errorMessage,
            });
        }

        reply.code(201).send({
            run: summary,
        });
    });

    server.get('/v1/jobs/runs/:runId', { preHandler: requirePermission('jobs:read') }, async (request, reply) => {
        await ensureInitialized();
        const run = await jobsService.getRun(request.params.runId, {
            identity: request.identity,
        });
        if (!run) {
            return replyWithError(reply, Object.assign(new Error('Run not found.'), {
                statusCode: 404,
                code: 'not_found',
            }));
        }

        reply.send({
            run: toRunSummary(run),
        });
    });

    server.get('/v1/jobs/runs/:runId/items', { preHandler: requirePermission('jobs:read') }, async (request, reply) => {
        await ensureInitialized();
        const items = await jobsService.getRunItems(request.params.runId, {
            identity: request.identity,
        });
        if (!items) {
            return replyWithError(reply, Object.assign(new Error('Run not found.'), {
                statusCode: 404,
                code: 'not_found',
            }));
        }

        reply.send({
            runId: request.params.runId,
            count: items.length,
            items,
        });
    });

    return {
        server,
        config,
    };
}
