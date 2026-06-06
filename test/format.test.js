import assert from 'node:assert/strict';
import test from 'node:test';

import {
  findAcceptedSubmissions,
  findLatestAcceptedSubmission,
} from '../lib/api.js';
import {
  formatAcceptedSubmissions,
  formatCheckResult,
  formatCompanyTags,
  formatProgressGrid,
  formatProblemList,
  formatTopicTags,
} from '../lib/format.js';

test('finds latest accepted submission', () => {
  const submission = findLatestAcceptedSubmission([
    { id: '1', statusDisplay: 'Wrong Answer', lang: 'cpp' },
    { id: '2', statusDisplay: 'Accepted', lang: 'python3' },
    { id: '3', statusDisplay: 'Accepted', lang: 'cpp' },
  ]);

  assert.equal(submission.id, '2');
});

test('finds latest accepted submission by language', () => {
  const submission = findLatestAcceptedSubmission([
    { id: '1', statusDisplay: 'Wrong Answer', lang: 'cpp' },
    { id: '2', statusDisplay: 'Accepted', lang: 'python3' },
    { id: '3', statusDisplay: 'Accepted', lang: 'cpp' },
  ], { langSlug: 'cpp' });

  assert.equal(submission.id, '3');
});

test('finds accepted submissions by language', () => {
  const submissions = findAcceptedSubmissions([
    { id: '1', statusDisplay: 'Wrong Answer', lang: 'cpp' },
    { id: '2', statusDisplay: 'Accepted', lang: 'python3' },
    { id: '3', statusDisplay: 'Accepted', lang: 'cpp' },
    { id: '4', statusDisplay: 'Accepted', lang: 'cpp' },
  ], { langSlug: 'cpp' });

  assert.deepEqual(submissions.map((submission) => submission.id), ['3', '4']);
});

test('formats wrong-answer submit fields returned by LeetCode', () => {
  const formatted = formatCheckResult({
    run_success: true,
    status_msg: 'Wrong Answer',
    total_correct: 3,
    total_testcases: 4,
    last_testcase: '[1,2,3]\n4',
    code_output: '[0,1]',
    expected_output: '[1,2]',
    std_output: 'debug line',
  }, { mode: 'submit' });

  assert.equal(formatted.ok, false);
  assert.match(formatted.text, /Submission: Wrong Answer/);
  assert.match(formatted.text, /Tests: 3\/4/);
  assert.match(formatted.text, /Input:\n\[1,2,3\]\n4/);
  assert.match(formatted.text, /Your output:\n\[0,1\]/);
  assert.match(formatted.text, /Expected:\n\[1,2\]/);
  assert.match(formatted.text, /Stdout:\ndebug line/);
});

test('formats submit runtime and memory beat percentiles', () => {
  const formatted = formatCheckResult({
    run_success: true,
    status_msg: 'Accepted',
    total_correct: 65,
    total_testcases: 65,
    status_runtime: '0 ms',
    runtime_percentile: 100,
    status_memory: '63 MB',
    memory_percentile: 10.331499999999949,
  }, { mode: 'submit' });

  assert.equal(formatted.ok, true);
  assert.match(formatted.text, /Submission: Accepted/);
  assert.match(formatted.text, /Runtime: 0 ms \(beats 100\.00%\)/);
  assert.match(formatted.text, /Memory: 63 MB \(beats 10\.33%\)/);
});

test('formats interpret answer arrays', () => {
  const formatted = formatCheckResult({
    run_success: true,
    status_msg: 'Accepted',
    correct_answer: false,
    total_correct: 0,
    total_testcases: 1,
    code_answer: ['false'],
    expected_code_answer: ['true'],
    std_output_list: ['debug line'],
  }, { mode: 'test' });

  assert.equal(formatted.ok, false);
  assert.match(formatted.text, /Run: Wrong Answer/);
  assert.match(formatted.text, /Tests: 0\/1/);
  assert.match(formatted.text, /Your output:\nfalse/);
  assert.match(formatted.text, /Expected:\ntrue/);
  assert.match(formatted.text, /Stdout:\ndebug line/);
});

test('formats test input for interpret runs', () => {
  const formatted = formatCheckResult({
    run_success: true,
    status_msg: 'Accepted',
    total_correct: 2,
    total_testcases: 2,
  }, {
    mode: 'test',
    testInput: '[2,7,11,15]\n9\n[3,2,4]\n6\n',
  });

  assert.equal(formatted.ok, true);
  assert.match(formatted.text, /Run: Accepted/);
  assert.match(formatted.text, /Tests: 2\/2/);
  assert.match(formatted.text, /Test input:\n\[2,7,11,15\]\n9\n\[3,2,4\]\n6/);
});

test('does not print empty stdout lists', () => {
  const formatted = formatCheckResult({
    run_success: true,
    status_msg: 'Accepted',
    correct_answer: false,
    code_answer: ['[1,2]', ''],
    expected_code_answer: ['[0,1]', ''],
    std_output_list: ['', ''],
  }, { mode: 'test' });

  assert.doesNotMatch(formatted.text, /Stdout:/);
  assert.match(formatted.text, /Your output:\n\[1,2\]/);
  assert.match(formatted.text, /Expected:\n\[0,1\]/);
});

test('formats frequent problem lists', () => {
  const text = formatProblemList({
    total: 250,
    topicLabels: ['two-pointers'],
    questions: [{
      questionFrontendId: '42',
      difficulty: 'HARD',
      frequency: 99.1,
      acRate: 0.673,
      status: 'SOLVED',
      paidOnly: false,
      title: 'Trapping Rain Water',
      titleSlug: 'trapping-rain-water',
    }],
  });

  assert.match(text, /Most frequent problems for: two-pointers/);
  assert.match(text, /Matched: 250/);
  assert.match(text, /42\s+Hard\s+99\.1\s+67\.3%\s+Solved\s+Free\s+Trapping Rain Water/);
});

test('formats topic tags', () => {
  const text = formatTopicTags([{ name: 'Depth-First Search', slug: 'depth-first-search' }]);

  assert.match(text, /Topic tags:/);
  assert.match(text, /Depth-First Search\s+depth-first-search/);
});

test('formats company tags', () => {
  const text = formatCompanyTags([{ name: 'OpenAI', slug: 'openai' }], { query: 'open' });

  assert.match(text, /Company tags matching "open":/);
  assert.match(text, /OpenAI\s+openai/);
});

test('formats accepted submissions with runtime and memory beat percentiles', () => {
  const text = formatAcceptedSubmissions({
    titleSlug: 'container-with-most-water',
    langSlug: 'cpp',
    limit: 20,
    submissions: [{
      id: '123456789',
      timestamp: '1700000000',
      langName: 'C++',
      runtime: 0,
      runtimePercentile: 100,
      memory: 63028000,
      memoryPercentile: 81.234,
      url: '/submissions/detail/123456789/',
    }],
  });

  assert.match(text, /Accepted submissions for container-with-most-water \(cpp\):/);
  assert.match(text, /Showing: 1 of up to 20/);
  assert.match(text, /Submitted\s+Lang\s+Runtime\s+Runtime Beat\s+Memory\s+Memory Beat/);
  assert.match(text, /2023-11-14 22:13:20 UTC\s+C\+\+\s+0 ms\s+100\.00%\s+63\.0 MB\s+81\.23%/);
});

test('formats progress grid', () => {
  const text = formatProgressGrid({
    total: 4,
    columns: 4,
    questions: [
      { questionFrontendId: '1', status: 'SOLVED' },
      { questionFrontendId: '2', status: 'TO_DO' },
      { questionFrontendId: '3', status: 'ATTEMPTED' },
      { questionFrontendId: '4', status: null },
    ],
  });

  assert.match(text, /Progress: 1\/4 solved \(25\.0%\)/);
  assert.match(text, /Attempted: 1  Not tried: 2  Shown: 4/);
  assert.match(text, /Legend: ■ solved  ◧ attempted  □ not tried/);
  assert.match(text, /0001 ■■□□◧◧□□ 0004/);
});

test('formats ascii progress grid', () => {
  const text = formatProgressGrid({
    total: 3,
    columns: 3,
    ascii: true,
    cellSize: 1,
    questions: [
      { questionFrontendId: '1', status: 'SOLVED' },
      { questionFrontendId: '2', status: 'ATTEMPTED' },
      { questionFrontendId: '3', status: 'TO_DO' },
    ],
  });

  assert.match(text, /Legend: # solved  ~ attempted  \. not tried/);
  assert.match(text, /0001 #~\. 0003/);
});

test('labels limited progress as shown progress', () => {
  const text = formatProgressGrid({
    total: 100,
    columns: 2,
    questions: [
      { questionFrontendId: '1', status: 'SOLVED' },
      { questionFrontendId: '2', status: 'TO_DO' },
    ],
  });

  assert.match(text, /Shown progress: 1\/2 solved \(50\.0%\)/);
  assert.match(text, /Total problems: 100/);
});
