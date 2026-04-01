import { del, get, list, put } from '@vercel/blob';

export class BlobAlertRepository {
    constructor({ prefix }) {
        this.prefix = prefix.replace(/\/+$/, '');
    }

    async init() {}

    async saveAlert(alert) {
        await put(this.#pathname(alert.id), JSON.stringify(alert, null, 2), {
            access: 'private',
            addRandomSuffix: false,
            allowOverwrite: true,
            contentType: 'application/json',
        });

        return alert;
    }

    async getAlert(alertId) {
        return this.#readPathname(this.#pathname(alertId));
    }

    async listAlerts() {
        const alerts = [];
        let cursor;

        do {
            const page = await list({
                prefix: `${this.prefix}/`,
                cursor,
                limit: 1000,
            });

            for (const blob of page.blobs) {
                const alert = await this.#readPathname(blob.pathname);
                if (alert) {
                    alerts.push(alert);
                }
            }

            cursor = page.cursor;
            if (!page.hasMore) {
                break;
            }
        } while (cursor);

        return alerts.sort((left, right) => `${right.createdAt ?? ''}`.localeCompare(`${left.createdAt ?? ''}`));
    }

    async deleteAlert(alertId) {
        await del(this.#pathname(alertId));
    }

    async #readPathname(pathname) {
        const result = await get(pathname, {
            access: 'private',
            useCache: false,
        });

        if (!result || result.statusCode !== 200) {
            return null;
        }

        return JSON.parse(await new Response(result.stream).text());
    }

    #pathname(alertId) {
        return `${this.prefix}/${alertId}.json`;
    }
}
