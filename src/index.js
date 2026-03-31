import Fastify from 'fastify';

import { createApiServer } from './api/server.js';

// Keep a direct Fastify import in the entrypoint so Vercel can detect this app.
void Fastify;

const { server, config } = createApiServer();

const shouldListen = config.platform.isVercel || import.meta.url === `file://${process.argv[1]}`;

if (shouldListen) {
    const port = Number.parseInt(process.env.PORT ?? `${config.api.port}`, 10) || config.api.port;
    const host = config.platform.isVercel ? '0.0.0.0' : config.api.host;

    server.listen({
        host,
        port,
    }).then(() => {
        if (import.meta.url === `file://${process.argv[1]}`) {
            console.log(`LinkedIn Jobs API listening on http://${config.api.host}:${config.api.port}`);
        }
    }).catch((error) => {
        console.error('Failed to start LinkedIn Jobs API.', {
            error: error.message,
            stack: error.stack,
        });
        throw error;
    });
}

export default server;
