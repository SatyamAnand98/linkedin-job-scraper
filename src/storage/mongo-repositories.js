import { MongoClient } from 'mongodb';

function stripDocumentMetadata(document) {
    if (!document) {
        return null;
    }

    const { _id, ...rest } = document;
    return rest;
}

function createIndexesKey(indexes) {
    return JSON.stringify(indexes.map(({ fields, options = {} }) => [fields, options]));
}

function removeLegacyMetadata(document) {
    const {
        _id,
        kind,
        runId,
        alertId,
        ...rest
    } = document ?? {};

    if (kind === 'run' && !rest.id && runId) {
        rest.id = runId;
    }

    if (kind === 'alert' && !rest.id && alertId) {
        rest.id = alertId;
    }

    return rest;
}

function getMigrationTarget(kind) {
    switch (kind) {
        case 'run':
            return 'runs';
        case 'alert':
            return 'alerts';
        case 'user':
            return 'users';
        case 'otp':
            return 'otps';
        default:
            return null;
    }
}

function getMigrationFilter(kind, document) {
    switch (kind) {
        case 'run':
        case 'alert':
            return document.id ? { id: document.id } : null;
        case 'user':
        case 'otp':
            return document.emailNormalized ? { emailNormalized: document.emailNormalized } : null;
        default:
            return null;
    }
}

export class MongoCollectionProvider {
    constructor({ uri, databaseName, collectionName }) {
        if (!uri) {
            throw new Error('MONGO_URI is required for MongoDB-backed storage.');
        }

        this.uri = uri;
        this.databaseName = databaseName;
        this.collectionName = collectionName;
        this.clientPromise = null;
        this.indexPromises = new Map();
    }

    async init() {
        await this.collection();
    }

    async close() {
        if (!this.clientPromise) {
            return;
        }

        const client = await this.clientPromise;
        await client.close();
        this.clientPromise = null;
        this.indexPromises.clear();
    }

    async database() {
        if (!this.clientPromise) {
            const client = new MongoClient(this.uri);
            this.clientPromise = client.connect();
        }

        const client = await this.clientPromise;
        return client.db(this.databaseName);
    }

    async collection() {
        const db = await this.database();
        return db.collection(this.collectionName);
    }

    async ensureIndexes(indexes = []) {
        if (indexes.length === 0) {
            return;
        }

        const key = createIndexesKey(indexes);
        if (!this.indexPromises.has(key)) {
            this.indexPromises.set(key, (async () => {
                const collection = await this.collection();
                await Promise.all(indexes.map(({ fields, options = {} }) => collection.createIndex(fields, options)));
            })());
        }

        await this.indexPromises.get(key);
    }
}

export async function migrateLegacyMongoStorage({
    uri,
    databaseName,
    legacyCollectionName,
    collectionNames,
    logger,
} = {}) {
    if (!uri || !databaseName || !legacyCollectionName || !collectionNames) {
        return { migratedDocuments: 0, collectionsTouched: 0 };
    }

    if (Object.values(collectionNames).includes(legacyCollectionName)) {
        return { migratedDocuments: 0, collectionsTouched: 0 };
    }

    const client = new MongoClient(uri);
    await client.connect();

    try {
        const db = client.db(databaseName);
        const collections = await db.listCollections({}, { nameOnly: true }).toArray();
        if (!collections.some((collection) => collection.name === legacyCollectionName)) {
            return { migratedDocuments: 0, collectionsTouched: 0 };
        }

        const legacyCollection = db.collection(legacyCollectionName);
        const legacyDocuments = await legacyCollection.find({
            kind: { $in: ['run', 'alert', 'user', 'otp'] },
        }).toArray();

        if (legacyDocuments.length === 0) {
            return { migratedDocuments: 0, collectionsTouched: 0 };
        }

        const operationsByCollection = new Map();

        for (const legacyDocument of legacyDocuments) {
            const targetKey = getMigrationTarget(legacyDocument.kind);
            const collectionName = collectionNames[targetKey];
            if (!targetKey || !collectionName) {
                continue;
            }

            const document = removeLegacyMetadata(legacyDocument);
            const filter = getMigrationFilter(legacyDocument.kind, document);
            if (!filter) {
                continue;
            }

            const operations = operationsByCollection.get(collectionName) ?? [];
            operations.push({
                updateOne: {
                    filter,
                    update: { $set: document },
                    upsert: true,
                },
            });
            operationsByCollection.set(collectionName, operations);
        }

        let migratedDocuments = 0;
        for (const [collectionName, operations] of operationsByCollection.entries()) {
            if (operations.length === 0) {
                continue;
            }

            migratedDocuments += operations.length;
            await db.collection(collectionName).bulkWrite(operations, { ordered: false });
        }

        if (migratedDocuments > 0) {
            logger?.info?.('Migrated legacy Mongo storage into split collections.', {
                legacyCollectionName,
                migratedDocuments,
                targetCollections: [...operationsByCollection.keys()],
            });
        }

        return {
            migratedDocuments,
            collectionsTouched: operationsByCollection.size,
        };
    } finally {
        await client.close();
    }
}

export class MongoRunRepository {
    constructor({ provider }) {
        this.provider = provider;
    }

    async init() {
        await this.provider.init();
        await this.provider.ensureIndexes([
            { fields: { id: 1 }, options: { unique: true } },
            { fields: { ownerClientId: 1, updatedAt: -1 } },
        ]);
    }

    async saveRun(run) {
        const collection = await this.provider.collection();
        await collection.updateOne(
            { id: run.id },
            { $set: run },
            { upsert: true },
        );

        return run;
    }

    async getRun(runId) {
        const collection = await this.provider.collection();
        const run = await collection.findOne({ id: runId });
        return stripDocumentMetadata(run);
    }

    async getRunItems(runId) {
        const run = await this.getRun(runId);
        return run ? run.items ?? [] : null;
    }
}

export class MongoAlertRepository {
    constructor({ provider }) {
        this.provider = provider;
    }

    async init() {
        await this.provider.init();
        await this.provider.ensureIndexes([
            { fields: { id: 1 }, options: { unique: true } },
            { fields: { ownerClientId: 1, updatedAt: -1 } },
            { fields: { nextRunAt: 1 } },
        ]);
    }

    async saveAlert(alert) {
        const collection = await this.provider.collection();
        await collection.updateOne(
            { id: alert.id },
            { $set: alert },
            { upsert: true },
        );

        return alert;
    }

    async getAlert(alertId) {
        const collection = await this.provider.collection();
        const alert = await collection.findOne({ id: alertId });
        return stripDocumentMetadata(alert);
    }

    async listAlerts() {
        const collection = await this.provider.collection();
        const alerts = await collection
            .find({})
            .sort({ createdAt: -1 })
            .toArray();

        return alerts.map(stripDocumentMetadata);
    }

    async deleteAlert(alertId) {
        const collection = await this.provider.collection();
        await collection.deleteOne({ id: alertId });
    }
}

export class MongoUserRepository {
    constructor({ provider }) {
        this.provider = provider;
    }

    async init() {
        await this.provider.init();
        await this.provider.ensureIndexes([
            { fields: { emailNormalized: 1 }, options: { unique: true } },
            { fields: { clientId: 1 }, options: { unique: true, sparse: true } },
            { fields: { apiKeyHash: 1 }, options: { unique: true, sparse: true } },
            { fields: { 'apiKeyHashes.hash': 1 }, options: { unique: true, sparse: true } }
        ]);
    }

    async findByApiKeyHash(apiKeyHash) {
        const collection = await this.provider.collection();
        return collection.findOne({
            $or: [
                { apiKeyHash },
                { 'apiKeyHashes.hash': apiKeyHash }
            ]
        });
    }

    async findByEmail(emailNormalized) {
        const collection = await this.provider.collection();
        return collection.findOne({ emailNormalized });
    }

    async findByClientId(clientId) {
        const collection = await this.provider.collection();
        return collection.findOne({ clientId });
    }

    async saveUser(user) {
        const collection = await this.provider.collection();
        await collection.updateOne(
            { emailNormalized: user.emailNormalized },
            { $set: user },
            { upsert: true },
        );

        return user;
    }

    async listAppliedJobs(clientId) {
        const collection = await this.provider.collection();
        const user = await collection.findOne(
            { clientId },
            { projection: { appliedJobs: 1 } },
        );

        return [...(user?.appliedJobs ?? [])]
            .filter((item) => item?.jobId)
            .sort((left, right) => `${right.appliedAt ?? ''}`.localeCompare(`${left.appliedAt ?? ''}`));
    }

    async addAppliedJob(clientId, jobId) {
        const collection = await this.provider.collection();
        const user = await collection.findOne(
            { clientId },
            { projection: { appliedJobs: 1 } },
        );
        if (!user) {
            return null;
        }

        const nextItem = {
            jobId,
            appliedAt: new Date().toISOString(),
        };
        const appliedJobs = [
            ...(user.appliedJobs ?? []).filter((item) => item?.jobId !== jobId),
            nextItem,
        ];

        await collection.updateOne(
            { clientId },
            {
                $set: {
                    appliedJobs,
                    updatedAt: new Date().toISOString(),
                },
            },
        );

        return nextItem;
    }

    async removeAppliedJob(clientId, jobId) {
        const collection = await this.provider.collection();
        const user = await collection.findOne(
            { clientId },
            { projection: { appliedJobs: 1 } },
        );
        if (!user) {
            return null;
        }

        const appliedJobs = (user.appliedJobs ?? []).filter((item) => item?.jobId !== jobId);
        await collection.updateOne(
            { clientId },
            {
                $set: {
                    appliedJobs,
                    updatedAt: new Date().toISOString(),
                },
            },
        );

        return true;
    }

    async clearAppliedJobs(clientId) {
        const collection = await this.provider.collection();
        const user = await collection.findOne(
            { clientId },
            { projection: { clientId: 1 } },
        );
        if (!user) {
            return null;
        }

        await collection.updateOne(
            { clientId },
            {
                $set: {
                    appliedJobs: [],
                    updatedAt: new Date().toISOString(),
                },
            },
        );

        return true;
    }
}

export class MongoOtpRepository {
    constructor({ provider }) {
        this.provider = provider;
    }

    async init() {
        await this.provider.init();
        await this.provider.ensureIndexes([
            { fields: { emailNormalized: 1 }, options: { unique: true } },
            { fields: { expiresAt: 1 } },
        ]);
    }

    async saveOtpChallenge(challenge) {
        const collection = await this.provider.collection();
        await collection.updateOne(
            { emailNormalized: challenge.emailNormalized },
            { $set: challenge },
            { upsert: true },
        );

        return challenge;
    }

    async getOtpChallenge(emailNormalized) {
        const collection = await this.provider.collection();
        return collection.findOne({ emailNormalized });
    }

    async deleteOtpChallenge(emailNormalized) {
        const collection = await this.provider.collection();
        await collection.deleteOne({ emailNormalized });
    }
}
