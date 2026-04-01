import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

export class FileAlertRepository {
    constructor({ alertsDir }) {
        this.alertsDir = path.resolve(alertsDir);
    }

    async init() {
        await mkdir(this.alertsDir, { recursive: true });
    }

    async saveAlert(alert) {
        await writeFile(this.#filePath(alert.id), JSON.stringify(alert, null, 2));
        return alert;
    }

    async getAlert(alertId) {
        try {
            const content = await readFile(this.#filePath(alertId), 'utf8');
            return JSON.parse(content);
        } catch (error) {
            if (error.code === 'ENOENT') {
                return null;
            }

            throw error;
        }
    }

    async listAlerts() {
        const fileNames = await readdir(this.alertsDir);
        const alerts = await Promise.all(
            fileNames
                .filter((fileName) => fileName.endsWith('.json'))
                .map(async (fileName) => {
                    const content = await readFile(path.join(this.alertsDir, fileName), 'utf8');
                    return JSON.parse(content);
                }),
        );

        return alerts.sort((left, right) => `${right.createdAt ?? ''}`.localeCompare(`${left.createdAt ?? ''}`));
    }

    async deleteAlert(alertId) {
        await rm(this.#filePath(alertId), { force: true });
    }

    #filePath(alertId) {
        return path.join(this.alertsDir, `${alertId}.json`);
    }
}
