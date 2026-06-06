import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LeetCodeApi,
} from '../lib/api.js';

test('finds question by frontend id without searchKeywords filter', async () => {
  const api = new LeetCodeApi();
  const calls = [];
  api.request = async (endpoint, options) => {
    calls.push({ endpoint, variables: options.body.variables });
    const skip = options.body.variables.skip;
    return {
      data: {
        problemsetQuestionListV2: {
          totalLength: 2,
          questions: skip === 0
            ? [{ questionFrontendId: '1', titleSlug: 'two-sum' }]
            : [{ questionFrontendId: '238', titleSlug: 'product-of-array-except-self' }],
        },
      },
    };
  };

  const question = await api.findQuestionByFrontendId('0238', { pageSize: 1 });

  assert.equal(question.titleSlug, 'product-of-array-except-self');
  assert.deepEqual(calls.map((call) => call.variables.skip), [0, 1]);
  assert.deepEqual(calls[0].variables.filters, { filterCombineType: 'ALL' });
  assert.equal(calls[0].variables.filters.searchKeywords, undefined);
});

test('lists accepted submissions with runtime and memory performance details', async () => {
  const api = new LeetCodeApi({ session: 'session' });
  const detailIds = [];

  api.request = async (endpoint, options) => {
    assert.equal(endpoint, '/graphql');

    if (options.body.operationName === 'submissionList') {
      return {
        data: {
          questionSubmissionList: {
            hasNext: false,
            lastKey: null,
            submissions: [
              { id: '1', statusDisplay: 'Wrong Answer', lang: 'cpp' },
              { id: '2', statusDisplay: 'Accepted', lang: 'python3' },
              { id: '3', statusDisplay: 'Accepted', lang: 'cpp', timestamp: '1700000000' },
            ],
          },
        },
      };
    }

    assert.equal(options.body.operationName, 'submissionDetails');
    detailIds.push(options.body.variables.submissionId);
    return {
      data: {
        submissionDetails: {
          id: options.body.variables.submissionId,
          runtime: '4 ms',
          runtimeDisplay: '4 ms',
          runtimePercentile: 93.21,
          memory: '17.5 MB',
          memoryDisplay: '17.5 MB',
          memoryPercentile: 62.5,
          statusDisplay: 'Accepted',
          timestamp: '1700000001',
          lang: {
            name: 'cpp',
            verboseName: 'C++',
          },
          question: {
            title: 'Two Sum',
            titleSlug: 'two-sum',
          },
          code: 'class Solution {};',
        },
      },
    };
  };

  const result = await api.listAcceptedSubmissions({
    titleSlug: 'two-sum',
    langSlug: 'cpp',
    limit: 10,
  });

  assert.deepEqual(detailIds, [3]);
  assert.equal(result.titleSlug, 'two-sum');
  assert.equal(result.langSlug, 'cpp');
  assert.equal(result.submissions.length, 1);
  assert.equal(result.submissions[0].id, '3');
  assert.equal(result.submissions[0].runtime, '4 ms');
  assert.equal(result.submissions[0].runtimeDisplay, '4 ms');
  assert.equal(result.submissions[0].runtimePercentile, 93.21);
  assert.equal(result.submissions[0].memory, '17.5 MB');
  assert.equal(result.submissions[0].memoryDisplay, '17.5 MB');
  assert.equal(result.submissions[0].memoryPercentile, 62.5);
  assert.equal(result.submissions[0].code, undefined);
});
