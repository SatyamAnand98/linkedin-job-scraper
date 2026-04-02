export const BASE_URL = 'https://www.linkedin.com';
export const SEARCH_ENDPOINT = `${BASE_URL}/jobs-guest/jobs/api/seeMoreJobPostings/search`;
export const DETAIL_ENDPOINT = `${BASE_URL}/jobs-guest/jobs/api/jobPosting`;
export const SEARCH_PAGE_SIZE = 10;
export const DEFAULT_ROWS = 10;
export const DEFAULT_PAGE_NUMBER = 1;
export const DEFAULT_DELAY_MS = 600;
export const DEFAULT_DETAIL_CONCURRENCY = 3;
export const EMPTY_PAGE_LIMIT = 2;

export const DEFAULT_HEADERS = {
    'accept-language': 'en-US,en;q=0.9',
    'cache-control': 'no-cache',
    pragma: 'no-cache',
    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
};

export const DATE_POSTED_MAP = {
    r2592000: 'r2592000',
    pastmonth: 'r2592000',
    month: 'r2592000',
    r604800: 'r604800',
    pastweek: 'r604800',
    week: 'r604800',
    r86400: 'r86400',
    past24hours: 'r86400',
    day: 'r86400',
};

export const WORK_TYPE_MAP = {
    '1': '1',
    onsite: '1',
    on_site: '1',
    'on-site': '1',
    '2': '2',
    remote: '2',
    '3': '3',
    hybrid: '3',
};

export const JOB_TYPE_MAP = {
    f: 'F',
    fulltime: 'F',
    'full-time': 'F',
    p: 'P',
    parttime: 'P',
    'part-time': 'P',
    c: 'C',
    contract: 'C',
    t: 'T',
    temporary: 'T',
    v: 'V',
    volunteer: 'V',
    i: 'I',
    internship: 'I',
};

export const EXPERIENCE_LEVEL_MAP = {
    '1': '1',
    internship: '1',
    '2': '2',
    entry: '2',
    entrylevel: '2',
    'entry-level': '2',
    '3': '3',
    associate: '3',
    '4': '4',
    midsenior: '4',
    midseniorlevel: '4',
    'mid-senior': '4',
    'mid-senior-level': '4',
    '5': '5',
    director: '5',
};
