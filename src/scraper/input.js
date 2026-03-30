import {
    DATE_POSTED_MAP,
    DEFAULT_DELAY_MS,
    DEFAULT_DETAIL_CONCURRENCY,
    DEFAULT_PAGE_NUMBER,
    DEFAULT_ROWS,
    EXPERIENCE_LEVEL_MAP,
    JOB_TYPE_MAP,
    WORK_TYPE_MAP,
} from './constants.js';

function stringArray(value) {
    if (value == null) {
        return [];
    }

    return (Array.isArray(value) ? value : [value])
        .map((item) => `${item}`.trim())
        .filter(Boolean);
}

function optionalString(value) {
    if (typeof value !== 'string') {
        return null;
    }

    return value.trim() || null;
}

function uniqueValues(values) {
    return [...new Set(values)];
}

function normalizeSingleValue(value, mapping) {
    if (value == null || value === '') {
        return null;
    }

    const key = `${value}`.trim().toLowerCase().replace(/\s+/g, '');
    if (!mapping[key]) {
        throw new Error(`Unsupported filter value "${value}".`);
    }

    return mapping[key];
}

function normalizeMultiValue(value, mapping) {
    return uniqueValues(
        stringArray(value).map((item) => {
            const key = item.toLowerCase().replace(/\s+/g, '');
            if (!mapping[key]) {
                throw new Error(`Unsupported filter value "${item}".`);
            }

            return mapping[key];
        }),
    );
}

function normalizeInteger(value, { defaultValue, min, max, fieldName }) {
    const candidate = value == null ? defaultValue : Number.parseInt(`${value}`, 10);
    if (!Number.isFinite(candidate) || candidate < min || candidate > max) {
        throw new Error(`Input field "${fieldName}" must be an integer between ${min} and ${max}.`);
    }

    return Math.trunc(candidate);
}

export function normalizeScrapeInput(rawInput = {}) {
    const input = rawInput ?? {};
    const title = optionalString(input.title);
    const location = optionalString(input.location);
    const companyName = uniqueValues(stringArray(input.companyName));
    const companyId = uniqueValues(
        stringArray(input.companyId)
            .map((value) => value.replace(/\D+/g, ''))
            .filter(Boolean),
    );
    const under10Applicants = Boolean(input.under10Applicants);

    if (!title && companyName.length === 0 && companyId.length === 0) {
        throw new Error('Provide at least one of "title", "companyName", or "companyId".');
    }

    return {
        title,
        location,
        rows: normalizeInteger(input.rows, {
            defaultValue: DEFAULT_ROWS,
            min: 1,
            max: 1000,
            fieldName: 'rows',
        }),
        pageNumber: normalizeInteger(input.pageNumber, {
            defaultValue: DEFAULT_PAGE_NUMBER,
            min: 1,
            max: 1000,
            fieldName: 'pageNumber',
        }),
        companyName,
        companyId,
        publishedAt: normalizeSingleValue(input.publishedAt, DATE_POSTED_MAP),
        workType: normalizeMultiValue(input.workType, WORK_TYPE_MAP),
        contractType: normalizeMultiValue(input.contractType, JOB_TYPE_MAP),
        experienceLevel: normalizeMultiValue(input.experienceLevel, EXPERIENCE_LEVEL_MAP),
        proxy: input.proxy ?? null,
        requestDelayMs: normalizeInteger(input.requestDelayMs, {
            defaultValue: DEFAULT_DELAY_MS,
            min: 0,
            max: 10000,
            fieldName: 'requestDelayMs',
        }),
        detailConcurrency: normalizeInteger(input.detailConcurrency, {
            defaultValue: DEFAULT_DETAIL_CONCURRENCY,
            min: 1,
            max: 10,
            fieldName: 'detailConcurrency',
        }),
        under10Applicants,
    };
}

export function toSearchMetadata(input) {
    return {
        title: input.title ?? null,
        location: input.location ?? null,
        companyName: input.companyName,
        companyId: input.companyId,
        pageNumber: input.pageNumber,
        publishedAt: input.publishedAt ?? null,
        workType: input.workType,
        contractType: input.contractType,
        experienceLevel: input.experienceLevel,
    };
}
