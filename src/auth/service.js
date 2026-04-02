import { createHash, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

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

function normalizeEmail(email) {
    const normalized = `${email ?? ''}`.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)) {
        throw httpError(400, 'A valid "email" is required.', 'bad_request');
    }

    return normalized;
}

function normalizeProfileName(name) {
    const normalized = `${name ?? ''}`.trim();
    if (!normalized) {
        throw httpError(400, 'A non-empty "name" is required.', 'bad_request');
    }

    return normalized.slice(0, 100);
}

function normalizePhoneNumber(phoneNumber) {
    const normalized = `${phoneNumber ?? ''}`.trim();
    if (!normalized) {
        return null;
    }

    const digitsOnly = normalized.replace(/\D/g, '');
    if (digitsOnly.length < 7 || digitsOnly.length > 15) {
        throw httpError(400, '"phoneNumber" must contain between 7 and 15 digits.', 'bad_request');
    }

    if (!/^\+?[0-9()\-\s]+$/.test(normalized)) {
        throw httpError(400, '"phoneNumber" may only include digits, spaces, parentheses, hyphens, and an optional leading +.', 'bad_request');
    }

    return normalized.slice(0, 30);
}

function sanitizeIdentity(identity, authType) {
    return {
        clientId: identity.clientId,
        userId: identity.userId ?? null,
        email: identity.email ?? null,
        name: identity.name,
        phoneNumber: identity.phoneNumber ?? null,
        role: identity.role,
        permissions: resolvePermissions(identity),
        authType,
    };
}

function hashToken(value) {
    return createHash('sha256').update(value).digest('hex');
}

function hashOtp({ email, otp, secret }) {
    return hashToken(`${secret}:${email}:${otp}`);
}

function generateOtpCode() {
    return `${randomInt(0, 1_000_000)}`.padStart(6, '0');
}

function generateApiKey() {
    return `lj_${randomBytes(24).toString('base64url')}`;
}

function generateClientId() {
    return `user_${randomBytes(10).toString('hex')}`;
}

function toUserDocument(user) {
    const { _id, kind, ...rest } = user ?? {};
    return rest;
}

export function createAuthService(authConfig, {
    userRepository = null,
    otpRepository = null,
    emailService = null,
} = {}) {
    const identities = authConfig.identities ?? [];

    function ensureOtpAuthConfigured() {
        if (!userRepository || !otpRepository || !emailService) {
            throw httpError(500, 'Email OTP signup is not configured. Set MONGO_URI and SMTP settings.', 'otp_not_configured');
        }
    }

    function findByClientId(clientId) {
        return identities.find((identity) => identity.clientId === clientId) ?? null;
    }

    async function authenticateApiKey(apiKey) {
        const configIdentity = identities.find((candidate) => candidate.apiKey && safeEqual(candidate.apiKey, apiKey));
        if (configIdentity) {
            return sanitizeIdentity(configIdentity, 'api_key');
        }

        if (userRepository) {
            const user = await userRepository.findByApiKeyHash(hashToken(apiKey));
            if (user) {
                return sanitizeIdentity(toUserDocument(user), 'api_key');
            }
        }

        throw httpError(401, 'Invalid API key.', 'unauthorized');
    }

    async function issueAccessToken({ clientId, clientSecret }) {
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
                userId: payload.userId ?? null,
                email: payload.email ?? null,
                name: payload.name,
                role: payload.role,
                permissions: payload.permissions ?? [],
                authType: 'bearer',
            };
        } catch {
            throw httpError(401, 'Invalid or expired access token.', 'unauthorized');
        }
    }

    async function authenticateRequest(headers) {
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

    async function requestEmailOtp({ email, name }) {
        ensureOtpAuthConfigured();

        const normalizedEmail = normalizeEmail(email);
        const otpCode = generateOtpCode();
        const expiresAt = new Date(Date.now() + (authConfig.otpTtlSeconds * 1000)).toISOString();

        await otpRepository.saveOtpChallenge({
            email: normalizedEmail,
            emailNormalized: normalizedEmail,
            name: `${name ?? ''}`.trim() || null,
            otpHash: hashOtp({
                email: normalizedEmail,
                otp: otpCode,
                secret: authConfig.otpSecret,
            }),
            expiresAt,
            requestedAt: new Date().toISOString(),
        });

        await emailService.sendOtpEmail({
            recipientEmail: normalizedEmail,
            otpCode,
            expiresInMinutes: Math.max(1, Math.round(authConfig.otpTtlSeconds / 60)),
        });

        return {
            email: normalizedEmail,
            expiresInSeconds: authConfig.otpTtlSeconds,
        };
    }

    async function verifyEmailOtp({ email, otp, name }) {
        ensureOtpAuthConfigured();

        const normalizedEmail = normalizeEmail(email);
        const normalizedOtp = `${otp ?? ''}`.trim();
        if (!/^\d{6}$/.test(normalizedOtp)) {
            throw httpError(400, 'A valid 6-digit "otp" is required.', 'bad_request');
        }

        const challenge = await otpRepository.getOtpChallenge(normalizedEmail);
        if (!challenge || Date.parse(challenge.expiresAt) < Date.now()) {
            if (challenge) {
                await otpRepository.deleteOtpChallenge(normalizedEmail);
            }

            throw httpError(401, 'OTP expired or not found. Request a new OTP.', 'unauthorized');
        }

        const expectedHash = hashOtp({
            email: normalizedEmail,
            otp: normalizedOtp,
            secret: authConfig.otpSecret,
        });

        if (!safeEqual(challenge.otpHash, expectedHash)) {
            throw httpError(401, 'Invalid OTP.', 'unauthorized');
        }

        const now = new Date().toISOString();
        const existingUser = userRepository ? await userRepository.findByEmail(normalizedEmail) : null;
        const apiKey = generateApiKey();

        const newKeyEntry = {
            hash: hashToken(apiKey),
            preview: `${apiKey.slice(0, 8)}...`,
            createdAt: now,
        };

        const existingHashes = existingUser?.apiKeyHashes || [];
        if (existingUser?.apiKeyHash && !existingHashes.some(k => k.hash === existingUser.apiKeyHash)) {
            existingHashes.push({
                hash: existingUser.apiKeyHash,
                preview: existingUser.apiKeyPreview,
                createdAt: existingUser.createdAt || now,
            });
        }

        existingHashes.push(newKeyEntry);
        const activeHashes = existingHashes.slice(-5);

        const nextUser = {
            ...(existingUser ? toUserDocument(existingUser) : {}),
            userId: existingUser?.userId ?? randomBytes(12).toString('hex'),
            clientId: existingUser?.clientId ?? generateClientId(),
            email: normalizedEmail,
            emailNormalized: normalizedEmail,
            name: `${name ?? challenge.name ?? existingUser?.name ?? normalizedEmail}`.trim(),
            role: existingUser?.role ?? authConfig.defaultUserRole,
            permissions: existingUser?.permissions ?? [],
            apiKeyHash: hashToken(apiKey),
            apiKeyPreview: `${apiKey.slice(0, 8)}...`,
            apiKeyHashes: activeHashes,
            createdAt: existingUser?.createdAt ?? now,
            updatedAt: now,
            verifiedAt: now,
        };

        await userRepository.saveUser(nextUser);
        await otpRepository.deleteOtpChallenge(normalizedEmail);

        return {
            user: sanitizeIdentity(nextUser, 'api_key'),
            apiKey,
            created: !existingUser,
        };
    }

    async function updateProfile({ identity, name, phoneNumber }) {
        if (!userRepository) {
            throw httpError(500, 'Profile updates are not configured.', 'profile_updates_not_configured');
        }

        if (!identity?.clientId) {
            throw httpError(401, 'Missing authenticated user identity.', 'unauthorized');
        }

        const existingUser = await userRepository.findByClientId(identity.clientId);
        if (!existingUser) {
            throw httpError(404, 'User profile not found.', 'not_found');
        }

        const nextUser = {
            ...toUserDocument(existingUser),
            name: normalizeProfileName(name ?? existingUser.name),
            phoneNumber: phoneNumber === undefined
                ? (existingUser.phoneNumber ?? null)
                : normalizePhoneNumber(phoneNumber),
            updatedAt: new Date().toISOString(),
        };

        await userRepository.saveUser(nextUser);
        return sanitizeIdentity(nextUser, identity.authType ?? 'api_key');
    }

    return {
        issueAccessToken,
        verifyAccessToken,
        authenticateRequest,
        authorize,
        requestEmailOtp,
        verifyEmailOtp,
        updateProfile,
    };
}
