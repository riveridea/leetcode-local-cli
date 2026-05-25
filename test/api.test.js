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
