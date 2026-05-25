import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import {
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
