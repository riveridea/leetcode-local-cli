const DEFAULT_BASE_URL = 'https://leetcode.com';

const QUESTION_QUERY = `
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    questionId
    questionFrontendId
    title
    titleSlug
    content
    difficulty
    isPaidOnly
    sampleTestCase
    metaData
    codeSnippets {
      lang
      langSlug
      code
    }
    topicTags {
      name
      slug
    }
  }
}
`;

const TOP_KNOWLEDGE_TAGS_QUERY = `
query topKnowledgeTags {
  topKnowledgeTags {
    name
    slug
  }
}
`;

const COMPANY_TAGS_QUERY = `
query companyTags {
  companyTags {
    name
    slug
  }
}
`;

const USER_STATUS_QUERY = `
query userStatus {
  userStatus {
    isSignedIn
    username
  }
}
`;

const PROBLEMSET_QUESTION_LIST_QUERY = `
query problemsetQuestionList($limit: Int, $skip: Int, $filters: QuestionFilterInput, $sortBy: QuestionSortByInput) {
  problemsetQuestionListV2(
    categorySlug: "all-code-essentials"
    limit: $limit
    skip: $skip
    filters: $filters
    sortBy: $sortBy
  ) {
    totalLength
    questions {
      id
      questionFrontendId
      title
      titleSlug
      difficulty
      acRate
      frequency
      paidOnly
      status
      topicTags {
        name
        slug
      }
    }
  }
}
`;

export class LeetCodeApi {
  constructor(config = {}) {
    this.baseUrl = (config.baseUrl || DEFAULT_BASE_URL).replace(/\/$/, '');
    this.session = process.env.LEETCODE_SESSION || config.session || '';
    this.csrfToken = process.env.LEETCODE_CSRFTOKEN || config.csrfToken || '';
  }

  async getQuestion(titleSlug) {
    const response = await this.request('/graphql', {
      method: 'POST',
      body: {
        operationName: 'questionData',
        variables: { titleSlug },
        query: QUESTION_QUERY,
      },
      authRequired: false,
    });

    const question = response?.data?.question;
    if (!question) {
      throw new Error(`LeetCode did not return a problem for "${titleSlug}". Check the title slug.`);
    }

    if (question.isPaidOnly) {
      console.warn('Warning: this problem is marked paid-only. Your account must have access to run or submit it.');
    }

    return question;
  }

  async getUserStatus() {
    const response = await this.request('/graphql', {
      method: 'POST',
      body: {
        operationName: 'userStatus',
        variables: {},
        query: USER_STATUS_QUERY,
      },
      authRequired: false,
    });

    return response?.data?.userStatus || { isSignedIn: false, username: '' };
  }

  async loginWithPassword({ username, password }) {
    const jar = new CookieJar();
    await this.rawRequest('/graphql', {
      method: 'POST',
      body: {
        operationName: 'userStatus',
        variables: {},
        query: USER_STATUS_QUERY,
      },
      authRequired: false,
      jar,
    });
    const csrfToken = jar.get('csrftoken') || this.csrfToken;

    if (!csrfToken) {
      throw new Error('LeetCode did not issue a csrftoken cookie. Try "lc setup" instead.');
    }

    const form = new URLSearchParams({
      login: username,
      password,
      csrfmiddlewaretoken: csrfToken,
      next: '',
    });
    const loginResponse = await this.rawRequest('/accounts/login/', {
      method: 'POST',
      rawBody: form,
      contentType: 'application/x-www-form-urlencoded',
      referer: '/accounts/login/',
      csrfToken,
      jar,
      authRequired: false,
      throwOnHttpError: false,
    });

    if (isCloudflareChallenge(loginResponse)) {
      throw new Error('LeetCode blocked password login with a Cloudflare/CAPTCHA challenge. Use "lc setup" to save browser cookies instead.');
    }

    if (!loginResponse.response.ok && loginResponse.response.status !== 302) {
      const detail = loginResponse.text.slice(0, 300).replace(/\s+/g, ' ').trim();
      throw new Error(`LeetCode login failed with HTTP ${loginResponse.response.status}: ${detail || loginResponse.response.statusText}`);
    }

    this.session = jar.get('LEETCODE_SESSION') || this.session;
    this.csrfToken = jar.get('csrftoken') || csrfToken;

    const statusResponse = await this.rawRequest('/graphql', {
      method: 'POST',
      body: {
        operationName: 'userStatus',
        variables: {},
        query: USER_STATUS_QUERY,
      },
      csrfToken: this.csrfToken,
      jar,
      authRequired: false,
    });
    const status = statusResponse.parsed?.data?.userStatus || { isSignedIn: false, username: '' };

    if (!status.isSignedIn || !this.session) {
      throw new Error('LeetCode did not return a signed-in session. Check the username/password, 2FA, or use "lc setup" with browser cookies.');
    }

    return {
      session: this.session,
      csrfToken: this.csrfToken,
      username: status.username,
    };
  }

  async getTopKnowledgeTags() {
    const response = await this.request('/graphql', {
      method: 'POST',
      body: {
        operationName: 'topKnowledgeTags',
        variables: {},
        query: TOP_KNOWLEDGE_TAGS_QUERY,
      },
      authRequired: false,
    });

    return response?.data?.topKnowledgeTags || [];
  }

  async getCompanyTags() {
    const response = await this.request('/graphql', {
      method: 'POST',
      body: {
        operationName: 'companyTags',
        variables: {},
        query: COMPANY_TAGS_QUERY,
      },
      authRequired: true,
      csrfRequired: false,
    });

    return response?.data?.companyTags || [];
  }

  async listProblemsByTopics({ topicSlugs, limit = 20, skip = 0, combine = 'ALL' }) {
    const normalizedSlugs = topicSlugs.map((slug) => String(slug).trim()).filter(Boolean);
    if (normalizedSlugs.length === 0) {
      throw new Error('At least one topic slug is required.');
    }

    const response = await this.request('/graphql', {
      method: 'POST',
      body: {
        operationName: 'problemsetQuestionList',
        variables: {
          skip,
          limit,
          filters: {
            filterCombineType: combine,
            topicFilter: {
              topicSlugs: normalizedSlugs,
            },
          },
          sortBy: {
            sortField: 'FREQUENCY',
            sortOrder: 'DESCENDING',
          },
        },
        query: PROBLEMSET_QUESTION_LIST_QUERY,
      },
      referer: '/problemset/',
      authRequired: false,
    });

    const list = response?.data?.problemsetQuestionListV2;
    if (!list) {
      throw new Error(`LeetCode did not return a problem list: ${JSON.stringify(response)}`);
    }

    return {
      total: list.totalLength,
      questions: list.questions || [],
    };
  }

  async listProblemsByCompanies({ companySlugs, limit = 20, skip = 0, combine = 'ALL' }) {
    const normalizedSlugs = companySlugs.map((slug) => String(slug).trim()).filter(Boolean);
    if (normalizedSlugs.length === 0) {
      throw new Error('At least one company slug is required.');
    }

    const response = await this.request('/graphql', {
      method: 'POST',
      body: {
        operationName: 'problemsetQuestionList',
        variables: {
          skip,
          limit,
          filters: {
            filterCombineType: combine,
            companyFilter: {
              companySlugs: normalizedSlugs,
            },
          },
          sortBy: {
            sortField: 'FREQUENCY',
            sortOrder: 'DESCENDING',
          },
        },
        query: PROBLEMSET_QUESTION_LIST_QUERY,
      },
      referer: '/problemset/',
      authRequired: true,
      csrfRequired: false,
    });

    const list = response?.data?.problemsetQuestionListV2;
    if (!list) {
      throw new Error(`LeetCode did not return a problem list: ${JSON.stringify(response)}`);
    }

    return {
      total: list.totalLength,
      questions: list.questions || [],
    };
  }

  async listProblemStatuses({ limit, pageSize = 100 } = {}) {
    this.requireAuth({ csrfRequired: false });

    const questions = [];
    let total;
    let skip = 0;

    while (total === undefined || skip < total) {
      const batchSize = limit
        ? Math.min(pageSize, limit - questions.length)
        : pageSize;
      if (batchSize <= 0) {
        break;
      }

      const response = await this.request('/graphql', {
        method: 'POST',
        body: {
          operationName: 'problemsetQuestionList',
          variables: {
            skip,
            limit: batchSize,
            filters: {
              filterCombineType: 'ALL',
            },
          },
          query: PROBLEMSET_QUESTION_LIST_QUERY,
        },
        referer: '/problemset/',
        authRequired: true,
        csrfRequired: false,
      });

      const list = response?.data?.problemsetQuestionListV2;
      if (!list) {
        throw new Error(`LeetCode did not return a problem list: ${JSON.stringify(response)}`);
      }

      total = list.totalLength;
      questions.push(...(list.questions || []));
      skip += batchSize;

      if (limit && questions.length >= limit) {
        break;
      }
    }

    return {
      total,
      questions: questions.slice(0, limit || questions.length),
    };
  }

  async interpretSolution({ titleSlug, questionId, langSlug, code, dataInput }) {
    this.requireAuth();
    const response = await this.request(`/problems/${titleSlug}/interpret_solution/`, {
      method: 'POST',
      body: {
        lang: langSlug,
        question_id: String(questionId),
        typed_code: code,
        data_input: dataInput,
      },
      referer: `/problems/${titleSlug}/`,
    });

    if (!response?.interpret_id) {
      throw new Error(`LeetCode did not return an interpret_id: ${JSON.stringify(response)}`);
    }

    return response;
  }

  async submitSolution({ titleSlug, questionId, langSlug, code }) {
    this.requireAuth();
    const response = await this.request(`/problems/${titleSlug}/submit/`, {
      method: 'POST',
      body: {
        lang: langSlug,
        question_id: String(questionId),
        typed_code: code,
      },
      referer: `/problems/${titleSlug}/`,
    });

    if (!response?.submission_id) {
      throw new Error(`LeetCode did not return a submission_id: ${JSON.stringify(response)}`);
    }

    return response;
  }

  async pollCheck(submissionId, { timeoutMs = 90_000, intervalMs = 1000 } = {}) {
    this.requireAuth({ csrfRequired: false });
    const deadline = Date.now() + timeoutMs;
    let last;

    while (Date.now() < deadline) {
      last = await this.request(`/submissions/detail/${submissionId}/check/`, {
        method: 'GET',
        referer: `/submissions/detail/${submissionId}/`,
      });

      if (last?.state === 'SUCCESS') {
        return last;
      }

      await sleep(intervalMs);
    }

    throw new Error(`Timed out waiting for LeetCode result. Last state: ${last?.state ?? 'unknown'}`);
  }

  async request(path, { method = 'GET', body, referer = '/', authRequired = true, csrfRequired = method !== 'GET' } = {}) {
    if (authRequired) {
      this.requireAuth({ csrfRequired });
    }

    const { response, text, parsed } = await this.rawRequest(path, {
      method,
      body,
      referer,
      authRequired,
      csrfRequired,
    });

    if (!response.ok) {
      const detail = parsed?.detail || parsed?.error || text.slice(0, 300);
      throw new Error(`LeetCode HTTP ${response.status} for ${method} ${path}: ${detail || response.statusText}`);
    }

    return parsed ?? text;
  }

  async rawRequest(
    path,
    {
      method = 'GET',
      body,
      rawBody,
      contentType,
      referer = '/',
      authRequired = true,
      csrfRequired = method !== 'GET',
      csrfToken = this.csrfToken,
      jar,
      throwOnHttpError = true,
    } = {},
  ) {
    if (authRequired) {
      this.requireAuth({ csrfRequired });
    }

    const headers = {
      accept: 'application/json, text/javascript, */*; q=0.01',
      'user-agent': 'leetcode-local-cli/0.1 (+https://leetcode.com)',
      'x-requested-with': 'XMLHttpRequest',
      referer: `${this.baseUrl}${referer}`,
    };

    if (body !== undefined || rawBody !== undefined) {
      headers['content-type'] = contentType || 'application/json';
      headers.origin = this.baseUrl;
    }

    const cookie = jar ? jar.header() : this.cookieHeader();
    if (cookie) {
      headers.cookie = cookie;
    }

    if (csrfToken) {
      headers['x-csrftoken'] = csrfToken;
    }

    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
      redirect: 'manual',
    });

    if (jar) {
      jar.addFromHeaders(response.headers);
    }

    const text = await response.text();
    const parsed = parseJson(text);

    if (throwOnHttpError && !response.ok) {
      const detail = parsed?.detail || parsed?.error || text.slice(0, 300);
      throw new Error(`LeetCode HTTP ${response.status} for ${method} ${path}: ${detail || response.statusText}`);
    }

    return { response, text, parsed };
  }

  cookieHeader() {
    const cookies = [];
    if (this.session) {
      cookies.push(`LEETCODE_SESSION=${this.session}`);
    }
    if (this.csrfToken) {
      cookies.push(`csrftoken=${this.csrfToken}`);
    }
    return cookies.join('; ');
  }

  requireAuth({ csrfRequired = true } = {}) {
    if (!this.session) {
      throw new Error('Missing LEETCODE_SESSION. Run "lc setup" or set LEETCODE_SESSION in your environment.');
    }
    if (csrfRequired && !this.csrfToken) {
      throw new Error('Missing csrftoken. Run "lc setup" or set LEETCODE_CSRFTOKEN in your environment.');
    }
  }
}

function parseJson(text) {
  if (!text) {
    return undefined;
  }

  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function isCloudflareChallenge({ response, text }) {
  return response.headers.get('cf-mitigated') === 'challenge'
    || /Just a moment|challenges\.cloudflare\.com|cf_chl/i.test(text);
}

class CookieJar {
  constructor() {
    this.cookies = new Map();
  }

  addFromHeaders(headers) {
    for (const value of getSetCookieHeaders(headers)) {
      const [pair] = value.split(';', 1);
      const separatorIndex = pair.indexOf('=');
      if (separatorIndex === -1) {
        continue;
      }

      const name = pair.slice(0, separatorIndex).trim();
      const cookieValue = pair.slice(separatorIndex + 1).trim();
      if (name) {
        this.cookies.set(name, cookieValue);
      }
    }
  }

  get(name) {
    return this.cookies.get(name);
  }

  header() {
    return Array.from(this.cookies, ([name, value]) => `${name}=${value}`).join('; ');
  }
}

function getSetCookieHeaders(headers) {
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie();
  }

  const value = headers.get('set-cookie');
  if (!value) {
    return [];
  }

  return splitSetCookieHeader(value);
}

function splitSetCookieHeader(value) {
  const parts = [];
  let start = 0;
  let inExpires = false;

  for (let i = 0; i < value.length; i += 1) {
    const char = value[i];
    if (char === ',') {
      if (!inExpires) {
        parts.push(value.slice(start, i).trim());
        start = i + 1;
      }
      continue;
    }

    const segment = value.slice(Math.max(start, i - 8), i + 1).toLowerCase();
    if (segment.endsWith('expires=')) {
      inExpires = true;
    } else if (inExpires && char === ';') {
      inExpires = false;
    }
  }

  parts.push(value.slice(start).trim());
  return parts.filter(Boolean);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
