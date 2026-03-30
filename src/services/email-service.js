import nodemailer from 'nodemailer';

import { createNoopLogger } from '../scraper/utils.js';

function httpError(statusCode, message, code = 'bad_request') {
    const error = new Error(message);
    error.statusCode = statusCode;
    error.code = code;
    return error;
}

function escapeHtml(value) {
    return `${value ?? ''}`
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;');
}

function formatList(values) {
    return Array.isArray(values) && values.length > 0 ? values.join(', ') : 'Any';
}

function humanizePublishedAt(value) {
    const labels = {
        r86400: 'Past 24 hours',
        r604800: 'Past week',
        r2592000: 'Past month',
    };

    return labels[value] ?? (value || 'Any time');
}

function describeResumeSource(input) {
    if (input.resumeFile?.fileName) {
        return `Uploaded file: ${input.resumeFile.fileName}`;
    }

    if (input.resumeUrl) {
        return `Resume URL: ${input.resumeUrl}`;
    }

    return 'Not provided';
}

function buildCriteriaRows(input = {}, result = {}) {
    const scoreRange = [
        input.resumeMatchMinScore ?? result.resumeMatchScoreRangeApplied?.min ?? null,
        input.resumeMatchMaxScore ?? result.resumeMatchScoreRangeApplied?.max ?? null,
    ].every((value) => value == null)
        ? 'Any'
        : `${input.resumeMatchMinScore ?? result.resumeMatchScoreRangeApplied?.min ?? 1} - ${input.resumeMatchMaxScore ?? result.resumeMatchScoreRangeApplied?.max ?? 10}`;

    return [
        ['Title', input.title || 'Any'],
        ['Location', input.location || 'Any'],
        ['Company names', formatList(input.companyName)],
        ['Company IDs', formatList(input.companyId)],
        ['Published at', humanizePublishedAt(input.publishedAt)],
        ['Work type', formatList(input.workType)],
        ['Contract type', formatList(input.contractType)],
        ['Experience level', formatList(input.experienceLevel)],
        ['Rows / page', input.rows ?? 'Default'],
        ['Page number', input.pageNumber ?? 1],
        ['Resume', describeResumeSource(input)],
        ['Resume score range', scoreRange],
    ];
}

function buildJobsHtml(items) {
    if (items.length === 0) {
        return '<p style="margin:0;color:#6b6159;">No jobs matched this run.</p>';
    }

    return items.map((item) => {
        const score = item.resumeMatch?.score != null ? `${item.resumeMatch.score}/10` : 'No resume score';
        const summary = item.resumeMatch?.summary ?? item.descriptionText?.slice(0, 260) ?? 'No summary available.';
        const meta = [
            item.companyName,
            item.location,
            item.postedTimeAgo || item.listedAtText,
        ].filter(Boolean).join(' · ');

        return `
            <article style="padding:18px 0;border-top:1px solid #eadfcd;">
                <div style="display:flex;justify-content:space-between;gap:16px;align-items:flex-start;">
                    <div>
                        <h3 style="margin:0 0 6px;font-size:18px;line-height:1.2;">${escapeHtml(item.title ?? 'Untitled role')}</h3>
                        <div style="color:#6b6159;font-size:14px;">${escapeHtml(meta)}</div>
                    </div>
                    <div style="padding:8px 12px;border-radius:999px;background:#f1e6d6;font-weight:700;color:#7b3b18;white-space:nowrap;">${escapeHtml(score)}</div>
                </div>
                <p style="margin:12px 0 14px;color:#2a221d;line-height:1.5;">${escapeHtml(summary)}</p>
                ${item.url ? `<a href="${escapeHtml(item.url)}" style="display:inline-block;padding:10px 16px;border-radius:999px;background:#bf5a2a;color:#fff8f2;text-decoration:none;font-weight:700;">Open job</a>` : ''}
            </article>
        `;
    }).join('');
}

function buildJobsText(items) {
    if (items.length === 0) {
        return 'No jobs matched this run.';
    }

    return items.map((item, index) => [
        `${index + 1}. ${item.title ?? 'Untitled role'}`,
        `   Company: ${item.companyName ?? 'Unknown company'}`,
        `   Location: ${item.location ?? 'Unknown location'}`,
        `   Score: ${item.resumeMatch?.score != null ? `${item.resumeMatch.score}/10` : 'No resume score'}`,
        `   Summary: ${item.resumeMatch?.summary ?? item.descriptionText?.slice(0, 240) ?? 'No summary available.'}`,
        item.url ? `   URL: ${item.url}` : null,
    ].filter(Boolean).join('\n')).join('\n\n');
}

function buildDigestSubject({ deliveryMode, searchInput, items }) {
    const prefix = deliveryMode === 'alert' ? 'Alert delivery' : 'Instant delivery';
    const target = [searchInput.title, searchInput.location].filter(Boolean).join(' · ') || 'LinkedIn jobs';
    return `[LinkedIn Jobs] ${prefix} · ${target} · ${items.length} job${items.length === 1 ? '' : 's'}`;
}

export function createEmailService(emailConfig, { logger = createNoopLogger() } = {}) {
    const isConfigured = Boolean(emailConfig?.smtpUser && emailConfig?.smtpPassword && emailConfig?.from);
    let transport = null;

    function ensureConfigured() {
        if (!isConfigured) {
            throw httpError(500, 'Email delivery is not configured. Set SMTP_EMAIL and SMTP_PASSWORD in .env.', 'email_not_configured');
        }
    }

    function getTransport() {
        ensureConfigured();

        if (!transport) {
            transport = nodemailer.createTransport({
                host: emailConfig.smtpHost,
                port: emailConfig.smtpPort,
                secure: emailConfig.secure,
                auth: {
                    user: emailConfig.smtpUser,
                    pass: emailConfig.smtpPassword,
                },
            });
        }

        return transport;
    }

    return {
        isConfigured,

        async sendJobsDigest({ recipientEmail, deliveryMode, searchInput, result, alert = null }) {
            ensureConfigured();

            const items = result.items ?? [];
            const criteriaRows = buildCriteriaRows(searchInput, result)
                .map(([label, value]) => `
                    <tr>
                        <td style="padding:8px 12px;border-top:1px solid #eadfcd;color:#6b6159;font-weight:700;width:180px;">${escapeHtml(label)}</td>
                        <td style="padding:8px 12px;border-top:1px solid #eadfcd;">${escapeHtml(value)}</td>
                    </tr>
                `)
                .join('');
            const subject = buildDigestSubject({ deliveryMode, searchInput, items });
            const sentAt = new Date().toISOString();

            const html = `
                <div style="margin:0;padding:24px;background:#f5eee3;color:#1f1b18;font-family:Arial,sans-serif;">
                    <div style="max-width:880px;margin:0 auto;padding:28px;border-radius:24px;background:#fffaf2;border:1px solid #eadfcd;">
                        <p style="margin:0 0 12px;color:#7b3b18;font-size:12px;font-weight:700;letter-spacing:0.12em;text-transform:uppercase;">${escapeHtml(deliveryMode === 'alert' ? 'Scheduled alert' : 'Instant delivery')}</p>
                        <h1 style="margin:0 0 10px;font-size:30px;line-height:1.05;">${escapeHtml(searchInput.title || 'LinkedIn jobs digest')}</h1>
                        <p style="margin:0 0 18px;color:#6b6159;line-height:1.6;">Sent to ${escapeHtml(recipientEmail)} on ${escapeHtml(sentAt)}${alert?.cronExpression ? ` · cron ${escapeHtml(alert.cronExpression)}` : ''}.</p>

                        <section style="margin:0 0 24px;">
                            <h2 style="margin:0 0 12px;font-size:18px;">Selected options</h2>
                            <table style="width:100%;border-collapse:collapse;background:#fffdf8;border:1px solid #eadfcd;border-radius:18px;overflow:hidden;">
                                <tbody>${criteriaRows}</tbody>
                            </table>
                        </section>

                        <section>
                            <h2 style="margin:0 0 12px;font-size:18px;">Jobs (${items.length})</h2>
                            ${buildJobsHtml(items)}
                        </section>
                    </div>
                </div>
            `;

            const text = [
                deliveryMode === 'alert' ? 'Scheduled alert' : 'Instant delivery',
                `Recipient: ${recipientEmail}`,
                `Sent at: ${sentAt}`,
                alert?.cronExpression ? `Cron: ${alert.cronExpression}` : null,
                '',
                'Selected options:',
                ...buildCriteriaRows(searchInput, result).map(([label, value]) => `- ${label}: ${value}`),
                '',
                `Jobs (${items.length}):`,
                buildJobsText(items),
            ].filter(Boolean).join('\n');

            const info = await getTransport().sendMail({
                from: emailConfig.from,
                to: recipientEmail,
                subject,
                text,
                html,
            });

            logger.info?.('Sent jobs digest email.', {
                recipientEmail,
                deliveryMode,
                itemCount: items.length,
                messageId: info.messageId,
            });

            return {
                messageId: info.messageId,
                subject,
                recipientEmail,
                itemCount: items.length,
                sentAt,
            };
        },
    };
}
