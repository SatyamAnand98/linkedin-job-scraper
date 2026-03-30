export class LinkedInJobsApiClient {
    constructor({ baseUrl, apiKey, accessToken, fetchImplementation = fetch }) {
        if (!baseUrl) {
            throw new Error('"baseUrl" is required.');
        }

        this.baseUrl = baseUrl.replace(/\/+$/, '');
        this.apiKey = apiKey ?? null;
        this.accessToken = accessToken ?? null;
        this.fetchImplementation = fetchImplementation;
    }

    setApiKey(apiKey) {
        this.apiKey = apiKey;
    }

    setAccessToken(accessToken) {
        this.accessToken = accessToken;
    }

    async createToken(credentials) {
        const response = await this.#request('/v1/auth/tokens', {
            method: 'POST',
            body: credentials,
        });

        this.accessToken = response.accessToken;
        return response;
    }

    requestEmailOtp(input) {
        return this.#request('/v1/auth/email/request-otp', {
            method: 'POST',
            body: input,
        });
    }

    async verifyEmailOtp(input) {
        const response = await this.#request('/v1/auth/email/verify-otp', {
            method: 'POST',
            body: input,
        });

        if (response.apiKey) {
            this.apiKey = response.apiKey;
            this.accessToken = null;
        }

        return response;
    }

    getCurrentIdentity() {
        return this.#request('/v1/auth/me');
    }

    searchJobs(input) {
        return this.#request('/v1/jobs/search', {
            method: 'POST',
            body: input,
        });
    }

    createRun(input) {
        return this.#request('/v1/jobs/runs', {
            method: 'POST',
            body: input,
        });
    }

    getRun(runId) {
        return this.#request(`/v1/jobs/runs/${runId}`);
    }

    getRunItems(runId) {
        return this.#request(`/v1/jobs/runs/${runId}/items`);
    }

    async #request(path, { method = 'GET', body } = {}) {
        const isFormData = typeof FormData !== 'undefined' && body instanceof FormData;
        const headers = {};

        if (!isFormData) {
            headers['content-type'] = 'application/json';
        }

        if (this.accessToken) {
            headers.authorization = `Bearer ${this.accessToken}`;
        } else if (this.apiKey) {
            headers['x-api-key'] = this.apiKey;
        }

        const response = await this.fetchImplementation(`${this.baseUrl}${path}`, {
            method,
            headers,
            body: body ? (isFormData ? body : JSON.stringify(body)) : undefined,
        });

        const payload = await response.json();
        if (!response.ok) {
            const error = new Error(payload.error ?? `Request failed with status ${response.status}`);
            error.statusCode = response.status;
            error.code = payload.code ?? 'request_failed';
            throw error;
        }

        return payload;
    }
}
