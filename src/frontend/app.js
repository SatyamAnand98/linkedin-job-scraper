const APPLIED_JOBS_STORAGE_KEY = 'linkedin-jobs-applied-job-ids';
const PREFERENCES_STORAGE_KEY = 'linkedin-jobs-frontend-preferences';

const isBrowser = typeof document !== 'undefined';
const form = isBrowser ? document.querySelector('#search-form') : null;
const apiKeyInput = isBrowser ? document.querySelector('#api-key') : null;
const hideAppliedInput = isBrowser ? document.querySelector('#hide-applied') : null;
const resultsSummary = isBrowser ? document.querySelector('#results-summary') : null;
const resultsList = isBrowser ? document.querySelector('#results-list') : null;
const statusBanner = isBrowser ? document.querySelector('#status-banner') : null;
const searchButton = isBrowser ? document.querySelector('#search-button') : null;
const nextPageButton = isBrowser ? document.querySelector('#next-page') : null;
const previousPageButton = isBrowser ? document.querySelector('#previous-page') : null;
const resetFiltersButton = isBrowser ? document.querySelector('#reset-filters') : null;
const openVisibleButton = isBrowser ? document.querySelector('#open-visible') : null;
const clearAppliedButton = isBrowser ? document.querySelector('#clear-applied') : null;
const sendEmailButton = isBrowser ? document.querySelector('#send-email-now') : null;
const saveAlertButton = isBrowser ? document.querySelector('#save-email-alert') : null;
const refreshAlertsButton = isBrowser ? document.querySelector('#refresh-alerts') : null;
const jobCardTemplate = isBrowser ? document.querySelector('#job-card-template') : null;
const selectiveResetButtons = isBrowser ? [...document.querySelectorAll('[data-reset-target]')] : [];
const resumeFileState = isBrowser ? document.querySelector('#resume-file-state') : null;
const alertsList = isBrowser ? document.querySelector('#alerts-list') : null;

const CRON_PRESET_VALUES = [
    '0 * * * *',
    '*/15 * * * *',
    '0 */6 * * *',
    '0 9 * * *',
];

let lastResponse = null;
let lastVisibleItems = [];

if (isBrowser) {
    bootstrap();
}

function bootstrap() {
    hydratePreferences();
    renderResults([]);
    updateSummary();

    form.addEventListener('submit', handleSearchSubmit);
    nextPageButton.addEventListener('click', () => changePageNumber(1));
    previousPageButton.addEventListener('click', () => changePageNumber(-1));
    resetFiltersButton.addEventListener('click', handleReset);
    openVisibleButton.addEventListener('click', openVisibleJobs);
    clearAppliedButton.addEventListener('click', clearAppliedJobs);
    sendEmailButton.addEventListener('click', handleSendEmail);
    saveAlertButton.addEventListener('click', handleSaveAlert);
    refreshAlertsButton.addEventListener('click', loadAlerts);
    selectiveResetButtons.forEach((button) => {
        button.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            resetField(button.dataset.resetTarget);
        });
    });
    hideAppliedInput.addEventListener('change', () => {
        persistPreferences();
        rerenderFromLastResponse();
    });
    apiKeyInput.addEventListener('change', persistPreferences);
    apiKeyInput.addEventListener('blur', persistPreferences);
    form.elements.resumeFile.addEventListener('change', updateResumeFileState);
    form.elements.cronPreset.addEventListener('change', syncCronPresetSelection);
    form.elements.cronExpression.addEventListener('input', syncCronPresetFromExpression);
    updateResumeFileState();
    syncCronPresetSelection();
    loadAlerts().catch(() => {
        renderAlerts([]);
    });
}

async function handleSearchSubmit(event) {
    event.preventDefault();

    const payload = buildPayload(form);
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
    const payload = buildPayload(form);
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

async function handleSaveAlert() {
    const payload = buildPayload(form);
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
        showStatus(`Saved alert for ${response.alert.recipientEmail}. Next run: ${formatDateTime(response.alert.nextRunAt)}.`, 'success');
    } catch (error) {
        showStatus(error.message, 'error');
    } finally {
        setLoadingState(false);
    }
}

function handleReset() {
    form.reset();
    apiKeyInput.value = apiKeyInput.value || 'change-me-local-dev-api-key';
    hideAppliedInput.checked = true;
    form.elements.rows.value = 10;
    form.elements.pageNumber.value = 1;
    form.elements.requestDelayMs.value = 600;
    form.elements.detailConcurrency.value = 3;
    form.elements.cronPreset.value = '0 * * * *';
    form.elements.cronExpression.value = '0 * * * *';
    lastResponse = null;
    lastVisibleItems = [];
    renderResults([]);
    updateSummary();
    updateResumeFileState();
    persistPreferences();
    hideStatus();
}

function resetField(fieldName) {
    const field = form.elements[fieldName];
    if (!field) {
        return;
    }

    if (field instanceof HTMLSelectElement) {
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
    const currentValue = Number.parseInt(form.elements.pageNumber.value || '1', 10);
    const nextValue = Math.max(1, currentValue + delta);
    form.elements.pageNumber.value = nextValue;
    form.requestSubmit();
}

function buildPayload(currentForm) {
    const selectedValues = (fieldName) => [...currentForm.elements[fieldName].selectedOptions].map((option) => option.value);
    const parseList = (value) => value.split(',').map((item) => item.trim()).filter(Boolean);
    const parseOptionalNumber = (value) => {
        if (!value) {
            return null;
        }

        const parsed = Number.parseFloat(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    return {
        title: currentForm.elements.title.value.trim(),
        location: currentForm.elements.location.value.trim(),
        rows: Number.parseInt(currentForm.elements.rows.value || '10', 10),
        pageNumber: Number.parseInt(currentForm.elements.pageNumber.value || '1', 10),
        publishedAt: currentForm.elements.publishedAt.value,
        companyName: parseList(currentForm.elements.companyName.value),
        companyId: parseList(currentForm.elements.companyId.value),
        workType: selectedValues('workType'),
        contractType: selectedValues('contractType'),
        experienceLevel: selectedValues('experienceLevel'),
        resumeUrl: currentForm.elements.resumeUrl.value.trim(),
        resumeFile: currentForm.elements.resumeFile.files[0] ?? null,
        resumeMatchMinScore: parseOptionalNumber(currentForm.elements.resumeMatchMinScore.value),
        resumeMatchMaxScore: parseOptionalNumber(currentForm.elements.resumeMatchMaxScore.value),
        requestDelayMs: Number.parseInt(currentForm.elements.requestDelayMs.value || '600', 10),
        detailConcurrency: Number.parseInt(currentForm.elements.detailConcurrency.value || '3', 10),
        deliveryEmail: currentForm.elements.deliveryEmail.value.trim(),
        cronExpression: currentForm.elements.cronExpression.value.trim(),
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
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        throw new Error('API key is required.');
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

    return null;
}

function syncCronPresetSelection() {
    const presetValue = form.elements.cronPreset.value;
    if (presetValue !== 'custom') {
        form.elements.cronExpression.value = presetValue;
    } else if (CRON_PRESET_VALUES.includes(form.elements.cronExpression.value)) {
        form.elements.cronExpression.value = '';
    }

    persistPreferences();
}

function syncCronPresetFromExpression() {
    const cronExpression = form.elements.cronExpression.value.trim();
    form.elements.cronPreset.value = CRON_PRESET_VALUES.includes(cronExpression) ? cronExpression : 'custom';
    persistPreferences();
}

function updateResumeFileState() {
    if (!resumeFileState) {
        return;
    }

    const file = form.elements.resumeFile.files[0];
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
    searchButton.disabled = isLoading;
    nextPageButton.disabled = isLoading;
    previousPageButton.disabled = isLoading;
    sendEmailButton.disabled = isLoading;
    saveAlertButton.disabled = isLoading;
    refreshAlertsButton.disabled = isLoading;
    searchButton.textContent = isLoading ? 'Working…' : 'Search Jobs';
    sendEmailButton.textContent = isLoading ? 'Working…' : 'Send Jobs Now';
    saveAlertButton.textContent = isLoading ? 'Working…' : 'Save Email Alert';
}

function showStatus(message, tone) {
    statusBanner.hidden = false;
    statusBanner.dataset.tone = tone ?? '';
    statusBanner.textContent = message;
}

function hideStatus() {
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
        const apiKey = apiKeyInput.value.trim();
        if (!apiKey) {
            renderAlerts([]);
            return;
        }

        refreshAlertsButton.disabled = true;
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
        refreshAlertsButton.disabled = false;
    }
}

function renderAlerts(alerts) {
    alertsList.innerHTML = '';

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

        const title = document.createElement('h3');
        title.textContent = summarizeAlertTarget(alert.searchMetadata);

        const meta = document.createElement('p');
        meta.className = 'alert-card__meta';
        meta.textContent = [
            alert.recipientEmail,
            `cron ${alert.cronExpression}`,
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

        const actions = document.createElement('div');
        actions.className = 'alert-card__actions';

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

        actions.append(deleteButton);
        card.append(title, meta, stats, actions);
        alertsList.append(card);
    }
}

async function deleteAlert(alertId) {
    const apiKey = apiKeyInput.value.trim();
    if (!apiKey) {
        throw new Error('API key is required.');
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
    const preferences = {
        apiKey: apiKeyInput.value,
        hideApplied: hideAppliedInput.checked,
        title: form.elements.title.value,
        location: form.elements.location.value,
        rows: form.elements.rows.value,
        pageNumber: form.elements.pageNumber.value,
        publishedAt: form.elements.publishedAt.value,
        companyName: form.elements.companyName.value,
        companyId: form.elements.companyId.value,
        resumeUrl: form.elements.resumeUrl.value,
        resumeMatchMinScore: form.elements.resumeMatchMinScore.value,
        resumeMatchMaxScore: form.elements.resumeMatchMaxScore.value,
        requestDelayMs: form.elements.requestDelayMs.value,
        detailConcurrency: form.elements.detailConcurrency.value,
        deliveryEmail: form.elements.deliveryEmail.value,
        cronPreset: form.elements.cronPreset.value,
        cronExpression: form.elements.cronExpression.value,
        workType: [...form.elements.workType.selectedOptions].map((option) => option.value),
        contractType: [...form.elements.contractType.selectedOptions].map((option) => option.value),
        experienceLevel: [...form.elements.experienceLevel.selectedOptions].map((option) => option.value),
    };

    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(preferences));
}

function hydratePreferences() {
    apiKeyInput.value = 'change-me-local-dev-api-key';

    try {
        const preferences = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? '{}');
        if (!preferences || typeof preferences !== 'object') {
            return;
        }

        apiKeyInput.value = preferences.apiKey || apiKeyInput.value;
        hideAppliedInput.checked = preferences.hideApplied ?? true;

        for (const fieldName of [
            'title',
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
            'cronPreset',
            'cronExpression',
        ]) {
            if (preferences[fieldName] != null && form.elements[fieldName]) {
                form.elements[fieldName].value = preferences[fieldName];
            }
        }

        for (const [fieldName, values] of Object.entries({
            workType: preferences.workType,
            contractType: preferences.contractType,
            experienceLevel: preferences.experienceLevel,
        })) {
            if (!Array.isArray(values) || !form.elements[fieldName]) {
                continue;
            }

            for (const option of form.elements[fieldName].options) {
                option.selected = values.includes(option.value);
            }
        }
    } catch {
        apiKeyInput.value = 'change-me-local-dev-api-key';
    }
}
