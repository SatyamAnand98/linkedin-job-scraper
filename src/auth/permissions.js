export const ROLE_PERMISSIONS = {
    admin: ['jobs:run', 'jobs:read', 'tokens:issue'],
    service: ['jobs:run', 'jobs:read'],
    reader: ['jobs:read'],
};

export function resolvePermissions(identity) {
    const rolePermissions = ROLE_PERMISSIONS[identity.role] ?? [];
    return [...new Set([...(identity.permissions ?? []), ...rolePermissions])];
}

export function hasPermission(identity, permission) {
    return resolvePermissions(identity).includes(permission);
}
