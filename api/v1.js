import { handleVercelRequest } from '../src/api/vercel-handler.js';

export default function v1Handler(request, reply) {
    return handleVercelRequest(request, reply, {
        routePrefix: '/v1',
        pathQueryParam: 'path',
    });
}
