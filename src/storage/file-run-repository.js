import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class FileRunRepository {
    constructor({ runsDir }) {
        this.runsDir = path.resolve(runsDir);
    }

    async init() {
        await mkdir(this.runsDir, { recursive: true });
    }

    async saveRun(run) {
        await writeFile(this.#filePath(run.id), JSON.stringify(run, null, 2));
        return run;
    }

    async getRun(runId) {
        try {
            const content = await readFile(this.#filePath(runId), 'utf8');
            return JSON.parse(content);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null;
            }

            throw error;
        }
    }

    async getRunItems(runId) {
        const run = await this.getRun(runId);
        return run ? run.items ?? [] : null;
    }

    #filePath(runId) {
        return path.join(this.runsDir, `${runId}.json`);
    }
}
