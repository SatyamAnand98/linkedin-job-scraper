import path from 'node:path';
import { fileURLToPath } from 'node:url';

import AdmZip from 'adm-zip';

export const MAX_RESUME_FILE_BYTES = 5 * 1024 * 1024;

let pdfJsModulePromise = null;
let canvasModulePromise = null;
const PDFJS_STANDARD_FONT_DATA_DIR = `${path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../node_modules/pdfjs-dist/standard_fonts/',
)}/`;

const STOP_WORDS = new Set([
    'a',
    'an',
    'and',
    'are',
    'as',
    'at',
    'be',
    'build',
    'built',
    'by',
    'for',
    'from',
    'have',
    'in',
    'into',
    'is',
    'of',
    'on',
    'or',
    'role',
    'that',
    'the',
    'their',
    'this',
    'to',
    'using',
    'with',
    'work',
    'worked',
    'working',
    'years',
    'year',
]);

const LOW_SIGNAL_JOB_TOKENS = new Set([
    'ability',
    'business',
    'candidate',
    'collaborate',
    'collaboration',
    'communicate',
    'communication',
    'company',
    'customers',
    'deliver',
    'delivery',
    'environment',
    'experience',
    'experienced',
    'good',
    'great',
    'help',
    'include',
    'including',
    'knowledge',
    'preferred',
    'requirement',
    'requirements',
    'required',
    'responsibilities',
    'responsibility',
    'responsible',
    'solution',
    'solutions',
    'strong',
    'team',
    'teams',
]);

const ROLE_FAMILY_PATTERNS = {
    product: ['product manager', 'product management', 'product owner', 'roadmap', 'go to market', 'go-to-market'],
    engineering: ['software engineer', 'software development', 'developer', 'backend', 'frontend', 'fullstack', 'api', 'microservices'],
    data: ['data analyst', 'data science', 'data scientist', 'analytics', 'business intelligence', 'sql', 'dashboard', 'machine learning'],
    design: ['product design', 'product designer', 'ux design', 'ui design', 'design system', 'figma'],
    marketing: ['marketing', 'seo', 'sem', 'campaign', 'brand', 'content', 'growth marketing'],
    sales: ['sales', 'account executive', 'business development', 'pipeline', 'quota'],
    operations: ['operations', 'program manager', 'project manager', 'process improvement', 'supply chain'],
    finance: ['finance', 'accounting', 'financial planning', 'financial analysis', 'fp&a'],
    people: ['human resources', 'talent acquisition', 'recruiter', 'people operations'],
    support: ['customer success', 'technical support', 'support engineer', 'implementation'],
    qa: ['quality assurance', 'test automation', 'qa engineer', 'selenium'],
    devops: ['devops', 'site reliability', 'sre', 'kubernetes', 'terraform', 'cloud infrastructure'],
    security: ['security', 'application security', 'iam', 'siem', 'soc', 'vulnerability management'],
};

const SENIORITY_PATTERNS = [
    { level: 1, patterns: ['internship', 'intern', 'apprentice', 'trainee', 'fresher'] },
    { level: 2, patterns: ['entry level', 'entry-level', 'entry', 'junior', 'jr', 'graduate'] },
    { level: 3, patterns: ['associate', 'mid level', 'mid-level', 'specialist'] },
    { level: 4, patterns: ['mid senior', 'mid-senior', 'senior', 'sr', 'lead', 'staff', 'principal'] },
    { level: 5, patterns: ['director', 'head', 'vice president', 'vp', 'chief'] },
];

const SKILL_PATTERNS = {
    'Product strategy': ['product strategy', 'product vision', 'product thinking'],
    Roadmapping: ['roadmap', 'roadmapping', 'prioritization', 'prioritisation'],
    'Stakeholder management': ['stakeholder management', 'stakeholder communication', 'cross functional', 'cross-functional'],
    'User research': ['user research', 'customer research', 'user interviews'],
    'Product analytics': ['product analytics', 'amplitude', 'mixpanel'],
    Experimentation: ['a/b testing', 'ab testing', 'experimentation'],
    'Requirements gathering': ['requirements gathering', 'business requirements', 'prd', 'product requirements document'],
    'Go-to-market': ['go to market', 'go-to-market', 'gtm'],
    Agile: ['agile', 'scrum', 'kanban', 'jira', 'confluence'],
    SQL: ['sql', 'postgresql', 'postgres', 'mysql', 'tsql', 't sql'],
    Python: ['python', 'pandas', 'numpy', 'scikit learn', 'scikit-learn'],
    Excel: ['excel', 'spreadsheets', 'google sheets'],
    Tableau: ['tableau'],
    'Power BI': ['power bi', 'powerbi'],
    Looker: ['looker'],
    Statistics: ['statistics', 'statistical analysis'],
    'Machine learning': ['machine learning', 'ml models', 'predictive modeling', 'predictive modelling'],
    ETL: ['etl', 'data pipeline', 'data pipelines'],
    'Data modeling': ['data modeling', 'data modelling'],
    JavaScript: ['javascript', 'java script'],
    TypeScript: ['typescript'],
    React: ['react', 'reactjs', 'react js'],
    'Node.js': ['node.js', 'nodejs', 'node js'],
    Java: ['java'],
    Spring: ['spring', 'spring boot'],
    'C++': ['c++'],
    'C#/.NET': ['c#', '.net', 'dotnet', 'asp.net', 'asp net'],
    PHP: ['php', 'laravel'],
    Ruby: ['ruby', 'ruby on rails', 'rails'],
    AWS: ['aws', 'amazon web services'],
    Azure: ['azure'],
    GCP: ['gcp', 'google cloud'],
    Docker: ['docker', 'containers', 'containerization'],
    Kubernetes: ['kubernetes', 'k8s'],
    Terraform: ['terraform'],
    'CI/CD': ['ci/cd', 'ci cd', 'continuous integration', 'continuous delivery', 'continuous deployment'],
    'REST APIs': ['rest api', 'restful api', 'api integration', 'api design'],
    Microservices: ['microservices', 'service oriented architecture'],
    Figma: ['figma'],
    'Design systems': ['design system', 'design systems'],
    Wireframing: ['wireframe', 'wireframing', 'prototyping'],
    SEO: ['seo', 'search engine optimization'],
    SEM: ['sem', 'search engine marketing'],
    'Content marketing': ['content marketing', 'content strategy'],
    'Performance marketing': ['performance marketing', 'paid acquisition', 'paid media'],
    CRM: ['crm', 'salesforce', 'hubspot'],
    'Project management': ['project management', 'project planning'],
    'Program management': ['program management'],
    'Process improvement': ['process improvement', 'continuous improvement', 'operational excellence'],
    Automation: ['automation', 'workflow automation', 'automated reporting'],
    Recruiting: ['recruiting', 'talent acquisition', 'candidate sourcing'],
    'Customer success': ['customer success', 'client success', 'account management'],
    'Financial modeling': ['financial modeling', 'financial modelling'],
    'FP&A': ['fp&a', 'financial planning', 'budgeting', 'forecasting'],
};

const REQUIRED_SIGNAL_PATTERNS = [
    /\brequired\b/i,
    /\brequirement(?:s)?\b/i,
    /\bqualification(?:s)?\b/i,
    /\bmust have\b/i,
    /\bmust\b/i,
    /\bneed to\b/i,
    /\bexperience with\b/i,
    /\bexperience in\b/i,
    /\bproficien(?:t|cy)\b/i,
    /\bexpertise\b/i,
    /\bhands[- ]on\b/i,
    /\bknowledge of\b/i,
    /\bstrong understanding of\b/i,
    /\bskilled in\b/i,
];

const PREFERRED_SIGNAL_PATTERNS = [
    /\bpreferred\b/i,
    /\bnice to have\b/i,
    /\bbonus\b/i,
    /\bplus\b/i,
    /\bideally\b/i,
];

const RESPONSIBILITY_SIGNAL_PATTERNS = [
    /\bresponsibilit(?:y|ies)\b/i,
    /\byou will\b/i,
    /\bwhat you'll do\b/i,
    /\bresponsible for\b/i,
    /\bday to day\b/i,
];

function httpError(statusCode, message, code = 'bad_request') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function cleanText(value) {
    return `${value ?? ''}`
        .replace(/\u0000/g, ' ')
        .replace(/\r\n?/g, '\n')
        .replace(/[^\S\n]+/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
}

function truncateText(value, maxLength = 50000) {
    return value.length <= maxLength ? value : value.slice(0, maxLength);
}

function unique(values) {
    return [...new Set(values)];
}

function tokenize(value) {
    return cleanText(value)
        .toLowerCase()
        .match(/[a-z0-9][a-z0-9+#./-]{1,}/g)
        ?.map((token) => token.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ''))
        .filter((token) => token.length >= 2 && !STOP_WORDS.has(token))
        ?? [];
}

function normalizeForSearch(value) {
    return ` ${cleanText(value)
        .toLowerCase()
        .replace(/[^a-z0-9+#]+/g, ' ')
        .trim()} `;
}

function normalizePhrase(value) {
    return normalizeForSearch(value).trim();
}

function hasPhrase(searchText, phrase) {
    const normalizedPhrase = normalizePhrase(phrase);
    return Boolean(normalizedPhrase) && searchText.includes(` ${normalizedPhrase} `);
}

function decodeXmlEntities(value) {
    return value
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&#x2013;/gi, '-')
        .replace(/&#x2014;/gi, '-')
        .replace(/&#xA;/gi, '\n');
}

function stripHtml(value) {
    return decodeXmlEntities(
        value
            .replace(/<br\s*\/?>/gi, '\n')
            .replace(/<\/p>/gi, '\n')
            .replace(/<[^>]+>/g, ' '),
    );
}

function extractDocxText(buffer) {
    const zip = new AdmZip(buffer);
    const entry = zip.getEntry('word/document.xml');
    if (!entry) {
        throw httpError(400, 'The uploaded DOCX resume is missing word/document.xml.');
    }

    return decodeXmlEntities(
        zip
            .readAsText(entry.entryName, 'utf8')
            .replace(/<w:tab\/>/g, ' ')
            .replace(/<w:br\/>/g, '\n')
            .replace(/<\/w:p>/g, '\n')
            .replace(/<[^>]+>/g, ' '),
    );
}

async function ensurePdfJsNodePolyfills() {
    if (globalThis.DOMMatrix && globalThis.ImageData && globalThis.Path2D) {
        return;
    }

    if (!canvasModulePromise) {
        canvasModulePromise = import('@napi-rs/canvas');
    }

    const canvas = await canvasModulePromise;

    if (!globalThis.DOMMatrix && canvas.DOMMatrix) {
        globalThis.DOMMatrix = canvas.DOMMatrix;
    }

    if (!globalThis.ImageData && canvas.ImageData) {
        globalThis.ImageData = canvas.ImageData;
    }

    if (!globalThis.Path2D && canvas.Path2D) {
        globalThis.Path2D = canvas.Path2D;
    }
}

async function importPdfJsModule() {
    if (!pdfJsModulePromise) {
        pdfJsModulePromise = (async () => {
            try {
                await ensurePdfJsNodePolyfills();
            } catch {
                // Text extraction can still work without the rendering polyfills.
            }

            const originalWarn = console.warn;
            console.warn = (...args) => {
                const message = args.map((value) => `${value ?? ''}`).join(' ');
                if (
                    message.includes('Cannot load "@napi-rs/canvas" package')
                    || message.includes('Cannot polyfill `DOMMatrix`')
                    || message.includes('Cannot polyfill `ImageData`')
                    || message.includes('Cannot polyfill `Path2D`')
                ) {
                    return;
                }

                originalWarn(...args);
            };

            try {
                const [pdfJsModule, pdfWorkerModule] = await Promise.all([
                    import('pdfjs-dist/legacy/build/pdf.mjs'),
                    import('pdfjs-dist/legacy/build/pdf.worker.mjs'),
                ]);

                if (pdfWorkerModule?.WorkerMessageHandler) {
                    globalThis.pdfjsWorker = {
                        ...(globalThis.pdfjsWorker ?? {}),
                        WorkerMessageHandler: pdfWorkerModule.WorkerMessageHandler,
                    };
                }

                return pdfJsModule;
            } finally {
                console.warn = originalWarn;
            }
        })();
    }

    return pdfJsModulePromise;
}

async function extractPdfText(buffer) {
    let getDocument;

    try {
        ({ getDocument } = await importPdfJsModule());
    } catch {
        throw httpError(500, 'PDF resume parsing is unavailable in this deployment.', 'pdf_resume_unavailable');
    }

    const loadingTask = getDocument({
        data: new Uint8Array(buffer),
        standardFontDataUrl: PDFJS_STANDARD_FONT_DATA_DIR,
    });

    try {
        const pdf = await loadingTask.promise;
        const pageTexts = [];

        for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
            const page = await pdf.getPage(pageNumber);
            const content = await page.getTextContent();
            pageTexts.push(content.items
                .map((item) => item.str ?? '')
                .join(' '));
        }

        return pageTexts.join('\n');
    } finally {
        await loadingTask.destroy();
    }
}

function looksLikeTextBuffer(buffer) {
    if (buffer.length === 0) {
        return true;
    }

    const sample = buffer.subarray(0, Math.min(buffer.length, 512));
    let readableCharacters = 0;

    for (const byte of sample) {
        if (byte === 9 || byte === 10 || byte === 13 || (byte >= 32 && byte <= 126)) {
            readableCharacters += 1;
        }
    }

    return readableCharacters / sample.length >= 0.85;
}

function detectResumeKind({ fileName, contentType, buffer }) {
    const extension = path.extname(fileName ?? '').toLowerCase();
    const normalizedType = `${contentType ?? ''}`.toLowerCase();

    if (normalizedType.includes('pdf') || extension === '.pdf') {
        return 'pdf';
    }

    if (normalizedType.includes('wordprocessingml.document') || extension === '.docx') {
        return 'docx';
    }

    if (normalizedType.includes('text/html') || extension === '.html' || extension === '.htm') {
        return 'html';
    }

    if (normalizedType.includes('application/json') || extension === '.json') {
        return 'json';
    }

    if (
        normalizedType.startsWith('text/')
        || ['.txt', '.md', '.csv', '.rtf'].includes(extension)
        || looksLikeTextBuffer(buffer)
    ) {
        return 'text';
    }

    return 'unsupported';
}

async function extractResumeText(document) {
    const kind = detectResumeKind(document);

    switch (kind) {
        case 'pdf':
            return extractPdfText(document.buffer);
        case 'docx':
            return extractDocxText(document.buffer);
        case 'html':
            return stripHtml(document.buffer.toString('utf8'));
        case 'json':
            return cleanText(document.buffer.toString('utf8'));
        case 'text':
            return document.buffer.toString('utf8');
        default:
            throw httpError(400, 'Unsupported resume file type. Supported formats are PDF, DOCX, TXT, Markdown, HTML, and JSON.');
    }
}

async function fetchResumeFromUrl(resumeUrl) {
    let parsedUrl;

    try {
        parsedUrl = new URL(resumeUrl);
    } catch {
        throw httpError(400, 'The "resumeUrl" value must be a valid absolute URL.');
    }

    if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw httpError(400, 'The "resumeUrl" protocol must be http or https.');
    }

    let response;

    try {
        response = await fetch(parsedUrl, {
            redirect: 'follow',
            signal: AbortSignal.timeout(15000),
        });
    } catch (error) {
        throw httpError(400, `Failed to download resume from "resumeUrl": ${error.message}`);
    }

    if (!response.ok) {
        throw httpError(400, `Failed to download resume from "resumeUrl" (HTTP ${response.status}).`);
    }

    const contentLength = Number.parseInt(response.headers.get('content-length') ?? '', 10);
    if (Number.isFinite(contentLength) && contentLength > MAX_RESUME_FILE_BYTES) {
        throw httpError(400, `The downloaded resume exceeds the ${MAX_RESUME_FILE_BYTES} byte limit.`);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_RESUME_FILE_BYTES) {
        throw httpError(400, `The downloaded resume exceeds the ${MAX_RESUME_FILE_BYTES} byte limit.`);
    }

    return {
        buffer,
        contentType: response.headers.get('content-type') ?? '',
        fileName: path.basename(parsedUrl.pathname) || 'resume',
    };
}

function normalizeUploadedResumeFile(resumeFile) {
    if (!resumeFile || typeof resumeFile !== 'object' || !resumeFile.buffer) {
        throw httpError(400, 'The "resumeFile" upload is missing or invalid.');
    }

    const buffer = Buffer.isBuffer(resumeFile.buffer)
        ? resumeFile.buffer
        : Buffer.from(resumeFile.buffer);

    if (buffer.length === 0) {
        throw httpError(400, 'The uploaded resume file is empty.');
    }

    if (buffer.length > MAX_RESUME_FILE_BYTES) {
        throw httpError(400, `The uploaded resume exceeds the ${MAX_RESUME_FILE_BYTES} byte limit.`);
    }

    return {
        buffer,
        contentType: resumeFile.contentType ?? '',
        fileName: resumeFile.fileName ?? 'resume',
    };
}

function addTokenWeights(map, value, {
    weight,
    limit = Infinity,
    ignoreTokens = new Set(),
} = {}) {
    const seenCounts = new Map();

    for (const token of tokenize(value)) {
        if (ignoreTokens.has(token)) {
            continue;
        }

        const count = seenCounts.get(token) ?? 0;
        if (count >= limit) {
            continue;
        }

        seenCounts.set(token, count + 1);
        map.set(token, (map.get(token) ?? 0) + weight);
    }
}

function addPhraseWeights(map, value, {
    weight,
    limit = Infinity,
    minSize = 2,
    maxSize = 3,
} = {}) {
    const seenCounts = new Map();

    for (const phrase of extractPhrases(value, { minSize, maxSize, maxCount: 200 })) {
        const count = seenCounts.get(phrase) ?? 0;
        if (count >= limit) {
            continue;
        }

        seenCounts.set(phrase, count + 1);
        map.set(phrase, (map.get(phrase) ?? 0) + weight);
    }
}

function listOverlap(tokens, resumeTokenSet) {
    if (tokens.length === 0) {
        return 0;
    }

    const matches = tokens.filter((token) => resumeTokenSet.has(token)).length;
    return matches / tokens.length;
}

function extractPhrases(value, {
    minSize = 2,
    maxSize = 3,
    maxCount = 60,
} = {}) {
    const tokens = tokenize(value);
    const phrases = [];
    const seen = new Set();

    for (let size = minSize; size <= maxSize; size += 1) {
        for (let index = 0; index <= tokens.length - size; index += 1) {
            const phraseTokens = tokens.slice(index, index + size);
            const lowSignalCount = phraseTokens.filter((token) => LOW_SIGNAL_JOB_TOKENS.has(token)).length;
            if (
                phraseTokens.every((token) => LOW_SIGNAL_JOB_TOKENS.has(token))
                || LOW_SIGNAL_JOB_TOKENS.has(phraseTokens[0])
                || LOW_SIGNAL_JOB_TOKENS.has(phraseTokens.at(-1))
                || lowSignalCount >= Math.ceil(phraseTokens.length / 2)
            ) {
                continue;
            }

            const phrase = phraseTokens.join(' ');
            if (seen.has(phrase)) {
                continue;
            }

            seen.add(phrase);
            phrases.push(phrase);
            if (phrases.length >= maxCount) {
                return phrases;
            }
        }
    }

    return phrases;
}

function extractRoleFamilies(value) {
    const searchText = normalizeForSearch(value);
    const matches = [];

    for (const [family, patterns] of Object.entries(ROLE_FAMILY_PATTERNS)) {
        if (patterns.some((pattern) => hasPhrase(searchText, pattern))) {
            matches.push(family);
        }
    }

    return new Set(matches);
}

function resolveSeniorityLevel(value) {
    const searchText = normalizeForSearch(value);
    let match = null;

    for (const entry of SENIORITY_PATTERNS) {
        if (entry.patterns.some((pattern) => hasPhrase(searchText, pattern))) {
            match = Math.max(match ?? 0, entry.level);
        }
    }

    return match;
}

function extractResumeYears(value) {
    const matches = value.matchAll(/(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|to)\s*(\d{1,2}))?\s+years?/gi);
    let maxYears = null;

    for (const match of matches) {
        const low = Number.parseInt(match[1], 10);
        const high = Number.parseInt(match[2] ?? match[1], 10);
        if (!Number.isFinite(low) || !Number.isFinite(high)) {
            continue;
        }

        maxYears = Math.max(maxYears ?? 0, low, high);
    }

    return maxYears;
}

function extractJobMinimumYears(value) {
    const matches = value.matchAll(/(\d{1,2})\s*(?:\+|plus)?\s*(?:(?:-|to)\s*(\d{1,2}))?\s+years?/gi);
    let minimumYears = null;

    for (const match of matches) {
        const low = Number.parseInt(match[1], 10);
        if (!Number.isFinite(low)) {
            continue;
        }

        minimumYears = minimumYears == null ? low : Math.min(minimumYears, low);
    }

    return minimumYears;
}

function splitScannableFragments(value) {
    return unique(cleanText(value)
        .split(/\n+|(?<=[.!?])\s+|;/g)
        .map((fragment) => fragment.trim())
        .filter((fragment) => fragment.length >= 18 && fragment.length <= 260));
}

function matchesAnyPattern(value, patterns) {
    return patterns.some((pattern) => pattern.test(value));
}

function extractRequirementBuckets(value) {
    const required = [];
    const preferred = [];
    const responsibilities = [];

    for (const fragment of splitScannableFragments(value)) {
        if (matchesAnyPattern(fragment, PREFERRED_SIGNAL_PATTERNS)) {
            preferred.push(fragment);
            continue;
        }

        if (matchesAnyPattern(fragment, REQUIRED_SIGNAL_PATTERNS)) {
            required.push(fragment);
            continue;
        }

        if (matchesAnyPattern(fragment, RESPONSIBILITY_SIGNAL_PATTERNS)) {
            responsibilities.push(fragment);
        }
    }

    return {
        requiredText: required.slice(0, 18).join('\n'),
        preferredText: preferred.slice(0, 12).join('\n'),
        responsibilityText: responsibilities.slice(0, 12).join('\n'),
    };
}

function addSkillWeights(map, value, { weight } = {}) {
    const searchText = normalizeForSearch(value);
    if (!searchText.trim()) {
        return;
    }

    for (const [skill, patterns] of Object.entries(SKILL_PATTERNS)) {
        if (patterns.some((pattern) => hasPhrase(searchText, pattern))) {
            map.set(skill, (map.get(skill) ?? 0) + weight);
        }
    }
}

function extractCanonicalSkills(value) {
    const searchText = normalizeForSearch(value);
    const skills = [];

    for (const [skill, patterns] of Object.entries(SKILL_PATTERNS)) {
        if (patterns.some((pattern) => hasPhrase(searchText, pattern))) {
            skills.push(skill);
        }
    }

    return new Set(skills);
}

function roundMetric(value) {
    return Number(value.toFixed(2));
}

function buildResumeProfile(resumeText) {
    const normalizedText = normalizeForSearch(resumeText);
    const tokens = tokenize(resumeText);
    const tokenSet = new Set(tokens);
    const phraseSet = new Set(extractPhrases(resumeText, {
        minSize: 2,
        maxSize: 3,
        maxCount: 1200,
    }));
    const primaryResumeText = resumeText.slice(0, 1600);

    return {
        normalizedText,
        tokenSet,
        phraseSet,
        skillSet: extractCanonicalSkills(resumeText),
        yearsExperience: extractResumeYears(resumeText),
        seniorityLevel: resolveSeniorityLevel(resumeText),
        primaryRoleFamilies: extractRoleFamilies(primaryResumeText),
        roleFamilies: extractRoleFamilies(resumeText),
    };
}

function buildSortedWeights(weightMap) {
    return [...weightMap.entries()]
        .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]));
}

function buildJobProfile(job) {
    const title = job.title ?? '';
    const jobFunction = job.jobFunction ?? '';
    const seniorityLevel = job.seniorityLevel ?? '';
    const industries = job.industries ?? '';
    const employmentType = job.employmentType ?? '';
    const descriptionText = truncateText(job.descriptionText ?? '', 6000);
    const requirementBuckets = extractRequirementBuckets(descriptionText);
    const jobText = [title, jobFunction, seniorityLevel, industries, employmentType, descriptionText]
        .filter(Boolean)
        .join('\n');
    const keywordWeights = new Map();
    const phraseWeights = new Map();
    const skillWeights = new Map();
    const requiredSkillWeights = new Map();
    const titleSkillWeights = new Map();

    addTokenWeights(keywordWeights, title, { weight: 5, limit: 3, ignoreTokens: LOW_SIGNAL_JOB_TOKENS });
    addTokenWeights(keywordWeights, jobFunction, { weight: 4, limit: 3, ignoreTokens: LOW_SIGNAL_JOB_TOKENS });
    addTokenWeights(keywordWeights, seniorityLevel, { weight: 2.5, limit: 3, ignoreTokens: LOW_SIGNAL_JOB_TOKENS });
    addTokenWeights(keywordWeights, industries, { weight: 2, limit: 3, ignoreTokens: LOW_SIGNAL_JOB_TOKENS });
    addTokenWeights(keywordWeights, employmentType, { weight: 1.5, limit: 2, ignoreTokens: LOW_SIGNAL_JOB_TOKENS });
    addTokenWeights(keywordWeights, descriptionText, { weight: 1.2, limit: 3, ignoreTokens: LOW_SIGNAL_JOB_TOKENS });

    addPhraseWeights(phraseWeights, title, { weight: 5, limit: 2, minSize: 2, maxSize: 4 });
    addPhraseWeights(phraseWeights, jobFunction, { weight: 4, limit: 2, minSize: 2, maxSize: 3 });
    addPhraseWeights(phraseWeights, industries, { weight: 2, limit: 2, minSize: 2, maxSize: 3 });
    addPhraseWeights(phraseWeights, requirementBuckets.requiredText, { weight: 4.4, limit: 2, minSize: 2, maxSize: 4 });
    addPhraseWeights(phraseWeights, requirementBuckets.preferredText, { weight: 2.4, limit: 1, minSize: 2, maxSize: 4 });

    addSkillWeights(titleSkillWeights, title, { weight: 5.5 });
    addSkillWeights(titleSkillWeights, jobFunction, { weight: 4 });

    addSkillWeights(requiredSkillWeights, title, { weight: 5 });
    addSkillWeights(requiredSkillWeights, jobFunction, { weight: 4 });
    addSkillWeights(requiredSkillWeights, requirementBuckets.requiredText, { weight: 4.4 });
    addSkillWeights(requiredSkillWeights, requirementBuckets.responsibilityText, { weight: 2.2 });

    addSkillWeights(skillWeights, title, { weight: 5 });
    addSkillWeights(skillWeights, jobFunction, { weight: 4 });
    addSkillWeights(skillWeights, industries, { weight: 2 });
    addSkillWeights(skillWeights, requirementBuckets.requiredText, { weight: 4.2 });
    addSkillWeights(skillWeights, requirementBuckets.preferredText, { weight: 2.6 });
    addSkillWeights(skillWeights, descriptionText, { weight: 1.6 });

    return {
        normalizedText: normalizeForSearch(jobText),
        titleTokens: unique(tokenize(title)),
        primaryRoleFamilies: extractRoleFamilies([title, jobFunction].filter(Boolean).join('\n')),
        roleFamilies: extractRoleFamilies(jobText),
        seniorityLevel: resolveSeniorityLevel([seniorityLevel, title].filter(Boolean).join(' ')),
        minimumYears: extractJobMinimumYears(jobText),
        keywordWeights: buildSortedWeights(keywordWeights),
        phraseWeights: buildSortedWeights(phraseWeights),
        titleSkillWeights: buildSortedWeights(titleSkillWeights),
        requiredSkillWeights: buildSortedWeights(requiredSkillWeights),
        skillWeights: buildSortedWeights(skillWeights),
    };
}

function phraseMatchesResume(phrase, resumeProfile) {
    return resumeProfile.phraseSet.has(normalizePhrase(phrase)) || hasPhrase(resumeProfile.normalizedText, phrase);
}

function computeWeightedCoverage(entries, matcher, limit) {
    const selectedEntries = entries.slice(0, limit);
    const total = selectedEntries.reduce((sum, [, weight]) => sum + weight, 0);
    const matched = selectedEntries.reduce((sum, [value, weight]) => sum + (matcher(value) ? weight : 0), 0);

    return total === 0 ? 0 : matched / total;
}

function computeWeightedCoverageOrFallback(entries, matcher, limit, fallbackValue) {
    return entries.length === 0 ? fallbackValue : computeWeightedCoverage(entries, matcher, limit);
}

function collectMatchedValues(entries, matcher, limit) {
    return entries
        .slice(0, limit)
        .filter(([value]) => matcher(value))
        .map(([value]) => value);
}

function collectMissingValues(entries, matcher, limit) {
    return entries
        .slice(0, limit)
        .filter(([value]) => !matcher(value))
        .map(([value]) => value);
}

function computeRoleFamilyAlignment(jobPrimaryFamilies, jobFamilies, resumePrimaryFamilies, resumeFamilies) {
    const targetFamilies = jobPrimaryFamilies.size > 0 ? jobPrimaryFamilies : jobFamilies;
    const strongestResumeFamilies = resumePrimaryFamilies.size > 0 ? resumePrimaryFamilies : resumeFamilies;

    if (targetFamilies.size === 0) {
        return 0.65;
    }

    if (strongestResumeFamilies.size === 0 && resumeFamilies.size === 0) {
        return 0.3;
    }

    for (const family of targetFamilies) {
        if (strongestResumeFamilies.has(family)) {
            return 1;
        }
    }

    for (const family of targetFamilies) {
        if (resumeFamilies.has(family)) {
            return 0.55;
        }
    }

    return 0;
}

function computeSeniorityAlignment(jobLevel, resumeLevel) {
    if (!jobLevel) {
        return 0.7;
    }

    if (!resumeLevel) {
        return 0.55;
    }

    const difference = resumeLevel - jobLevel;
    if (difference >= 2) {
        return 0.85;
    }

    if (difference === 1) {
        return 0.95;
    }

    if (difference === 0) {
        return 1;
    }

    if (difference === -1) {
        return 0.7;
    }

    if (difference === -2) {
        return 0.45;
    }

    return 0.2;
}

function computeExperienceAlignment(jobMinimumYears, resumeYearsExperience) {
    if (!jobMinimumYears) {
        return resumeYearsExperience ? 0.75 : 0.6;
    }

    if (!resumeYearsExperience) {
        return 0.45;
    }

    const difference = resumeYearsExperience - jobMinimumYears;
    if (difference >= 2) {
        return 1;
    }

    if (difference >= 0) {
        return 0.9;
    }

    if (difference === -1) {
        return 0.72;
    }

    if (difference === -2) {
        return 0.52;
    }

    return 0.2;
}

function buildSummary({
    score,
    matchedKeywords,
    missingKeywords,
    matchedPhrases,
    missingPhrases,
}) {
    const positiveSignals = unique([...matchedPhrases, ...matchedKeywords]).slice(0, 3);
    const negativeSignals = unique([...missingPhrases, ...missingKeywords]).slice(0, 3);
    const matchedText = positiveSignals.length > 0
        ? `Matched on ${positiveSignals.join(', ')}`
        : 'Limited strong overlap with the resume';
    const missingText = negativeSignals.length > 0
        ? `gaps around ${negativeSignals.join(', ')}`
        : 'few obvious missing signals';

    return `Resume match ${score}/10. ${matchedText}; ${missingText}.`;
}

export function scoreResumeAgainstJob(job, resumeText) {
    return scoreResumeProfileAgainstJob(job, buildResumeProfile(resumeText));
}

function scoreResumeProfileAgainstJob(job, resumeProfile) {
    if (resumeProfile.tokenSet.size === 0) {
        return {
            score: 1,
            matchedKeywords: [],
            missingKeywords: [],
            matchedPhrases: [],
            missingPhrases: [],
            breakdown: {
                titleAlignment: 0,
                roleFamilyAlignment: 0,
                requiredSkillCoverage: 0,
                skillCoverage: 0,
                phraseCoverage: 0,
                keywordCoverage: 0,
                seniorityAlignment: 0,
                experienceAlignment: 0,
            },
            summary: 'Resume match 1/10. No readable resume content was available for matching.',
        };
    }

    const jobProfile = buildJobProfile(job);
    const baseTitleAlignment = Math.max(
        listOverlap(jobProfile.titleTokens, resumeProfile.tokenSet),
        computeWeightedCoverage(
            jobProfile.phraseWeights,
            (phrase) => phraseMatchesResume(phrase, resumeProfile),
            4,
        ),
    );
    const titleSkillAlignment = computeWeightedCoverageOrFallback(
        jobProfile.titleSkillWeights,
        (skill) => resumeProfile.skillSet.has(skill),
        6,
        0,
    );
    const titleAlignment = Math.max(baseTitleAlignment, titleSkillAlignment);
    const roleFamilyAlignment = computeRoleFamilyAlignment(
        jobProfile.primaryRoleFamilies,
        jobProfile.roleFamilies,
        resumeProfile.primaryRoleFamilies,
        resumeProfile.roleFamilies,
    );
    const phraseCoverage = computeWeightedCoverage(
        jobProfile.phraseWeights,
        (phrase) => phraseMatchesResume(phrase, resumeProfile),
        10,
    );
    const keywordCoverage = computeWeightedCoverage(
        jobProfile.keywordWeights,
        (token) => resumeProfile.tokenSet.has(token),
        16,
    );
    const requiredSkillCoverage = computeWeightedCoverageOrFallback(
        jobProfile.requiredSkillWeights,
        (skill) => resumeProfile.skillSet.has(skill),
        12,
        Math.max(titleAlignment, phraseCoverage, keywordCoverage, 0.64),
    );
    const skillCoverage = computeWeightedCoverageOrFallback(
        jobProfile.skillWeights,
        (skill) => resumeProfile.skillSet.has(skill),
        16,
        Math.max(phraseCoverage, keywordCoverage, 0.58),
    );
    const seniorityAlignment = computeSeniorityAlignment(jobProfile.seniorityLevel, resumeProfile.seniorityLevel);
    const experienceAlignment = computeExperienceAlignment(jobProfile.minimumYears, resumeProfile.yearsExperience);
    const matchedSkills = collectMatchedValues(
        jobProfile.requiredSkillWeights.length > 0 ? jobProfile.requiredSkillWeights : jobProfile.skillWeights,
        (skill) => resumeProfile.skillSet.has(skill),
        8,
    );
    const missingSkills = collectMissingValues(
        jobProfile.requiredSkillWeights.length > 0 ? jobProfile.requiredSkillWeights : jobProfile.skillWeights,
        (skill) => resumeProfile.skillSet.has(skill),
        8,
    );

    let normalizedScore = (
        (titleAlignment * 0.24)
        + (roleFamilyAlignment * 0.14)
        + (requiredSkillCoverage * 0.18)
        + (skillCoverage * 0.14)
        + (phraseCoverage * 0.12)
        + (keywordCoverage * 0.10)
        + (seniorityAlignment * 0.04)
        + (experienceAlignment * 0.04)
    );

    if (roleFamilyAlignment === 0 && resumeProfile.roleFamilies.size > 0) {
        normalizedScore -= 0.18;
    }

    if (titleAlignment < 0.28 && requiredSkillCoverage < 0.35 && skillCoverage < 0.35) {
        normalizedScore -= 0.12;
    }

    if (jobProfile.requiredSkillWeights.length >= 2 && requiredSkillCoverage < 0.35) {
        normalizedScore -= 0.18;
    }

    if (jobProfile.requiredSkillWeights.length >= 4 && missingSkills.length >= 3) {
        normalizedScore -= 0.08;
    }

    if (jobProfile.minimumYears && resumeProfile.yearsExperience && resumeProfile.yearsExperience + 2 < jobProfile.minimumYears) {
        normalizedScore -= 0.1;
    }

    if (titleAlignment > 0.85 && requiredSkillCoverage > 0.6) {
        normalizedScore += 0.08;
    }

    if (titleAlignment > 0.6 && roleFamilyAlignment > 0.9 && requiredSkillCoverage > 0.8) {
        normalizedScore += 0.05;
    }

    if (skillCoverage > 0.75 && phraseCoverage > 0.55) {
        normalizedScore += 0.05;
    }

    normalizedScore = Math.max(0, Math.min(1, normalizedScore));

    const score = Math.max(1, Math.min(10, Math.round(1 + (normalizedScore * 9))));
    const matchedKeywords = unique([
        ...matchedSkills,
        ...collectMatchedValues(
            jobProfile.keywordWeights,
            (token) => resumeProfile.tokenSet.has(token),
            8,
        ),
    ]).slice(0, 10);
    const missingKeywords = unique([
        ...missingSkills,
        ...collectMissingValues(
            jobProfile.keywordWeights,
            (token) => resumeProfile.tokenSet.has(token),
            8,
        ),
    ]).slice(0, 10);
    const matchedPhrases = collectMatchedValues(
        jobProfile.phraseWeights,
        (phrase) => phraseMatchesResume(phrase, resumeProfile),
        6,
    );
    const missingPhrases = collectMissingValues(
        jobProfile.phraseWeights,
        (phrase) => phraseMatchesResume(phrase, resumeProfile),
        6,
    );

    return {
        score,
        matchedKeywords,
        missingKeywords,
        matchedPhrases,
        missingPhrases,
        breakdown: {
            titleAlignment: roundMetric(titleAlignment),
            roleFamilyAlignment: roundMetric(roleFamilyAlignment),
            requiredSkillCoverage: roundMetric(requiredSkillCoverage),
            skillCoverage: roundMetric(skillCoverage),
            phraseCoverage: roundMetric(phraseCoverage),
            keywordCoverage: roundMetric(keywordCoverage),
            seniorityAlignment: roundMetric(seniorityAlignment),
            experienceAlignment: roundMetric(experienceAlignment),
        },
        summary: buildSummary({
            score,
            matchedKeywords,
            missingKeywords,
            matchedPhrases,
            missingPhrases,
        }),
    };
}

export async function createResumeMatcher({ resumeUrl, resumeFile } = {}) {
    if (!resumeUrl && !resumeFile) {
        return null;
    }

    if (resumeUrl && resumeFile) {
        throw httpError(400, 'Provide only one of "resumeUrl" or "resumeFile".');
    }

    const document = resumeUrl
        ? await fetchResumeFromUrl(resumeUrl)
        : normalizeUploadedResumeFile(resumeFile);
    const resumeText = cleanText(await extractResumeText(document));
    const resumeProfile = buildResumeProfile(resumeText);

    if (resumeText.length < 80 || resumeProfile.tokenSet.size < 10) {
        throw httpError(400, 'Could not extract enough readable text from the provided resume.');
    }

    return {
        resumeText: truncateText(resumeText),
        scoreJob(job) {
            return scoreResumeProfileAgainstJob(job, resumeProfile);
        },
    };
}
