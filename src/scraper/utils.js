import { BASE_URL } from './constants.js';

export function cleanText(value) {
    return `${value ?? ''}`.replace(/\s+/g, ' ').trim() || null;
}

export function cleanHtml(value) {
    return value ? value.trim() : null;
}

export function absoluteUrl(value) {
    if (!value) {
        return null;
    }

    return new URL(value, BASE_URL).toString();
}

export function canonicalizeUrl(value) {
    if (!value) {
        return null;
    }

    const url = new URL(value);
    return `${url.origin}${url.pathname}`;
}

export function extractJobId(value) {
    const match = `${value ?? ''}`.match(/(\d{6,})/);
    return match ? match[1] : null;
}

export function normalizeText(value) {
    return (cleanText(value) ?? '').toLowerCase();
}

export function compactObject(value) {
    if (Array.isArray(value)) {
        return value
            .map((item) => compactObject(item))
            .filter((item) => item !== undefined && item !== null && item !== '');
    }

    if (!value || typeof value !== 'object') {
        return value;
    }

    return Object.fromEntries(
        Object.entries(value)
            .filter(([, item]) => item !== undefined && item !== null && item !== '')
            .map(([key, item]) => [key, compactObject(item)]),
    );
}

export function chunk(values, size) {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) {
        chunks.push(values.slice(index, index + size));
    }

    return chunks;
}

export function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export function createNoopLogger() {
    return {
        info: () => {},
        warn: () => {},
        error: () => {},
    };
}
