import { timingSafeEqual } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { hasPermission, resolvePermissions } from './permissions.js';

function httpError(statusCode, message, code) {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function safeEqual(left, right) {
    if (!left || !right) {
        return false;
    }

    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}

function sanitizeIdentity(identity, authType) {
    return {
        clientId: identity.clientId,
        name: identity.name,
        role: identity.role,
        permissions: resolvePermissions(identity),
        authType,
    };
}

export function createAuthService(authConfig) {
    const identities = authConfig.identities ?? [];

    function findByClientId(clientId) {
        return identities.find((identity) => identity.clientId === clientId) ?? null;
    }

    function authenticateApiKey(apiKey) {
        const identity = identities.find((candidate) => candidate.apiKey && safeEqual(candidate.apiKey, apiKey));
        if (!identity) {
            throw httpError(401, 'Invalid API key.', 'unauthorized');
        }

        return sanitizeIdentity(identity, 'api_key');
    }

    function issueAccessToken({ clientId, clientSecret }) {
        const identity = findByClientId(clientId);
        if (!identity?.clientSecret || !safeEqual(identity.clientSecret, clientSecret)) {
            throw httpError(401, 'Invalid client credentials.', 'unauthorized');
        }

        const subject = sanitizeIdentity(identity, 'bearer');
        const accessToken = jwt.sign(subject, authConfig.jwtSecret, {
            expiresIn: authConfig.accessTokenTtlSeconds,
            subject: subject.clientId,
        });

        return {
            accessToken,
            tokenType: 'Bearer',
            expiresIn: authConfig.accessTokenTtlSeconds,
            subject,
        };
    }

    function verifyAccessToken(token) {
        try {
            const payload = jwt.verify(token, authConfig.jwtSecret);
            return {
                clientId: payload.clientId,
                name: payload.name,
                role: payload.role,
                permissions: payload.permissions ?? [],
                authType: 'bearer',
            };
        } catch {
            throw httpError(401, 'Invalid or expired access token.', 'unauthorized');
        }
    }

    function authenticateRequest(headers) {
        const authorization = headers.authorization ?? '';
        if (authorization.startsWith('Bearer ')) {
            return verifyAccessToken(authorization.slice('Bearer '.length));
        }

        const apiKey = headers['x-api-key'];
        if (typeof apiKey === 'string' && apiKey.trim()) {
            return authenticateApiKey(apiKey.trim());
        }

        throw httpError(401, 'Missing authentication credentials.', 'unauthorized');
    }

    function authorize(identity, permission) {
        if (!hasPermission(identity, permission)) {
            throw httpError(403, `Missing required permission: ${permission}`, 'forbidden');
        }
    }

    return {
        issueAccessToken,
        verifyAccessToken,
        authenticateRequest,
        authorize,
    };
}
