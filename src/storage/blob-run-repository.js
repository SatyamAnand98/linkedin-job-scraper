import { get, put } from '@vercel/blob';

export class BlobRunRepository {
    constructor({ prefix }) {
        this.prefix = prefix.replace(/\/+$/, '');
    }

    async init() {}

    async saveRun(run) {
        await put(this.#pathname(run.id), JSON.stringify(run, null, 2), {
            access: 'private',
            addRandomSuffix: false,
            allowOverwrite: true,
            contentType: 'application/json',
        });

        return run;
    }

    async getRun(runId) {
        const result = await get(this.#pathname(runId), {
            access: 'private',
            useCache: false,
        });

        if (!result || result.statusCode !== 200) {
            return null;
        }

        return JSON.parse(await new Response(result.stream).text());
    }

    async getRunItems(runId) {
        const run = await this.getRun(runId);
        return run ? run.items ?? [] : null;
    }

    #pathname(runId) {
        return `${this.prefix}/${runId}.json`;
    }
}
