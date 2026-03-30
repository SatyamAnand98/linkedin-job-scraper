function httpError(statusCode, message, code = 'bad_request') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

const ARRAY_FIELDS = new Set([
    'companyName',
    'companyId',
    'workType',
    'contractType',
    'experienceLevel',
]);

const JSON_FIELDS = new Set([
    'input',
    'proxy',
    'resumeMatchScoreRange',
]);

function parseJsonField(fieldName, rawValue) {
    try {
        return JSON.parse(rawValue);
    } catch {
        throw httpError(400, `The multipart field "${fieldName}" must contain valid JSON.`);
    }
}

function parseMultipartFieldValue(fieldName, rawValue) {
    const value = `${rawValue ?? ''}`.trim();

    if (value === '') {
        return undefined;
    }

    if (JSON_FIELDS.has(fieldName)) {
        return parseJsonField(fieldName, value);
    }

    if (ARRAY_FIELDS.has(fieldName)) {
        if (value.startsWith('[')) {
            const parsed = parseJsonField(fieldName, value);
            if (!Array.isArray(parsed)) {
                throw httpError(400, `The multipart field "${fieldName}" must contain a JSON array.`);
            }

            return parsed;
        }

        return value.split(',').map((item) => item.trim()).filter(Boolean);
    }

    return value;
}

function mergeMultipartField(target, fieldName, value) {
    if (value === undefined) {
        return;
    }

    if (fieldName === 'input') {
        if (!value || typeof value !== 'object' || Array.isArray(value)) {
            throw httpError(400, 'The multipart field "input" must contain a JSON object.');
        }

        Object.assign(target, value);
        return;
    }

    if (ARRAY_FIELDS.has(fieldName)) {
        const values = Array.isArray(value) ? value : [value];
        target[fieldName] = [...(target[fieldName] ?? []), ...values];
        return;
    }

    target[fieldName] = value;
}

export async function parseJobsSearchRequest(request) {
    if (!request.isMultipart()) {
        return request.body?.input ?? request.body ?? {};
    }

    const input = {};

    for await (const part of request.parts()) {
        if (part.type === 'file') {
            if (part.fieldname !== 'resumeFile') {
                throw httpError(400, `Unsupported uploaded field "${part.fieldname}". Use "resumeFile".`);
            }

            input.resumeFile = {
                buffer: await part.toBuffer(),
                contentType: part.mimetype,
                fileName: part.filename,
            };
            continue;
        }

        mergeMultipartField(input, part.fieldname, parseMultipartFieldValue(part.fieldname, part.value));
    }

    return input;
}
