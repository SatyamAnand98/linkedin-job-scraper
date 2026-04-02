import assert from 'node:assert/strict';
import test from 'node:test';

import { createAuthService } from '../src/auth/service.js';

function createAuthConfig() {
    return {
        identities: [],
        jwtSecret: 'test-secret',
        accessTokenTtlSeconds: 3600,
        otpTtlSeconds: 600,
        otpSecret: 'otp-secret',
        defaultUserRole: 'user',
    };
}

test('updates the authenticated user profile name and phone number', async () => {
    let storedUser = {
        userId: 'usr_1',
        clientId: 'user_1',
        email: 'candidate@example.com',
        emailNormalized: 'candidate@example.com',
        name: 'Old Name',
        phoneNumber: null,
        role: 'user',
        permissions: [],
        apiKeyHash: 'hash_1',
        apiKeyPreview: 'lj_test...',
        apiKeyHashes: [],
        createdAt: '2026-04-01T00:00:00.000Z',
        updatedAt: '2026-04-01T00:00:00.000Z',
        verifiedAt: '2026-04-01T00:00:00.000Z',
    };

    const authService = createAuthService(createAuthConfig(), {
        userRepository: {
            async findByClientId(clientId) {
                return clientId === storedUser.clientId ? { ...storedUser } : null;
            },
            async saveUser(user) {
                storedUser = { ...user };
                return storedUser;
            },
        },
    });

    const identity = await authService.updateProfile({
        identity: {
            clientId: 'user_1',
            authType: 'api_key',
        },
        name: '  Updated Name  ',
        phoneNumber: ' +1 415 555 0199 ',
    });

    assert.equal(identity.name, 'Updated Name');
    assert.equal(identity.phoneNumber, '+1 415 555 0199');
    assert.equal(storedUser.name, 'Updated Name');
    assert.equal(storedUser.phoneNumber, '+1 415 555 0199');
});
