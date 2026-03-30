import fs from 'node:fs';
import path from 'node:path';

const DEFAULT_DEV_IDENTITIES = [
    {
        clientId: 'local-dev-admin',
        name: 'Local Development Admin',
        role: 'admin',
        clientSecret: 'change-me-local-dev-secret',
        apiKey: 'change-me-local-dev-api-key',
    },
];

let hasLoadedLocalEnvFiles = false;

function loadLocalEnvFiles() {
    if (hasLoadedLocalEnvFiles) {
        return;
    }

    for (const fileName of ['.env.local', '.env']) {
        const filePath = path.resolve(process.cwd(), fileName);
        if (fs.existsSync(filePath)) {
            process.loadEnvFile(filePath);
        }
    }

    hasLoadedLocalEnvFiles = true;
}

function parseInteger(value, fallback) {
    const parsed = Number.parseInt(`${value ?? fallback}`, 10);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function parseJson(value, fallback) {
    if (!value) {
        return fallback;
    }

    return JSON.parse(value);
}

function parseBoolean(value, fallback) {
    if (value == null || value === '') {
        return fallback;
    }

    const normalized = `${value}`.trim().toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(normalized)) {
        return true;
    }

    if (['0', 'false', 'no', 'off'].includes(normalized)) {
        return false;
    }

    return fallback;
}

function withDefaultDevIdentities(identities) {
    const mergedIdentities = [...identities];

    for (const defaultIdentity of DEFAULT_DEV_IDENTITIES) {
        const hasMatch = mergedIdentities.some((identity) =>
            identity.clientId === defaultIdentity.clientId || identity.apiKey === defaultIdentity.apiKey,
        );

        if (!hasMatch) {
            mergedIdentities.push(defaultIdentity);
        }
    }

    return mergedIdentities;
}

export function loadConfig(env = process.env) {
    if (env === process.env) {
        loadLocalEnvFiles();
    }

    const nodeEnv = env.NODE_ENV ?? 'development';
    const hasExplicitAuthConfig = Boolean(env.LINKEDIN_JOBS_AUTH_IDENTITIES_JSON);
    const configuredIdentities = parseJson(env.LINKEDIN_JOBS_AUTH_IDENTITIES_JSON, []);
    const identities = nodeEnv === 'production'
        ? configuredIdentities
        : withDefaultDevIdentities(configuredIdentities);
    const jwtSecret = env.LINKEDIN_JOBS_JWT_SECRET ?? 'change-me-local-dev-jwt-secret';
    const smtpPort = parseInteger(env.SMTP_PORT, 465);
    const isVercel = Boolean(env.VERCEL);
    const storageProvider = env.LINKEDIN_JOBS_STORAGE_PROVIDER
        ?? (env.MONGO_URI ? 'mongo' : env.BLOB_READ_WRITE_TOKEN ? 'vercel-blob' : 'file');
    const mongoUri = env.MONGO_URI ?? null;

    if (nodeEnv === 'production' && (!hasExplicitAuthConfig || !env.LINKEDIN_JOBS_JWT_SECRET)) {
        throw new Error('Production mode requires LINKEDIN_JOBS_AUTH_IDENTITIES_JSON and LINKEDIN_JOBS_JWT_SECRET.');
    }

    return {
        nodeEnv,
        api: {
            host: env.HOST ?? '0.0.0.0',
            port: parseInteger(env.PORT, 3000),
        },
        auth: {
            jwtSecret,
            accessTokenTtlSeconds: parseInteger(env.LINKEDIN_JOBS_TOKEN_TTL_SECONDS, 3600),
            identities,
            otpTtlSeconds: parseInteger(env.LINKEDIN_JOBS_OTP_TTL_SECONDS, 600),
            otpSecret: env.LINKEDIN_JOBS_OTP_SECRET ?? jwtSecret,
            defaultUserRole: env.LINKEDIN_JOBS_DEFAULT_USER_ROLE ?? 'user',
        },
        storage: {
            provider: storageProvider,
            runsDir: path.resolve(env.LINKEDIN_JOBS_RUNS_DIR ?? './storage/api-runs'),
            alertsDir: path.resolve(env.LINKEDIN_JOBS_ALERTS_DIR ?? './storage/job-alerts'),
            blobPrefix: env.LINKEDIN_JOBS_BLOB_PREFIX ?? 'linkedin-jobs',
            mongo: {
                uri: mongoUri,
                databaseName: env.LINKEDIN_JOBS_MONGO_DATABASE_NAME ?? 'linkedInJobs',
                collectionName: env.LINKEDIN_JOBS_MONGO_COLLECTION_NAME ?? 'linkedInJobs',
            },
        },
        email: {
            from: env.SMTP_FROM ?? env.SMTP_EMAIL ?? null,
            smtpHost: env.SMTP_HOST ?? 'smtp.gmail.com',
            smtpPort,
            secure: parseBoolean(env.SMTP_SECURE, smtpPort === 465),
            smtpUser: env.SMTP_EMAIL ?? null,
            smtpPassword: env.SMTP_PASSWORD ?? null,
        },
        alerts: {
            pollIntervalMs: parseInteger(env.EMAIL_ALERT_POLL_INTERVAL_MS, 60000),
            cronSecret: env.CRON_SECRET ?? null,
            useInProcessScheduler: parseBoolean(env.LINKEDIN_JOBS_USE_IN_PROCESS_SCHEDULER, !isVercel),
        },
        platform: {
            isVercel,
        },
    };
}
