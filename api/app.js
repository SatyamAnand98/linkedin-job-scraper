import { handleVercelRequest } from '../src/api/vercel-handler.js';

export default function appHandler(request, reply) {
    return handleVercelRequest(request, reply, {
        routePrefix: '/app',
        pathQueryParam: 'path',
    });
}
