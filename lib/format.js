export function formatCheckResult(result, { mode, testInput }) {
  const lines = [];
  const ok = isAccepted(result);
  const label = mode === 'submit' ? 'Submission' : 'Run';

  lines.push(`${label}: ${ok ? 'Accepted' : failedStatus(result)}`);

  if (result.total_correct !== undefined && result.total_testcases !== undefined) {
    lines.push(`Tests: ${result.total_correct}/${result.total_testcases}`);
  }

  if (result.status_runtime) {
    lines.push(`Runtime: ${result.status_runtime}`);
  }

  if (result.status_memory) {
    lines.push(`Memory: ${result.status_memory}`);
  }

  if (mode === 'test') {
    appendTestInput(lines, testInput);
  }

  if (result.compile_error || result.full_compile_error) {
    lines.push('');
    lines.push('Compile error:');
    lines.push(trimBlock(result.full_compile_error || result.compile_error));
  }

  if (result.runtime_error) {
    lines.push('');
    lines.push('Runtime error:');
    lines.push(trimBlock(result.full_runtime_error || result.runtime_error));
  }

  if (!ok) {
    appendFailureDetails(lines, result);
  }

  const stdout = firstPresent(result, ['stdout', 'std_output', 'std_output_list', 'standard_output']);
  if (stdout) {
    lines.push('');
    lines.push('Stdout:');
    lines.push(formatValue(stdout));
  }

  return {
    ok,
    text: lines.join('\n'),
  };
}

export function printResult(formatted) {
  console.log('');
  console.log(formatted.text);
  if (!formatted.ok) {
    process.exitCode = 2;
  }
}

export function formatProblemList({ questions, total, topicLabels, label = 'Most frequent problems for' }) {
  const lines = [];
  const title = topicLabels.length === 1 ? topicLabels[0] : topicLabels.join(', ');
  lines.push(`${label}: ${title}`);
  lines.push(`Matched: ${total}`);
  lines.push('');

  if (questions.length === 0) {
    lines.push('No problems found.');
    return lines.join('\n');
  }

  const hasFrequency = questions.some((question) => question.frequency !== null && question.frequency !== undefined);
  if (!hasFrequency) {
    lines.push('Frequency values were not returned by LeetCode. Configure cookies with "lc setup" if you need frequency ranking.');
    lines.push('');
  }

  const header = [
    '#'.padStart(2),
    'ID'.padStart(5),
    'Diff'.padEnd(6),
    'Freq'.padStart(6),
    'AC'.padStart(6),
    'Status'.padEnd(9),
    'Access'.padEnd(6),
    'Title',
  ].join('  ');
  lines.push(header);
  lines.push('-'.repeat(header.length));

  questions.forEach((question, index) => {
    lines.push([
      String(index + 1).padStart(2),
      String(question.questionFrontendId || question.id || '').padStart(5),
      formatDifficulty(question.difficulty).padEnd(6),
      formatFrequency(question.frequency).padStart(6),
      formatAcceptance(question.acRate).padStart(6),
      formatStatus(question.status).padEnd(9),
      (question.paidOnly ? 'Paid' : 'Free').padEnd(6),
      `${question.title} (${question.titleSlug})`,
    ].join('  '));
  });

  return lines.join('\n');
}

export function formatTopicTags(tags, { label = 'Topic tags' } = {}) {
  if (tags.length === 0) {
    return 'No topic tags returned by LeetCode.';
  }

  const lines = [`${label}:`, ''];
  for (const tag of tags) {
    lines.push(`${tag.name.padEnd(28)} ${tag.slug}`);
  }
  return lines.join('\n');
}

export function formatCompanyTags(tags, { query } = {}) {
  if (tags.length === 0) {
    return query
      ? `No company tags matched "${query}".`
      : 'No company tags returned by LeetCode.';
  }

  const lines = [query ? `Company tags matching "${query}":` : 'Company tags:', ''];
  for (const tag of tags) {
    lines.push(`${tag.name.padEnd(28)} ${tag.slug}`);
  }
  return lines.join('\n');
}

export function formatProgressGrid({ questions, total, columns = 50, ascii = false, cellSize = 2 }) {
  const sorted = [...questions].sort(compareQuestionIds);
  const stats = countStatuses(sorted);
  const symbols = ascii
    ? { solved: '#', attempted: '~', todo: '.', unknown: '?' }
    : { solved: '■', attempted: '◧', todo: '□', unknown: '?' };
  const repeat = Math.max(1, Number(cellSize) || 1);
  const lines = [];
  const showingSubset = total && sorted.length < total;
  const denominator = showingSubset ? sorted.length : total || sorted.length;
  const solvedPercent = denominator === 0 ? 0 : (stats.solved / denominator) * 100;

  lines.push(`${showingSubset ? 'Shown progress' : 'Progress'}: ${stats.solved}/${denominator} solved (${solvedPercent.toFixed(1)}%)`);
  if (showingSubset) {
    lines.push(`Total problems: ${total}`);
  }
  lines.push(`Attempted: ${stats.attempted}  Not tried: ${stats.todo}  Shown: ${sorted.length}`);
  lines.push(`Legend: ${symbols.solved} solved  ${symbols.attempted} attempted  ${symbols.todo} not tried`);
  lines.push('');

  if (sorted.length === 0) {
    lines.push('No problems found.');
    return lines.join('\n');
  }

  for (let index = 0; index < sorted.length; index += columns) {
    const row = sorted.slice(index, index + columns);
    const first = row[0];
    const last = row[row.length - 1];
    const cells = row.map((question) => progressSymbol(question.status, symbols).repeat(repeat)).join('');
    lines.push(`${formatQuestionId(first)} ${cells} ${formatQuestionId(last)}`);
  }

  return lines.join('\n');
}

function isAccepted(result) {
  if (result.run_success === false) {
    return false;
  }

  if (result.correct_answer === false) {
    return false;
  }

  if (result.total_correct !== undefined && result.total_testcases !== undefined) {
    return Number(result.total_correct) === Number(result.total_testcases)
      && result.status_msg === 'Accepted';
  }

  return result.run_success === true && result.status_msg === 'Accepted';
}

function formatDifficulty(value) {
  if (!value) {
    return '-';
  }

  return String(value).toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
}

function formatFrequency(value) {
  if (value === null || value === undefined) {
    return '-';
  }

  return Number(value).toFixed(1);
}

function formatAcceptance(value) {
  if (value === null || value === undefined) {
    return '-';
  }

  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '-';
  }

  const percent = numeric <= 1 ? numeric * 100 : numeric;
  return `${percent.toFixed(1)}%`;
}

function formatStatus(value) {
  if (!value) {
    return '-';
  }

  return String(value)
    .toLowerCase()
    .split('_')
    .map((part) => part.replace(/^\w/, (letter) => letter.toUpperCase()))
    .join('-');
}

function countStatuses(questions) {
  const stats = { solved: 0, attempted: 0, todo: 0, unknown: 0 };
  for (const question of questions) {
    const normalized = normalizeStatus(question.status);
    if (normalized === 'solved') {
      stats.solved += 1;
    } else if (normalized === 'attempted') {
      stats.attempted += 1;
    } else if (normalized === 'todo') {
      stats.todo += 1;
    } else {
      stats.unknown += 1;
    }
  }
  return stats;
}

function progressSymbol(status, symbols) {
  return symbols[normalizeStatus(status)] || symbols.unknown;
}

function normalizeStatus(status) {
  const normalized = String(status || 'TO_DO').toUpperCase();
  if (normalized === 'SOLVED' || normalized === 'AC') {
    return 'solved';
  }
  if (normalized === 'ATTEMPTED' || normalized === 'TRIED') {
    return 'attempted';
  }
  if (normalized === 'TO_DO' || normalized === 'TODO' || normalized === 'NOT_STARTED') {
    return 'todo';
  }
  return 'unknown';
}

function compareQuestionIds(left, right) {
  const leftNumber = Number(left.questionFrontendId || left.id);
  const rightNumber = Number(right.questionFrontendId || right.id);
  if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
    return leftNumber - rightNumber;
  }
  return String(left.questionFrontendId || left.id).localeCompare(String(right.questionFrontendId || right.id));
}

function formatQuestionId(question) {
  return String(question.questionFrontendId || question.id || '').padStart(4, '0');
}

function failedStatus(result) {
  if (hasWrongAnswerShape(result)) {
    return 'Wrong Answer';
  }

  return result.status_msg || 'Finished';
}

function hasWrongAnswerShape(result) {
  if (result.correct_answer === false) {
    return true;
  }

  if (result.total_correct !== undefined && result.total_testcases !== undefined) {
    return Number(result.total_correct) < Number(result.total_testcases);
  }

  return false;
}

function appendFailureDetails(lines, result) {
  const fields = [
    ['Input', firstPresent(result, ['last_testcase', 'input', 'testcase'])],
    ['Your output', firstPresent(result, ['code_answer', 'code_output', 'output', 'actual_output'])],
    ['Expected', firstPresent(result, ['expected_output', 'expected_code_answer', 'correct_answer'])],
  ];

  const available = fields.filter(([, value]) => value !== undefined && value !== null && value !== '');
  if (available.length === 0) {
    return;
  }

  lines.push('');
  for (const [label, value] of available) {
    lines.push(`${label}:`);
    lines.push(formatValue(value));
  }
}

function appendTestInput(lines, testInput) {
  if (isEmptyValue(testInput)) {
    return;
  }

  const formatted = formatValue(testInput);
  if (!formatted) {
    return;
  }

  lines.push('');
  lines.push('Test input:');
  lines.push(formatted);
}

function firstPresent(object, keys) {
  for (const key of keys) {
    const value = object[key];
    if (!isEmptyValue(value)) {
      return value;
    }
  }
  return undefined;
}

function formatValue(value) {
  if (Array.isArray(value)) {
    return trimBlock(value.filter((item) => !isEmptyValue(item)).map((item) => String(item)).join('\n'));
  }

  if (typeof value === 'object') {
    return trimBlock(JSON.stringify(value, null, 2));
  }

  return trimBlock(String(value));
}

function isEmptyValue(value) {
  if (value === undefined || value === null || value === '') {
    return true;
  }

  if (Array.isArray(value)) {
    return value.every((item) => isEmptyValue(item));
  }

  return false;
}

function trimBlock(value) {
  return String(value).replace(/\s+$/, '');
}
