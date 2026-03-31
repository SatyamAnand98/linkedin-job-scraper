import { createApiServer } from './server.js';

export async function startApiServer(options = {}) {
    const { server, config } = createApiServer(options);
    await server.listen({
        host: config.api.host,
        port: config.api.port,
    });

    return {
        server,
        config,
    };
}

if (import.meta.url === `file://${process.argv[1]}`) {
    const { config } = await startApiServer();
    console.log(`LinkedIn Jobs API listening on http://${config.api.host}:${config.api.port}`);
}
