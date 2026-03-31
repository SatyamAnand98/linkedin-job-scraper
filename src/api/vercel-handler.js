import { createApiServer } from './server.js';

const { server } = createApiServer();

let readyPromise = null;

function stripApiPrefix(url = '/') {
    if (url === '/api' || url === '/api/') {
        return '/';
    }

    if (url.startsWith('/api/')) {
        return url.slice('/api'.length) || '/';
    }

    return url;
}

function buildRequestUrl(url = '/', options = {}) {
    const { routePrefix = null, pathQueryParam = null } = options;
    if (!pathQueryParam) {
        return stripApiPrefix(url);
    }

    const parsedUrl = new URL(url, 'http://localhost');
    const rawPath = parsedUrl.searchParams.get(pathQueryParam) ?? '';
    parsedUrl.searchParams.delete(pathQueryParam);

    const normalizedPath = rawPath
        .split('/')
        .filter(Boolean)
        .join('/');
    const pathname = routePrefix
        ? (normalizedPath ? `${routePrefix}/${normalizedPath}` : routePrefix)
        : (normalizedPath ? `/${normalizedPath}` : '/');
    const search = parsedUrl.searchParams.toString();

    return `${pathname}${search ? `?${search}` : ''}`;
}

async function getServer() {
    if (!readyPromise) {
        readyPromise = server.ready().then(() => server).catch((error) => {
            readyPromise = null;
            throw error;
        });
    }

    return readyPromise;
}

export async function handleVercelRequest(request, reply, options = {}) {
    try {
        const app = await getServer();
        request.url = buildRequestUrl(request.url, options);
        app.server.emit('request', request, reply);
    } catch (error) {
        console.error('Failed to handle Vercel request.', {
            error: error.message,
            stack: error.stack,
        });

        if (!reply.headersSent) {
            reply.statusCode = 500;
            reply.setHeader('content-type', 'application/json; charset=utf-8');
            reply.end(JSON.stringify({
                error: 'Internal Server Error',
                code: 'internal_error',
            }));
        }
    }
}

export default handleVercelRequest;
