const APPLIED_JOBS_STORAGE_KEY = 'linkedin-jobs-applied-job-ids';
const PREFERENCES_STORAGE_KEY = 'linkedin-jobs-frontend-preferences';
const SESSION_PROFILE_STORAGE_KEY = 'linkedin-jobs-session-profile';

const isBrowser = typeof document !== 'undefined';
const page = isBrowser ? document.body.dataset.page ?? '' : '';
const authMode = isBrowser ? document.body.dataset.authMode ?? '' : '';
const authRedirect = isBrowser ? document.body.dataset.authRedirect ?? '/app/account' : '/app/account';
const requiresAuth = isBrowser ? document.body.dataset.requiresAuth === 'true' : false;
const searchForm = isBrowser ? document.querySelector('#search-form') : null;
const accountForm = isBrowser ? document.querySelector('#account-form') : null;
const apiKeyInput = isBrowser ? document.querySelector('#api-key') : null;
const hideAppliedInput = isBrowser ? document.querySelector('#hide-applied') : null;
const resultsSummary = isBrowser ? document.querySelector('#results-summary') : null;
const resultsList = isBrowser ? document.querySelector('#results-list') : null;
const statusBanner = isBrowser ? document.querySelector('#status-banner') : null;
const searchButton = isBrowser ? document.querySelector('#search-button') : null;
const nextPageButton = isBrowser ? document.querySelector('#next-page') : null;
const previousPageButton = isBrowser ? document.querySelector('#previous-page') : null;
const resetFiltersButton = isBrowser ? document.querySelector('#reset-filters') : null;
const requestOtpButton = isBrowser ? document.querySelector('#request-otp') : null;
const verifyOtpButton = isBrowser ? document.querySelector('#verify-otp') : null;
const openVisibleButton = isBrowser ? document.querySelector('#open-visible') : null;
const clearAppliedButton = isBrowser ? document.querySelector('#clear-applied') : null;
const sendEmailButton = isBrowser ? document.querySelector('#send-email-now') : null;
const saveAlertButton = isBrowser ? document.querySelector('#save-email-alert') : null;
const refreshAlertsButton = isBrowser ? document.querySelector('#refresh-alerts') : null;
const jobCardTemplate = isBrowser ? document.querySelector('#job-card-template') : null;
const selectiveResetButtons = isBrowser ? [...document.querySelectorAll('[data-reset-target]')] : [];
const resumeFileState = isBrowser ? document.querySelector('#resume-file-state') : null;
const alertsList = isBrowser ? document.querySelector('#alerts-list') : null;
const alertsSummary = isBrowser ? document.querySelector('#alerts-summary') : null;
const cronPresetButtons = isBrowser ? [...document.querySelectorAll('[data-cron-value]')] : [];
const authGate = isBrowser ? document.querySelector('[data-auth-gate]') : null;
const protectedContent = isBrowser ? document.querySelector('[data-protected-content]') : null;
const authOnlyNodes = isBrowser ? [...document.querySelectorAll('[data-auth-only]')] : [];
const guestOnlyNodes = isBrowser ? [...document.querySelectorAll('[data-guest-only]')] : [];
const signOutButtons = isBrowser ? [...document.querySelectorAll('[data-signout]')] : [];
const sessionStateNodes = isBrowser ? [...document.querySelectorAll('[data-session-state]')] : [];
const sessionEmailNodes = isBrowser ? [...document.querySelectorAll('[data-session-email]')] : [];
const sessionNameNodes = isBrowser ? [...document.querySelectorAll('[data-session-name]')] : [];
const refreshSessionButton = isBrowser ? document.querySelector('#refresh-session') : null;
const copyApiKeyButton = isBrowser ? document.querySelector('#copy-api-key') : null;

let lastResponse = null;
let lastVisibleItems = [];

if (isBrowser) {
    bootstrap();
}

function getField(fieldName) {
    return searchForm?.elements?.namedItem(fieldName)
        ?? accountForm?.elements?.namedItem(fieldName)
        ?? null;
}

function readFieldValue(fieldName, fallback = '') {
    const field = getField(fieldName);
    return typeof field?.value === 'string' ? field.value : fallback;
}

function readTrimmedFieldValue(fieldName) {
    return readFieldValue(fieldName).trim();
}

function readSelectedValues(fieldName) {
    const field = getField(fieldName);
    if (!field?.selectedOptions) {
        return [];
    }

    return [...field.selectedOptions].map((option) => option.value);
}

function readFileValue(fieldName) {
    const field = getField(fieldName);
    return field?.files?.[0] ?? null;
}

function normalizeCronLines(value) {
    return [...new Set(`${value ?? ''}`
        .split(/\r?\n+/g)
        .map((line) => line.trim())
        .filter(Boolean))];
}

function appendCronPreset(cronValue) {
    const cronField = getField('cronExpression');
    if (!cronField || !cronValue) {
        return;
    }

    const lines = normalizeCronLines(cronField.value);
    if (!lines.includes(cronValue)) {
        lines.push(cronValue);
    }

    cronField.value = lines.join('\n');
    persistPreferences();
}

function bootstrap() {
    hydratePreferences();
    renderSessionChrome();

    if (requiresAuth && !getActiveApiKey()) {
        redirectToLogin();
        return;
    }

    if (resultsList) {
        renderResults([]);
    }

    if (resultsSummary) {
        updateSummary();
    }

    if (searchForm && searchButton) {
        searchForm.addEventListener('submit', handleSearchSubmit);
    } else if (searchForm) {
        searchForm.addEventListener('submit', (event) => {
            event.preventDefault();
        });
    }

    nextPageButton?.addEventListener('click', () => changePageNumber(1));
    previousPageButton?.addEventListener('click', () => changePageNumber(-1));
    resetFiltersButton?.addEventListener('click', handleReset);
    requestOtpButton?.addEventListener('click', handleRequestOtp);
    verifyOtpButton?.addEventListener('click', handleVerifyOtp);
    openVisibleButton?.addEventListener('click', openVisibleJobs);
    clearAppliedButton?.addEventListener('click', clearAppliedJobs);
    sendEmailButton?.addEventListener('click', handleSendEmail);
    saveAlertButton?.addEventListener('click', handleSaveAlert);
    refreshAlertsButton?.addEventListener('click', loadAlerts);
    selectiveResetButtons.forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            resetField(button.dataset.resetTarget);
        });
    });
    cronPresetButtons.forEach((button) => {
        button.addEventListener('click', () => {
            appendCronPreset(button.dataset.cronValue);
        });
    });
    hideAppliedInput?.addEventListener('change', () => {
        persistPreferences();
        rerenderFromLastResponse();
    });
    apiKeyInput?.addEventListener('change', () => {
        persistPreferences();
        renderSessionChrome();
    });
    apiKeyInput?.addEventListener('blur', async () => {
        persistPreferences();
        renderSessionChrome();
        if (apiKeyInput?.value?.trim()) {
            await refreshSessionProfile({ silent: true });
        }
    });
    getField('resumeFile')?.addEventListener('change', updateResumeFileState);
    getField('cronExpression')?.addEventListener('input', persistPreferences);
    refreshSessionButton?.addEventListener('click', async () => {
        try {
            setLoadingState(true);
            await refreshSessionProfile();
            showStatus('Session refreshed.', 'success');
        } catch (error) {
            showStatus(error.message, 'error');
        } finally {
            setLoadingState(false);
        }
    });
    copyApiKeyButton?.addEventListener('click', handleCopyApiKey);
    signOutButtons.forEach((button) => {
        button.addEventListener('click', handleSignOut);
    });
    updateResumeFileState();

    if (alertsList) {
        loadAlerts().catch(() => {
            renderAlerts([]);
        });
    }

    if (getActiveApiKey()) {
        void refreshSessionProfile({ silent: true });
    }
}

function defaultApiKeyValue() {
    if (!isBrowser) {
        return '';
    }

    const host = window.location.hostname;
    return host === 'localhost' || host === '127.0.0.1'
        ? 'change-me-local-dev-api-key'
        : '';
}

function readStoredPreferences() {
    if (!isBrowser) {
        return {};
    }

    try {
        const value = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? '{}');
        return value && typeof value === 'object' ? value : {};
    } catch {
        return {};
    }
}

function writeStoredPreferences(preferences) {
    if (!isBrowser) {
        return;
    }

    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

function getNextPath() {
    if (!isBrowser) {
        return authRedirect;
    }

    const params = new URLSearchParams(window.location.search);
    return params.get('next') || authRedirect;
}

function redirectToLogin() {
    if (!isBrowser) {
        return;
    }

    const next = `${window.location.pathname}${window.location.search}` || '/app/account';
    const params = new URLSearchParams({ next });
    window.location.replace(`/login?${params.toString()}`);
}

function getActiveApiKey() {
    const storedApiKey = `${readStoredPreferences().apiKey ?? ''}`.trim();
    return apiKeyInput?.value?.trim?.() || storedApiKey || '';
}

function setActiveApiKey(apiKey) {
    const normalized = `${apiKey ?? ''}`.trim();
    if (apiKeyInput) {
        apiKeyInput.value = normalized;
    }

    writeStoredPreferences({
        ...readStoredPreferences(),
        apiKey: normalized,
    });
}

function getStoredSessionProfile() {
    if (!isBrowser) {
        return null;
    }

    try {
        const value = JSON.parse(localStorage.getItem(SESSION_PROFILE_STORAGE_KEY) ?? 'null');
        return value && typeof value === 'object' ? value : null;
    } catch {
        return null;
    }
}

function saveSessionProfile(profile) {
    if (!isBrowser) {
        return;
    }

    if (!profile || typeof profile !== 'object') {
        localStorage.removeItem(SESSION_PROFILE_STORAGE_KEY);
        return;
    }

    localStorage.setItem(SESSION_PROFILE_STORAGE_KEY, JSON.stringify(profile));
}

function applyAuthGateState(isAuthenticated) {
    if (authGate) {
        authGate.hidden = isAuthenticated;
    }

    if (protectedContent) {
        protectedContent.hidden = !isAuthenticated;
    }
}

function renderSessionChrome(profile = getStoredSessionProfile()) {
    const preferences = readStoredPreferences();
    const isAuthenticated = Boolean(getActiveApiKey());
    const email = profile?.email
        || readTrimmedFieldValue('signupEmail')
        || preferences.signupEmail
        || (isAuthenticated ? 'Signed-in session ready' : 'Use email OTP to start a session');
    const name = profile?.name
        || readTrimmedFieldValue('signupName')
        || preferences.signupName
        || (isAuthenticated ? 'ApplyDesk user' : 'Guest');
    const stateLabel = isAuthenticated ? 'Signed in' : 'Guest mode';

    sessionStateNodes.forEach((node) => {
        node.textContent = stateLabel;
    });
    sessionEmailNodes.forEach((node) => {
        node.textContent = email;
    });
    sessionNameNodes.forEach((node) => {
        node.textContent = name;
    });
    authOnlyNodes.forEach((node) => {
        node.hidden = !isAuthenticated;
    });
    guestOnlyNodes.forEach((node) => {
        node.hidden = isAuthenticated;
    });

    if (refreshSessionButton) {
        refreshSessionButton.disabled = !isAuthenticated;
    }

    if (copyApiKeyButton) {
        copyApiKeyButton.disabled = !isAuthenticated;
    }

    if (requiresAuth) {
        applyAuthGateState(isAuthenticated);
    }
}

function normalizeSessionProfile(profile) {
    if (!profile || typeof profile !== 'object') {
        return null;
    }

    return {
        clientId: profile.clientId ?? null,
        email: profile.email ?? null,
        name: profile.name ?? null,
        role: profile.role ?? null,
    };
}

function fillSessionFields(profile) {
    if (!profile) {
        return;
    }

    const emailField = getField('signupEmail');
    if (emailField && profile.email) {
        emailField.value = profile.email;
    }

    const nameField = getField('signupName');
    if (nameField && profile.name) {
        nameField.value = profile.name;
    }

    const deliveryEmailField = getField('deliveryEmail');
    if (deliveryEmailField && !deliveryEmailField.value && profile.email) {
        deliveryEmailField.value = profile.email;
    }
}

async function refreshSessionProfile({ silent = false } = {}) {
    const apiKey = getActiveApiKey();
    if (!apiKey) {
        saveSessionProfile(null);
        renderSessionChrome(null);
        return null;
    }

    try {
        const response = await request('/v1/auth/me', {
            method: 'GET',
            headers: {
                'x-api-key': apiKey,
            },
        });
        const profile = normalizeSessionProfile(response.identity);
        saveSessionProfile(profile);
        fillSessionFields(profile);
        persistPreferences();
        renderSessionChrome(profile);
        return profile;
    } catch (error) {
        if (`${error.message ?? ''}`.toLowerCase().includes('api key')) {
            if (apiKeyInput) {
                apiKeyInput.value = '';
            }
            writeStoredPreferences({
                ...readStoredPreferences(),
                apiKey: '',
            });
            saveSessionProfile(null);
            persistPreferences();
            renderSessionChrome(null);
            if (requiresAuth) {
                redirectToLogin();
            }
        }

        if (!silent) {
            throw error;
        }

        renderSessionChrome(getStoredSessionProfile());
        return null;
    }
}

async function handleSearchSubmit(event) {
    event.preventDefault();

    const payload = buildPayload(searchForm);
    const validationError = validatePayload(payload);
    if (validationError) {
        showStatus(validationError, 'error');
        return;
    }

    setLoadingState(true);
    showStatus(`Searching page ${payload.pageNumber}...`);

    try {
        const response = await searchJobs(payload);
        lastResponse = {
            payload,
            response,
        };

        persistPreferences();
        rerenderFromLastResponse();
        showStatus('Results loaded.', 'success');
    } catch (error) {
        showStatus(error.message, 'error');
    } finally {
        setLoadingState(false);
    }
}

async function handleSendEmail() {
    const payload = buildPayload(searchForm);
    const validationError = validatePayload(payload, {
        requireDeliveryEmail: true,
    });
    if (validationError) {
        showStatus(validationError, 'error');
        return;
    }

    setLoadingState(true);
    showStatus('Sending jobs email...');

    try {
        const response = await sendJobsByEmail(payload);
        persistPreferences();
        showStatus(`Sent ${response.count} jobs to ${response.recipientEmail}.`, 'success');
    } catch (error) {
        showStatus(error.message, 'error');
    } finally {
        setLoadingState(false);
    }
}

async function handleRequestOtp() {
    const email = readTrimmedFieldValue('signupEmail');
    if (!email) {
        showStatus('Email is required.', 'error');
        return;
    }

    setLoadingState(true);
    showStatus('Sending OTP...');

    try {
        await request('/v1/auth/email/request-otp', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                email,
                name: authMode === 'signup' ? (readTrimmedFieldValue('signupName') || undefined) : undefined,
            }),
        });
        persistPreferences();
        showStatus(`OTP sent to ${email}.`, 'success');
    } catch (error) {
        showStatus(error.message, 'error');
    } finally {
        setLoadingState(false);
    }
}

async function handleVerifyOtp() {
    const email = readTrimmedFieldValue('signupEmail');
    const otp = readTrimmedFieldValue('signupOtp');
    if (!email || !otp) {
        showStatus('Email and OTP are required.', 'error');
        return;
    }

    setLoadingState(true);
    showStatus('Verifying OTP...');

    try {
        const response = await request('/v1/auth/email/verify-otp', {
            method: 'POST',
            headers: {
                'content-type': 'application/json',
            },
            body: JSON.stringify({
                email,
                otp,
                name: authMode === 'signup' ? (readTrimmedFieldValue('signupName') || undefined) : undefined,
            }),
        });
        setActiveApiKey(response.apiKey);
        const otpField = getField('signupOtp');
        if (otpField) {
            otpField.value = '';
        }
        const profile = normalizeSessionProfile(response.user);
        saveSessionProfile(profile);
        fillSessionFields(profile);
        persistPreferences();
        renderSessionChrome(profile);
        showStatus(
            authMode === 'login'
                ? `Logged in as ${response.user.email}. Redirecting to the dashboard.`
                : `Account created for ${response.user.email}. Redirecting to the dashboard.`,
            'success',
        );
        const redirectPath = getNextPath();
        if (redirectPath) {
            window.setTimeout(() => {
                window.location.assign(redirectPath);
            }, 500);
        }
    } catch (error) {
        showStatus(error.message, 'error');
    } finally {
        setLoadingState(false);
    }
}

async function handleCopyApiKey() {
    const apiKey = getActiveApiKey();
    if (!apiKey) {
        showStatus('No API key is loaded.', 'error');
        return;
    }

    try {
        if (!navigator?.clipboard?.writeText) {
            throw new Error('Clipboard unavailable');
        }
        await navigator.clipboard.writeText(apiKey);
        showStatus('API key copied.', 'success');
    } catch {
        showStatus('Clipboard access is unavailable in this browser.', 'error');
    }
}

function handleSignOut() {
    const preferences = readStoredPreferences();
    if (apiKeyInput) {
        apiKeyInput.value = '';
    }

    writeStoredPreferences({
        ...preferences,
        apiKey: '',
    });
    saveSessionProfile(null);
    persistPreferences();
    renderSessionChrome(null);
    hideStatus();

    if (requiresAuth) {
        redirectToLogin();
    }
}

async function handleSaveAlert() {
    const payload = buildPayload(searchForm);
    const validationError = validatePayload(payload, {
        requireDeliveryEmail: true,
        requireCronExpression: true,
    });
    if (validationError) {
        showStatus(validationError, 'error');
        return;
    }

    setLoadingState(true);
    showStatus('Saving email alert...');

    try {
        const response = await createEmailAlert(payload);
        persistPreferences();
        await loadAlerts();
        const count = response.count ?? response.alerts?.length ?? (response.alert ? 1 : 0);
        const nextRunAt = response.alert?.nextRunAt;
        showStatus(
            count > 1
                ? `Saved ${count} alerts. First next run: ${formatDateTime(nextRunAt)}.`
                : `Saved alert for ${response.alert.recipientEmail}. Next run: ${formatDateTime(nextRunAt)}.`,
            'success',
        );
    } catch (error) {
        showStatus(error.message, 'error');
    } finally {
        setLoadingState(false);
    }
}

function handleReset() {
    const existingApiKey = getActiveApiKey();
    searchForm?.reset();

    if (apiKeyInput) {
        apiKeyInput.value = existingApiKey || defaultApiKeyValue();
    }

    if (hideAppliedInput) {
        hideAppliedInput.checked = true;
    }

    if (getField('rows')) {
        getField('rows').value = 10;
    }

    if (getField('pageNumber')) {
        getField('pageNumber').value = 1;
    }

    if (getField('requestDelayMs')) {
        getField('requestDelayMs').value = 600;
    }

    if (getField('detailConcurrency')) {
        getField('detailConcurrency').value = 3;
    }

    if (getField('cronPreset')) {
        getField('cronPreset').value = '0 * * * *';
    }

    if (getField('cronExpression')) {
        getField('cronExpression').value = '0 * * * *';
    }

    lastResponse = null;
    lastVisibleItems = [];

    if (resultsList) {
        renderResults([]);
    }

    if (resultsSummary) {
        updateSummary();
    }

    updateResumeFileState();
    persistPreferences();
    renderSessionChrome();
    hideStatus();
}

function resetField(fieldName) {
    const field = getField(fieldName);
    if (!field) {
        return;
    }

    if (typeof HTMLSelectElement !== 'undefined' && field instanceof HTMLSelectElement) {
        [...field.options].forEach((option) => {
            option.selected = false;
        });
    } else if (field.type === 'file') {
        field.value = '';
        updateResumeFileState();
    } else {
        field.value = '';
    }

    persistPreferences();
}

function changePageNumber(delta) {
    const pageNumberField = getField('pageNumber');
    if (!pageNumberField || !searchForm) {
        return;
    }

    const currentValue = Number.parseInt(pageNumberField.value || '1', 10);
    const nextValue = Math.max(1, currentValue + delta);
    pageNumberField.value = nextValue;
    searchForm.requestSubmit();
}

function buildPayload(currentForm) {
    const selectedValues = (fieldName) => {
        const field = currentForm?.elements?.namedItem(fieldName);
        return field?.selectedOptions ? [...field.selectedOptions].map((option) => option.value) : [];
    };
    const parseList = (value) => value.split(',').map((item) => item.trim()).filter(Boolean);
    const parseOptionalNumber = (value) => {
        if (!value) {
            return null;
        }

        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    return {
        alertName: currentForm?.elements?.alertName?.value?.trim?.() ?? '',
        title: currentForm?.elements?.title?.value?.trim?.() ?? '',
        location: currentForm?.elements?.location?.value?.trim?.() ?? '',
        rows: Number.parseInt(currentForm?.elements?.rows?.value || '10', 10),
        pageNumber: Number.parseInt(currentForm?.elements?.pageNumber?.value || '1', 10),
        publishedAt: currentForm?.elements?.publishedAt?.value ?? '',
        companyName: parseList(currentForm?.elements?.companyName?.value ?? ''),
        companyId: parseList(currentForm?.elements?.companyId?.value ?? ''),
        workType: selectedValues('workType'),
        contractType: selectedValues('contractType'),
        experienceLevel: selectedValues('experienceLevel'),
        resumeUrl: currentForm?.elements?.resumeUrl?.value?.trim?.() ?? '',
        resumeFile: currentForm?.elements?.resumeFile?.files?.[0] ?? null,
        resumeMatchMinScore: parseOptionalNumber(currentForm?.elements?.resumeMatchMinScore?.value ?? ''),
        resumeMatchMaxScore: parseOptionalNumber(currentForm?.elements?.resumeMatchMaxScore?.value ?? ''),
        requestDelayMs: Number.parseInt(currentForm?.elements?.requestDelayMs?.value || '600', 10),
        detailConcurrency: Number.parseInt(currentForm?.elements?.detailConcurrency?.value || '3', 10),
        deliveryEmail: currentForm?.elements?.deliveryEmail?.value?.trim?.() ?? '',
        cronExpression: currentForm?.elements?.cronExpression?.value?.trim?.() ?? '',
    };
}

async function searchJobs(payload) {
    return requestWithSearchPayload('/v1/jobs/search', payload);
}

async function sendJobsByEmail(payload) {
    return requestWithSearchPayload('/v1/jobs/deliveries/send', payload);
}

async function createEmailAlert(payload) {
    return requestWithSearchPayload('/v1/jobs/alerts', payload);
}

async function requestWithSearchPayload(path, payload) {
    const apiKey = getActiveApiKey();
    if (!apiKey) {
        throw new Error('Log in to continue.');
    }

    const headers = {
        'x-api-key': apiKey,
    };

    if (payload.resumeFile) {
        const formData = new FormData();
        appendFormDataValue(formData, 'title', payload.title);
        appendFormDataValue(formData, 'location', payload.location);
        appendFormDataValue(formData, 'rows', payload.rows);
        appendFormDataValue(formData, 'pageNumber', payload.pageNumber);
        appendFormDataValue(formData, 'publishedAt', payload.publishedAt);
        appendFormDataValue(formData, 'companyName', payload.companyName.join(','));
        appendFormDataValue(formData, 'companyId', payload.companyId.join(','));
        appendFormDataValue(formData, 'workType', payload.workType.join(','));
        appendFormDataValue(formData, 'contractType', payload.contractType.join(','));
        appendFormDataValue(formData, 'experienceLevel', payload.experienceLevel.join(','));
        appendFormDataValue(formData, 'resumeUrl', payload.resumeUrl);
        appendFormDataValue(formData, 'resumeMatchMinScore', payload.resumeMatchMinScore);
        appendFormDataValue(formData, 'resumeMatchMaxScore', payload.resumeMatchMaxScore);
        appendFormDataValue(formData, 'requestDelayMs', payload.requestDelayMs);
        appendFormDataValue(formData, 'detailConcurrency', payload.detailConcurrency);
        appendFormDataValue(formData, 'alertName', payload.alertName);
        appendFormDataValue(formData, 'deliveryEmail', payload.deliveryEmail);
        appendFormDataValue(formData, 'cronExpression', payload.cronExpression);
        formData.append('resumeFile', payload.resumeFile);

        return request(path, {
            method: 'POST',
            headers,
            body: formData,
        });
    }

    headers['content-type'] = 'application/json';

    return request(path, {
        method: 'POST',
        headers,
        body: JSON.stringify({
            title: payload.title || undefined,
            location: payload.location || undefined,
            alertName: payload.alertName || undefined,
            rows: payload.rows,
            pageNumber: payload.pageNumber,
            publishedAt: payload.publishedAt || undefined,
            companyName: payload.companyName,
            companyId: payload.companyId,
            workType: payload.workType,
            contractType: payload.contractType,
            experienceLevel: payload.experienceLevel,
            resumeUrl: payload.resumeUrl || undefined,
            resumeMatchMinScore: payload.resumeMatchMinScore ?? undefined,
            resumeMatchMaxScore: payload.resumeMatchMaxScore ?? undefined,
            requestDelayMs: payload.requestDelayMs,
            detailConcurrency: payload.detailConcurrency,
            deliveryEmail: payload.deliveryEmail || undefined,
            cronExpression: payload.cronExpression || undefined,
        }),
    });
}

async function request(path, options) {
    const response = await fetch(path, options);
    const text = await response.text();
    const payload = text ? JSON.parse(text) : {};

    if (!response.ok) {
        throw new Error(payload.error ?? `Request failed with status ${response.status}`);
    }

    return payload;
}

function appendFormDataValue(formData, key, value) {
    if (value == null || value === '') {
        return;
    }

    formData.append(key, `${value}`);
}

function validatePayload(payload, { requireDeliveryEmail = false, requireCronExpression = false } = {}) {
    if (!payload.title && payload.companyName.length === 0 && payload.companyId.length === 0) {
        return 'Provide at least a title, company name, or company ID.';
    }

    if (payload.resumeUrl && payload.resumeFile) {
        return 'Provide either a resume URL or a resume file, not both.';
    }

    if (
        payload.resumeMatchMinScore != null
        && payload.resumeMatchMaxScore != null
        && payload.resumeMatchMinScore > payload.resumeMatchMaxScore
    ) {
        return 'Min score cannot be greater than max score.';
    }

    if (requireDeliveryEmail && !payload.deliveryEmail) {
        return 'Delivery email is required.';
    }

    if (requireCronExpression && !payload.cronExpression) {
        return 'Cron expression is required for email alerts.';
    }

    if (requireCronExpression && normalizeCronLines(payload.cronExpression).length === 0) {
        return 'Provide at least one cron expression for email alerts.';
    }

    return null;
}

function updateResumeFileState() {
    if (!resumeFileState) {
        return;
    }

    const file = readFileValue('resumeFile');
    resumeFileState.textContent = file
        ? `${file.name} · ${(file.size / 1024).toFixed(1)} KB`
        : 'No file selected';
}

function rerenderFromLastResponse() {
    if (!lastResponse) {
        renderResults([]);
        updateSummary();
        return;
    }

    const appliedJobs = getAppliedJobIds();
    const hideApplied = hideAppliedInput.checked;
    const visibleItems = lastResponse.response.items.filter((item) => !hideApplied || !appliedJobs.has(item.jobId));
    lastVisibleItems = visibleItems;
    renderResults(visibleItems);
    updateSummary(visibleItems.length);
}

function renderResults(items) {
    if (!resultsList || !jobCardTemplate) {
        return;
    }

    resultsList.innerHTML = '';

    if (items.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.textContent = lastResponse
            ? 'No visible jobs for this page after the current filters.'
            : 'No jobs loaded yet.';
        resultsList.append(emptyState);
        return;
    }

    const appliedJobs = getAppliedJobIds();

    for (const item of items) {
        const fragment = jobCardTemplate.content.cloneNode(true);
        const card = fragment.querySelector('.job-card');
        const meta = fragment.querySelector('.job-card__meta');
        const title = fragment.querySelector('.job-card__title');
        const company = fragment.querySelector('.job-card__company');
        const score = fragment.querySelector('.job-card__score');
        const chips = fragment.querySelector('.job-card__chips');
        const summary = fragment.querySelector('.job-card__summary');
        const breakdown = fragment.querySelector('.job-card__breakdown');
        const applyButton = fragment.querySelector('.job-card__apply');
        const toggleButton = fragment.querySelector('.job-card__toggle');

        const isApplied = appliedJobs.has(item.jobId);
        card.dataset.applied = `${isApplied}`;
        meta.textContent = [item.location, item.postedTimeAgo || item.listedAtText, `Job ID ${item.jobId}`].filter(Boolean).join(' · ');
        title.textContent = item.title ?? 'Untitled role';
        company.textContent = item.companyName ?? 'Unknown company';
        summary.textContent = item.resumeMatch?.summary ?? item.descriptionText?.slice(0, 220) ?? 'No summary available.';

        if (item.resumeMatch) {
            score.innerHTML = `<strong>${item.resumeMatch.score}</strong><span>/10 match</span>`;
        } else {
            score.innerHTML = '<strong>--</strong><span>No resume</span>';
        }

        applyButton.href = item.url ?? '#';
        applyButton.textContent = isApplied ? 'Open applied job' : 'Open job';

        const breakdownItems = [
            createChip(item.employmentType, 'default'),
            createChip(item.seniorityLevel, 'default'),
            createChip(item.industries, 'default'),
            createChip(item.resumeMatch?.matchedPhrases?.[0], 'accent'),
            createChip(item.resumeMatch?.matchedKeywords?.[0], 'olive'),
        ].filter(Boolean);

        for (const chip of breakdownItems) {
            chips.append(chip);
        }

        if (item.resumeMatch?.breakdown) {
            for (const [key, value] of Object.entries(item.resumeMatch.breakdown)) {
                breakdown.append(createChip(`${humanizeMetricName(key)} ${value}`, 'default'));
            }
        }

        toggleButton.textContent = isApplied ? 'Remove applied mark' : 'Mark applied';
        toggleButton.addEventListener('click', () => {
            toggleAppliedJob(item.jobId);
            rerenderFromLastResponse();
        });

        resultsList.append(fragment);
    }
}

function createChip(value, tone) {
    if (!value) {
        return null;
    }

    const chip = document.createElement('span');
    chip.className = `chip${tone === 'accent' ? ' chip--accent' : tone === 'olive' ? ' chip--olive' : ''}`;
    chip.textContent = value;
    return chip;
}

function humanizeMetricName(value) {
    return value
        .replace(/([A-Z])/g, ' $1')
        .replace(/^./, (letter) => letter.toUpperCase());
}

function updateSummary(visibleCount = 0) {
    if (!resultsSummary) {
        return;
    }

    if (!lastResponse) {
        resultsSummary.textContent = 'Run a search to load jobs.';
        return;
    }

    const { payload, response } = lastResponse;
    const pageText = `Page ${payload.pageNumber} · ${payload.rows} rows`;
    const scoredText = response.resumeMatchScoredCount != null
        ? ` · scored ${response.resumeMatchScoredCount}`
        : '';
    resultsSummary.textContent = `${pageText} · visible ${visibleCount} / returned ${response.count}${scoredText} · scanned ${response.pagesScanned} search pages`;
}

function setLoadingState(isLoading) {
    if (requestOtpButton) {
        requestOtpButton.disabled = isLoading;
        requestOtpButton.textContent = isLoading ? 'Working…' : 'Send OTP';
    }

    if (verifyOtpButton) {
        verifyOtpButton.disabled = isLoading;
        verifyOtpButton.textContent = isLoading
            ? 'Working…'
            : authMode === 'signup'
            ? 'Create Account'
            : authMode === 'login'
            ? 'Log In'
            : 'Verify And Use API Key';
    }

    if (searchButton) {
        searchButton.disabled = isLoading;
        searchButton.textContent = isLoading ? 'Working…' : 'Search Jobs';
    }

    nextPageButton && (nextPageButton.disabled = isLoading);
    previousPageButton && (previousPageButton.disabled = isLoading);

    if (sendEmailButton) {
        sendEmailButton.disabled = isLoading;
        sendEmailButton.textContent = isLoading ? 'Working…' : 'Send Jobs Now';
    }

    if (saveAlertButton) {
        saveAlertButton.disabled = isLoading;
        saveAlertButton.textContent = isLoading ? 'Working…' : 'Save Email Alert';
    }

    if (refreshAlertsButton) {
        refreshAlertsButton.disabled = isLoading;
    }
}

function showStatus(message, tone) {
    if (!statusBanner) {
        return;
    }

    statusBanner.hidden = false;
    statusBanner.dataset.tone = tone ?? '';
    statusBanner.textContent = message;
}

function hideStatus() {
    if (!statusBanner) {
        return;
    }

    statusBanner.hidden = true;
    statusBanner.textContent = '';
    delete statusBanner.dataset.tone;
}

function getAppliedJobIds() {
    try {
        const value = JSON.parse(localStorage.getItem(APPLIED_JOBS_STORAGE_KEY) ?? '[]');
        return new Set(Array.isArray(value) ? value : []);
    } catch {
        return new Set();
    }
}

function saveAppliedJobIds(appliedJobs) {
    localStorage.setItem(APPLIED_JOBS_STORAGE_KEY, JSON.stringify([...appliedJobs]));
}

function markAppliedJob(jobId) {
    const appliedJobs = getAppliedJobIds();
    appliedJobs.add(jobId);
    saveAppliedJobIds(appliedJobs);
}

function toggleAppliedJob(jobId) {
    const appliedJobs = getAppliedJobIds();
    if (appliedJobs.has(jobId)) {
        appliedJobs.delete(jobId);
    } else {
        appliedJobs.add(jobId);
    }
    saveAppliedJobIds(appliedJobs);
}

function clearAppliedJobs() {
    localStorage.removeItem(APPLIED_JOBS_STORAGE_KEY);
    rerenderFromLastResponse();
    showStatus('Local applied marks cleared.', 'success');
}

function openVisibleJobs() {
    if (lastVisibleItems.length === 0) {
        showStatus('No visible jobs to open.', 'error');
        return;
    }

    for (const item of lastVisibleItems) {
        if (item.url) {
            window.open(item.url, '_blank', 'noopener,noreferrer');
        }
    }
    showStatus(`Opened ${lastVisibleItems.length} jobs in new tabs. Mark applied separately when you want to hide them.`, 'success');
}

async function loadAlerts() {
    try {
        const apiKey = getActiveApiKey();
        if (!alertsList || !apiKey) {
            renderAlerts([], {
                emptySummary: 'Log in to view and manage saved schedules.',
            });
            return;
        }

        if (refreshAlertsButton) {
            refreshAlertsButton.disabled = true;
        }
        const response = await request('/v1/jobs/alerts', {
            method: 'GET',
            headers: {
                'x-api-key': apiKey,
            },
        });
        renderAlerts(response.alerts ?? []);
    } catch (error) {
        renderAlerts([]);
        showStatus(error.message, 'error');
    } finally {
        if (refreshAlertsButton) {
            refreshAlertsButton.disabled = false;
        }
    }
}

function renderAlerts(alerts, options = {}) {
    if (!alertsList) {
        return;
    }

    alertsList.innerHTML = '';
    if (alertsSummary) {
        alertsSummary.textContent = alerts.length === 0
            ? (options.emptySummary ?? 'No saved alerts yet. Save one or more cron lines to create recurring deliveries.')
            : `${alerts.length} saved ${alerts.length === 1 ? 'alert' : 'alerts'} for this API key.`;
    }

    if (alerts.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.textContent = 'No email alerts saved yet.';
        alertsList.append(emptyState);
        return;
    }

    for (const alert of alerts) {
        const card = document.createElement('article');
        card.className = 'alert-card';

        const kicker = document.createElement('div');
        kicker.className = 'alert-card__kicker';
        kicker.textContent = alert.alertName || 'Recurring alert';

        const title = document.createElement('h3');
        title.textContent = summarizeAlertTarget(alert.searchMetadata);

        const meta = document.createElement('p');
        meta.className = 'alert-card__meta';
        meta.textContent = [
            alert.recipientEmail,
            alert.cronExpression,
            `next ${formatDateTime(alert.nextRunAt)}`,
        ].filter(Boolean).join(' · ');

        const stats = document.createElement('p');
        stats.className = 'alert-card__stats';
        stats.textContent = [
            `emails ${alert.totalEmailsSent ?? 0}`,
            `jobs ${alert.totalJobsSent ?? 0}`,
            `last result ${alert.lastResultCount ?? 0}`,
            alert.lastSentAt ? `last sent ${formatDateTime(alert.lastSentAt)}` : null,
            alert.lastError ? `last error ${alert.lastError}` : null,
        ].filter(Boolean).join(' · ');

        const config = document.createElement('div');
        config.className = 'alert-card__config';
        [
            alert.searchInputSummary?.resumeUrl ? 'Resume URL' : null,
            alert.searchInputSummary?.hasResumeFile ? 'Resume file stored' : null,
            alert.searchInputSummary?.publishedAt ? `Posted ${alert.searchInputSummary.publishedAt}` : null,
            alert.searchInputSummary?.resumeMatchMinScore != null || alert.searchInputSummary?.resumeMatchMaxScore != null
                ? `Score ${alert.searchInputSummary.resumeMatchMinScore ?? 1}-${alert.searchInputSummary.resumeMatchMaxScore ?? 10}`
                : null,
        ].filter(Boolean).forEach((value) => {
            config.append(createChip(value, 'default'));
        });

        const actions = document.createElement('div');
        actions.className = 'alert-card__actions';

        const loadButton = document.createElement('button');
        loadButton.type = 'button';
        loadButton.className = 'button button--ghost';
        loadButton.textContent = 'Load into form';
        loadButton.addEventListener('click', () => {
            loadAlertIntoForm(alert);
            showStatus(
                `Loaded "${alert.alertName || summarizeAlertTarget(alert.searchMetadata)}" into the form.${alert.searchInputSummary?.hasResumeFile ? ' Reattach the resume file before saving if you need the file-based match again.' : ''}`,
                'success',
            );
        });

        const deleteButton = document.createElement('button');
        deleteButton.type = 'button';
        deleteButton.className = 'button button--ghost';
        deleteButton.textContent = 'Delete alert';
        deleteButton.addEventListener('click', async () => {
            try {
                await deleteAlert(alert.id);
                await loadAlerts();
                showStatus('Email alert deleted.', 'success');
            } catch (error) {
                showStatus(error.message, 'error');
            }
        });

        actions.append(loadButton, deleteButton);
        card.append(kicker, title, meta, stats);
        if (config.childElementCount > 0) {
            card.append(config);
        }
        card.append(actions);
        alertsList.append(card);
    }
}

async function deleteAlert(alertId) {
    const apiKey = getActiveApiKey();
    if (!apiKey) {
        throw new Error('Log in to continue.');
    }

    await request(`/v1/jobs/alerts/${alertId}`, {
        method: 'DELETE',
        headers: {
            'x-api-key': apiKey,
        },
    });
}

function summarizeAlertTarget(searchMetadata = {}) {
    const primary = [searchMetadata.title, searchMetadata.location].filter(Boolean).join(' · ');
    const companies = Array.isArray(searchMetadata.companyName) && searchMetadata.companyName.length > 0
        ? searchMetadata.companyName.join(', ')
        : null;

    return primary || companies || 'Saved jobs alert';
}

function applyMultiSelectValues(fieldName, values = []) {
    const field = getField(fieldName);
    if (!field?.options) {
        return;
    }

    for (const option of field.options) {
        option.selected = values.includes(option.value);
    }
}

function loadAlertIntoForm(alert) {
    if (!searchForm) {
        return;
    }

    const summary = alert.searchInputSummary ?? {};
    const setValue = (fieldName, value) => {
        const field = getField(fieldName);
        if (field) {
            field.value = value ?? '';
        }
    };

    setValue('alertName', alert.alertName ?? '');
    setValue('deliveryEmail', alert.recipientEmail ?? '');
    setValue('cronExpression', alert.cronExpression ?? '');
    setValue('title', summary.title ?? '');
    setValue('location', summary.location ?? '');
    setValue('rows', summary.rows ?? 10);
    setValue('pageNumber', summary.pageNumber ?? 1);
    setValue('publishedAt', summary.publishedAt ?? '');
    setValue('companyName', Array.isArray(summary.companyName) ? summary.companyName.join(', ') : '');
    setValue('companyId', Array.isArray(summary.companyId) ? summary.companyId.join(', ') : '');
    setValue('resumeUrl', summary.resumeUrl ?? '');
    setValue('resumeMatchMinScore', summary.resumeMatchMinScore ?? '');
    setValue('resumeMatchMaxScore', summary.resumeMatchMaxScore ?? '');
    setValue('requestDelayMs', summary.requestDelayMs ?? 600);
    setValue('detailConcurrency', summary.detailConcurrency ?? 3);
    if (getField('resumeFile')) {
        getField('resumeFile').value = '';
    }
    applyMultiSelectValues('workType', summary.workType ?? []);
    applyMultiSelectValues('contractType', summary.contractType ?? []);
    applyMultiSelectValues('experienceLevel', summary.experienceLevel ?? []);
    updateResumeFileState();
    persistPreferences();
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function formatDateTime(value) {
    if (!value) {
        return 'n/a';
    }

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value;
    }

    return date.toLocaleString();
}

function persistPreferences() {
    const existing = readStoredPreferences();
    const readValue = (fieldName, fallback = '') => getField(fieldName)
        ? readFieldValue(fieldName, fallback)
        : (existing[fieldName] ?? fallback);
    const readSelected = (fieldName) => getField(fieldName)
        ? readSelectedValues(fieldName)
        : (Array.isArray(existing[fieldName]) ? existing[fieldName] : []);

    const preferences = {
        ...existing,
        apiKey: apiKeyInput?.value ?? existing.apiKey ?? '',
        hideApplied: hideAppliedInput?.checked ?? true,
        signupName: readValue('signupName'),
        signupEmail: readValue('signupEmail'),
        alertName: readValue('alertName'),
        title: readValue('title'),
        location: readValue('location'),
        rows: readValue('rows'),
        pageNumber: readValue('pageNumber'),
        publishedAt: readValue('publishedAt'),
        companyName: readValue('companyName'),
        companyId: readValue('companyId'),
        resumeUrl: readValue('resumeUrl'),
        resumeMatchMinScore: readValue('resumeMatchMinScore'),
        resumeMatchMaxScore: readValue('resumeMatchMaxScore'),
        requestDelayMs: readValue('requestDelayMs'),
        detailConcurrency: readValue('detailConcurrency'),
        deliveryEmail: readValue('deliveryEmail'),
        cronExpression: readValue('cronExpression'),
        workType: readSelected('workType'),
        contractType: readSelected('contractType'),
        experienceLevel: readSelected('experienceLevel'),
    };

    writeStoredPreferences(preferences);
}

function hydratePreferences() {
    if (apiKeyInput) {
        apiKeyInput.value = defaultApiKeyValue();
    }

    try {
        const preferences = readStoredPreferences();
        if (!preferences || typeof preferences !== 'object') {
            return;
        }

        if (apiKeyInput) {
            apiKeyInput.value = preferences.apiKey || apiKeyInput.value;
        }
        if (hideAppliedInput) {
            hideAppliedInput.checked = preferences.hideApplied ?? true;
        }

        for (const fieldName of [
            'alertName',
            'title',
            'signupName',
            'signupEmail',
            'location',
            'rows',
            'pageNumber',
            'publishedAt',
            'companyName',
            'companyId',
            'resumeUrl',
            'resumeMatchMinScore',
            'resumeMatchMaxScore',
            'requestDelayMs',
            'detailConcurrency',
            'deliveryEmail',
            'cronExpression',
        ]) {
            const field = getField(fieldName);
            if (preferences[fieldName] != null && field) {
                field.value = preferences[fieldName];
            }
        }

        for (const [fieldName, values] of Object.entries({
            workType: preferences.workType,
            contractType: preferences.contractType,
            experienceLevel: preferences.experienceLevel,
        })) {
            const field = getField(fieldName);
            if (!Array.isArray(values) || !field) {
                continue;
            }

            for (const option of field.options) {
                option.selected = values.includes(option.value);
            }
        }
    } catch {
        if (apiKeyInput) {
            apiKeyInput.value = defaultApiKeyValue();
        }
    }
}
