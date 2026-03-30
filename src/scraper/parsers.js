import * as cheerio from 'cheerio';

import { DETAIL_ENDPOINT, SEARCH_ENDPOINT } from './constants.js';
import {
    absoluteUrl,
    canonicalizeUrl,
    cleanHtml,
    cleanText,
    compactObject,
    extractJobId,
    normalizeText,
} from './utils.js';
import { toSearchMetadata } from './input.js';

export function buildSearchUrl(input, start) {
    const params = new URLSearchParams({
        start: `${start}`,
    });

    if (input.title) {
        params.set('keywords', input.title);
    }

    if (input.location) {
        params.set('location', input.location);
    }

    if (input.companyId.length > 0) {
        params.set('f_C', input.companyId.join(','));
    }

    if (input.publishedAt) {
        params.set('f_TPR', input.publishedAt);
    }

    if (input.workType.length > 0) {
        params.set('f_WT', input.workType.join(','));
    }

    if (input.contractType.length > 0) {
        params.set('f_JT', input.contractType.join(','));
    }

    if (input.experienceLevel.length > 0) {
        params.set('f_E', input.experienceLevel.join(','));
    }

    if (input.under10Applicants) {
        params.set('f_EA', 'true');
    }

    return `${SEARCH_ENDPOINT}?${params.toString()}`;
}

export function buildDetailUrl(jobId) {
    return `${DETAIL_ENDPOINT}/${jobId}`;
}

export function extractSearchCards(html) {
    const $ = cheerio.load(html);

    return $('.base-search-card')
        .toArray()
        .map((element) => {
            const card = $(element);
            const rawUrl = card.find('.base-card__full-link').attr('href');
            const url = absoluteUrl(rawUrl);

            return compactObject({
                jobId: extractJobId(card.attr('data-entity-urn')) ?? extractJobId(url),
                title: cleanText(card.find('.base-search-card__title').text()),
                companyName: cleanText(card.find('.base-search-card__subtitle').text()),
                companyUrl: absoluteUrl(card.find('.base-search-card__subtitle a').attr('href')),
                location: cleanText(card.find('.job-search-card__location').text()),
                listedAt: cleanText(card.find('.job-search-card__listdate').attr('datetime')),
                listedAtText: cleanText(card.find('.job-search-card__listdate').text()),
                url: canonicalizeUrl(url),
            });
        })
        .filter((card) => card.jobId && card.url && card.title);
}

export function matchesCompanyName(companyName, filters) {
    if (filters.length === 0) {
        return true;
    }

    const normalizedCompany = normalizeText(companyName);
    return filters.some((filter) => {
        const normalizedFilter = normalizeText(filter);
        return normalizedCompany.includes(normalizedFilter) || normalizedFilter.includes(normalizedCompany);
    });
}

function extractCriteria($) {
    const entries = $('.description__job-criteria-item')
        .toArray()
        .map((element) => {
            const item = $(element);
            const label = cleanText(item.find('.description__job-criteria-subheader').text());
            const value = cleanText(item.find('.description__job-criteria-text').text());
            return label && value ? [label, value] : null;
        })
        .filter(Boolean);

    return Object.fromEntries(entries);
}

function extractCompanyId($) {
    const candidateLinks = [
        $('.see-who-was-hired').first().attr('href'),
        $('.find-a-referral__cta').first().attr('href'),
    ].filter(Boolean);

    for (const link of candidateLinks) {
        const decoded = decodeURIComponent(link);
        const match = decoded.match(/facetCurrentCompany%3D(\d+)|facetCurrentCompany=(\d+)/);
        if (match) {
            return match[1] ?? match[2];
        }
    }

    return null;
}

export function parseJobDetail(card, detailHtml, input) {
    const $ = cheerio.load(detailHtml);
    const descriptionHtml = cleanHtml($('.show-more-less-html__markup').first().html());
    const descriptionText = descriptionHtml
        ? cheerio.load(`<div>${descriptionHtml}</div>`).text().trim()
        : null;
    const criteria = extractCriteria($);
    const salaryText = cleanText($('.compensation__salary-range, .compensation__salary').first().text());

    return compactObject({
        source: 'linkedin_public_jobs_guest',
        scrapedAt: new Date().toISOString(),
        jobId: card.jobId,
        title: cleanText($('.topcard__title').first().text()) ?? card.title,
        companyName: cleanText($('.topcard__org-name-link').first().text()) ?? card.companyName,
        companyId: extractCompanyId($),
        companyUrl: absoluteUrl($('.topcard__org-name-link').first().attr('href'))
            ?? absoluteUrl($('.sub-nav-cta__optional-url').first().attr('href'))
            ?? card.companyUrl,
        companyLogoUrl: cleanText($('.artdeco-entity-image').first().attr('data-delayed-url')),
        location: card.location ?? cleanText($('.topcard__flavor--bullet').first().text()),
        url: canonicalizeUrl(absoluteUrl($('.topcard__link').first().attr('href')) ?? card.url),
        listedAt: card.listedAt,
        listedAtText: card.listedAtText,
        postedTimeAgo: cleanText($('.posted-time-ago__text').first().text()),
        applicantsText: cleanText($('.num-applicants__caption').first().text()),
        descriptionText,
        descriptionHtml,
        employmentType: criteria['Employment type'],
        seniorityLevel: criteria['Seniority level'],
        jobFunction: criteria['Job function'],
        industries: criteria.Industries,
        criteria,
        salaryText,
        searchMetadata: toSearchMetadata(input),
    });
}
