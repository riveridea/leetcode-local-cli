import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
  createProblemFiles,
  findProblemDir,
} from '../lib/workspace.js';

test('finds local problem by frontend index', async () => {
  const workspaceRoot = await createWorkspace([
    {
      dir: '0001_two-sum',
      meta: {
        questionId: '1',
        questionFrontendId: '1',
        titleSlug: 'two-sum',
      },
    },
  ]);

  try {
    assert.equal(findProblemDir(workspaceRoot, '1'), problemPath(workspaceRoot, '0001_two-sum'));
    assert.equal(findProblemDir(workspaceRoot, '0001'), problemPath(workspaceRoot, '0001_two-sum'));
    assert.equal(findProblemDir(workspaceRoot, 'two-sum'), problemPath(workspaceRoot, '0001_two-sum'));
    assert.equal(findProblemDir(workspaceRoot, 'sum'), problemPath(workspaceRoot, '0001_two-sum'));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('numeric problem lookup does not use substring matching', async () => {
  const workspaceRoot = await createWorkspace([
    {
      dir: '0010_regular-expression-matching',
      meta: {
        questionId: '10',
        questionFrontendId: '10',
        titleSlug: 'regular-expression-matching',
      },
    },
  ]);

  try {
    assert.equal(findProblemDir(workspaceRoot, '1'), undefined);
    assert.equal(findProblemDir(workspaceRoot, '10'), problemPath(workspaceRoot, '0010_regular-expression-matching'));
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

test('writes problem description into cpp solution file', async () => {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'lc-workspace-'));

  try {
    const created = await createProblemFiles({
      workspaceRoot,
      langSlug: 'cpp',
      question: {
        questionId: '1',
        questionFrontendId: '1',
        title: 'Two Sum',
        titleSlug: 'two-sum',
        difficulty: 'Easy',
        sampleTestCase: '[2,7,11,15]\n9',
        content: '<p>Given an array of integers <code>nums</code>, return indices of the two numbers.</p>',
        topicTags: [{ name: 'Array' }],
        codeSnippets: [{
          langSlug: 'cpp',
          code: 'class Solution {\npublic:\n    vector<int> twoSum(vector<int>& nums, int target) {\n    }\n};',
        }],
      },
    });

    const solution = await readFile(path.join(created.problemDir, 'solution.cpp'), 'utf8');

    assert.match(solution, /^\/\/ # 1\. Two Sum/m);
    assert.match(solution, /^\/\/ - Difficulty: Easy/m);
    assert.match(solution, /^\/\/ Given an array of integers `nums`, return indices of the two numbers\./m);
    assert.match(solution, /\n\nclass Solution \{/);
  } finally {
    await rm(workspaceRoot, { recursive: true, force: true });
  }
});

async function createWorkspace(problems) {
  const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), 'lc-workspace-'));
  for (const problem of problems) {
    const problemDir = problemPath(workspaceRoot, problem.dir);
    await mkdir(problemDir, { recursive: true });
    await writeFile(path.join(problemDir, 'meta.json'), `${JSON.stringify(problem.meta, null, 2)}\n`, 'utf8');
  }

  return workspaceRoot;
}

function problemPath(workspaceRoot, dir) {
  return path.join(workspaceRoot, 'problems', dir);
}
