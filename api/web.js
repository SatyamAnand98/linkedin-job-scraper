import { handleVercelRequest } from '../src/api/vercel-handler.js';

export default function webHandler(request, reply) {
    return handleVercelRequest(request, reply, {
        pathQueryParam: 'path',
    });
}
