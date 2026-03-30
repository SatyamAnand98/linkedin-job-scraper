# LinkedIn Jobs Platform

This repo now has three product surfaces built on the same scraper core:

- An Apify Actor you can publish and call with `ApifyClient`
- An authenticated HTTP API for internal or partner services
- An installable JavaScript package that exports the scraper, API server, and API client

## What Changed

The original single-file actor was refactored into a more company-ready layout:

- `src/scraper/*`: reusable LinkedIn guest search and detail scraping engine
- `src/api/*`: Fastify API server and startup entrypoint
- `src/auth/*`: authentication and authorization
- `src/services/*`: orchestration layer
- `src/storage/*`: persisted API run records
- `src/client/*`: package client for your own HTTP API
- `src/run-actor.js`: Apify actor wrapper around the shared scraper core

## Authentication And Authorization

The HTTP API supports:

- API key authentication with the `x-api-key` header
- Client credentials exchange through `POST /v1/auth/tokens`
- Bearer JWTs for service-to-service access
- Email OTP signup through `POST /v1/auth/email/request-otp` and `POST /v1/auth/email/verify-otp`
- Role-based authorization with `admin`, `service`, `user`, and `reader` roles

Default local development credentials are only for local use:

- `clientId`: `local-dev-admin`
- `clientSecret`: `change-me-local-dev-secret`
- `apiKey`: `change-me-local-dev-api-key`

Use [.env.example](/Users/apple/Downloads/temp-test/apify/.env.example) to define production credentials through `LINKEDIN_JOBS_AUTH_IDENTITIES_JSON` and `LINKEDIN_JOBS_JWT_SECRET`.

For end users, the intended flow is:

1. call `POST /v1/auth/email/request-otp` with an email address
2. receive the OTP over SMTP email
3. call `POST /v1/auth/email/verify-otp` with the email and OTP
4. store the returned API key and use it in `x-api-key` for job APIs

## HTTP API

Start the API:

```bash
npm install
npm run start:api
```

`npm run start:api` now runs the API in watch mode and restarts it when source files change. Use `npm run start:api:once` if you want a single non-watching process.

Open `http://127.0.0.1:3000/` or your configured `PORT` to use the built-in frontend. It gives you a form for search filters, page-based navigation, resume scoring, direct apply links, local applied-job tracking, and email delivery controls for instant sends or cron-based alerts.

Email delivery uses SMTP from `.env`:

- `SMTP_EMAIL`
- `SMTP_PASSWORD`
- optional: `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_FROM`

MongoDB-backed storage is now the primary persistence path for runs, alerts, users, and OTP challenges:

- `MONGO_URI`
- optional: `LINKEDIN_JOBS_STORAGE_PROVIDER=mongo`
- optional: `LINKEDIN_JOBS_MONGO_DATABASE_NAME` default `linkedInJobs`
- optional: `LINKEDIN_JOBS_MONGO_COLLECTION_NAME` default `linkedInJobs`
- optional for file fallback only: `LINKEDIN_JOBS_RUNS_DIR` and `LINKEDIN_JOBS_ALERTS_DIR`
- optional for Vercel Blob fallback only: `BLOB_READ_WRITE_TOKEN`, `LINKEDIN_JOBS_STORAGE_PROVIDER=vercel-blob`, and `LINKEDIN_JOBS_BLOB_PREFIX`
- optional for scheduled alert processing: `EMAIL_ALERT_POLL_INTERVAL_MS` and `CRON_SECRET`

Endpoints:

- `GET /health`
- `POST /v1/auth/tokens`
- `POST /v1/auth/email/request-otp`
- `POST /v1/auth/email/verify-otp`
- `GET /v1/auth/me`
- `POST /v1/jobs/search`
- `POST /v1/jobs/deliveries/send`
- `GET /v1/jobs/alerts`
- `POST /v1/jobs/alerts`
- `GET /v1/jobs/alerts/process`
- `DELETE /v1/jobs/alerts/:alertId`
- `POST /v1/jobs/runs`
- `GET /v1/jobs/runs/:runId`
- `GET /v1/jobs/runs/:runId/items`

Synchronous search example:

```bash
curl -X POST http://127.0.0.1:3000/v1/jobs/search \
  -H 'content-type: application/json' \
  -H 'x-api-key: change-me-local-dev-api-key' \
  -d '{
    "companyName": ["Google", "Microsoft"],
    "companyId": ["76987811", "1815218"],
    "rows": 10,
    "pageNumber": 1
  }'
```

Email OTP signup example:

```bash
curl -X POST http://127.0.0.1:3000/v1/auth/email/request-otp \
  -H 'content-type: application/json' \
  -d '{
    "name": "Jane Candidate",
    "email": "jane@example.com"
  }'
```

OTP verification example:

```bash
curl -X POST http://127.0.0.1:3000/v1/auth/email/verify-otp \
  -H 'content-type: application/json' \
  -d '{
    "name": "Jane Candidate",
    "email": "jane@example.com",
    "otp": "123456"
  }'
```

The verification response returns a distinct API key for that email user. Use that key for `POST /v1/jobs/search`, runs, and alerts.

Pagination:

- `rows` is the page size.
- `pageNumber` is 1-based.
- Example: `rows=10` and `pageNumber=2` skips the first 10 matching jobs and returns the next 10.

Optional resume matching for `/v1/jobs/search`:

- Send `resumeUrl` in JSON, or upload `resumeFile` with `multipart/form-data`.
- Each returned job includes `resumeMatch` with a `score` from `1` to `10`, matched and missing keywords, matched phrases, and a scoring breakdown.
- To filter the response by score, send `resumeMatchScoreRange` in JSON or `resumeMatchMinScore` and `resumeMatchMaxScore` in multipart form-data.

Resume URL example:

```bash
curl -X POST http://127.0.0.1:3000/v1/jobs/search \
  -H 'content-type: application/json' \
  -H 'x-api-key: change-me-local-dev-api-key' \
  -d '{
    "title": "Product Manager",
    "location": "Bengaluru",
    "rows": 10,
    "pageNumber": 2,
    "resumeUrl": "https://example.com/resume.pdf",
    "resumeMatchScoreRange": {
      "min": 7,
      "max": 10
    }
  }'
```

Resume file upload example:

```bash
curl -X POST http://127.0.0.1:3000/v1/jobs/search \
  -H 'x-api-key: change-me-local-dev-api-key' \
  -F 'title=Product Manager' \
  -F 'location=Bengaluru' \
  -F 'rows=10' \
  -F 'pageNumber=2' \
  -F 'resumeMatchMinScore=7' \
  -F 'resumeMatchMaxScore=10' \
  -F 'resumeFile=@./resume.pdf'
```

Instant email delivery example:

```bash
curl -X POST http://127.0.0.1:3000/v1/jobs/deliveries/send \
  -H 'content-type: application/json' \
  -H 'x-api-key: change-me-local-dev-api-key' \
  -d '{
    "title": "Product Manager",
    "location": "Bengaluru",
    "rows": 10,
    "pageNumber": 1,
    "resumeUrl": "https://example.com/resume.pdf",
    "resumeMatchScoreRange": {
      "min": 7,
      "max": 10
    },
    "deliveryEmail": "you@example.com"
  }'
```

Recurring email alert example:

```bash
curl -X POST http://127.0.0.1:3000/v1/jobs/alerts \
  -H 'content-type: application/json' \
  -H 'x-api-key: change-me-local-dev-api-key' \
  -d '{
    "title": "Product Manager",
    "location": "Bengaluru",
    "rows": 10,
    "pageNumber": 1,
    "deliveryEmail": "you@example.com",
    "cronExpression": "0 * * * *"
  }'
```

Alert behavior:

- Saved alerts re-run the same selected filters and resume input on the cron you provide.
- Alert emails only include jobs that have not already been emailed for that alert.
- The email contains a `Selected options` section summarizing the filters, resume source, and score range used for that run.

## Vercel Deployment

This repo now includes a Vercel Fastify entrypoint at [src/index.js](/Users/apple/Downloads/temp-test/apify/src/index.js). Vercel will deploy the app as a single Fastify function.

Do not add a `functions` mapping for `src/index.js` in `vercel.json`. Vercel's Fastify deployment detects the entrypoint automatically, while `functions` matching is intended for Vercel Functions in the `api/` directory.

For a durable backend on Vercel with MongoDB:

- set `MONGO_URI`
- set `LINKEDIN_JOBS_STORAGE_PROVIDER=mongo`
- optional: set `LINKEDIN_JOBS_MONGO_DATABASE_NAME=linkedInJobs`
- optional: set `LINKEDIN_JOBS_MONGO_COLLECTION_NAME=linkedInJobs`
- set `SMTP_EMAIL` and `SMTP_PASSWORD`
- optional: set `LINKEDIN_JOBS_OTP_SECRET`
- set `CRON_SECRET` if you want Vercel Cron to trigger alert processing securely

State on Vercel:

- When `MONGO_URI` is present, the app defaults to Mongo storage and keeps runs, alerts, users, and OTP challenges in one collection.
- The default collection name is `linkedInJobs`.
- If you override storage back to file on Vercel, persistence is ephemeral.

Alert scheduling on Vercel:

- The in-process scheduler is disabled on Vercel by default.
- Trigger [GET /v1/jobs/alerts/process](/Users/apple/Downloads/temp-test/apify/README.md#L64) from Vercel Cron or another scheduler.
- If `CRON_SECRET` is set, call that endpoint with `Authorization: Bearer <CRON_SECRET>`.
- For sub-daily alert schedules, use a plan that supports the cron frequency you need and run the processor often enough, typically every minute.

Example `vercel.json` cron entry:

```json
{
  "crons": [
    {
      "path": "/v1/jobs/alerts/process",
      "schedule": "* * * * *"
    }
  ]
}
```

That example is suitable for plans that support minute-level Vercel Cron. If your plan only supports less frequent cron jobs, use the highest frequency available.

## Package Usage

The package exports:

- `scrapeLinkedInJobs`
- `normalizeScrapeInput`
- `createApiServer`
- `startApiServer`
- `LinkedInJobsApiClient`
- `runActor`

HTTP client example:

```javascript
import { LinkedInJobsApiClient } from 'linkedin-jobs-scraper';

const client = new LinkedInJobsApiClient({
    baseUrl: 'http://127.0.0.1:3000',
    apiKey: 'change-me-local-dev-api-key',
});

const result = await client.searchJobs({
    companyName: ['Google', 'Microsoft'],
    companyId: ['76987811', '1815218'],
    rows: 10,
});

console.log(result.count);
```

See [examples/http-client.js](/Users/apple/Downloads/temp-test/apify/examples/http-client.js).

## Apify Actor Usage

The actor entrypoint is still the main package start command:

```bash
npm start
```

It reads from Apify input storage or falls back to [INPUT.json](/Users/apple/Downloads/temp-test/apify/INPUT.json) for local runs.

After you publish the actor under your own Apify account, other services can call it with `ApifyClient` like this:

```javascript
import { ApifyClient } from 'apify-client';

const client = new ApifyClient({
    token: '<YOUR_API_TOKEN>',
});

const input = {
    companyName: ['Google', 'Microsoft'],
    companyId: ['76987811', '1815218'],
    proxy: {
        useApifyProxy: true,
        apifyProxyGroups: ['RESIDENTIAL'],
    },
};

const run = await client.actor('<your-username>/linkedin-jobs-scraper').call(input);

console.log(`https://console.apify.com/storage/datasets/${run.defaultDatasetId}`);
const { items } = await client.dataset(run.defaultDatasetId).listItems();
console.dir(items, { depth: null });
```

See [examples/apify-client.js](/Users/apple/Downloads/temp-test/apify/examples/apify-client.js).

## Current Project Files

Core package and product surfaces:

- [src/package.js](/Users/apple/Downloads/temp-test/apify/src/package.js)
- [src/index.js](/Users/apple/Downloads/temp-test/apify/src/index.js)
- [src/run-actor.js](/Users/apple/Downloads/temp-test/apify/src/run-actor.js)
- [src/api/server.js](/Users/apple/Downloads/temp-test/apify/src/api/server.js)
- [src/client/api-client.js](/Users/apple/Downloads/temp-test/apify/src/client/api-client.js)
- [.actor/input_schema.json](/Users/apple/Downloads/temp-test/apify/.actor/input_schema.json)
- [.actor/actor.json](/Users/apple/Downloads/temp-test/apify/.actor/actor.json)

## Notes

- The scraper still uses LinkedIn public guest job search and guest job-posting pages.
- LinkedIn can change markup or rate-limit traffic; Apify proxy support remains available through actor input.
- API run records are stored under `storage/api-runs` by default.
