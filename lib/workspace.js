import { existsSync, readdirSync } from 'node:fs';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';

const LANGUAGE_EXTENSIONS = new Map([
  ['bash', 'sh'],
  ['c', 'c'],
  ['cpp', 'cpp'],
  ['csharp', 'cs'],
  ['golang', 'go'],
  ['java', 'java'],
  ['javascript', 'js'],
  ['kotlin', 'kt'],
  ['mysql', 'sql'],
  ['php', 'php'],
  ['python', 'py'],
  ['python3', 'py'],
  ['ruby', 'rb'],
  ['rust', 'rs'],
  ['scala', 'scala'],
  ['swift', 'swift'],
  ['typescript', 'ts'],
]);

export function defaultWorkspaceRoot(cwd) {
  return path.resolve(cwd);
}

export function supportedLanguageSlugs() {
  return Array.from(LANGUAGE_EXTENSIONS.keys()).sort();
}

export async function createProblemFiles({ workspaceRoot, question, langSlug, force = false }) {
  const snippet = findSnippet(question, langSlug);
  const problemDir = path.join(workspaceRoot, 'problems', problemDirName(question));
  await mkdir(problemDir, { recursive: true });

  const extension = LANGUAGE_EXTENSIONS.get(langSlug);
  const files = [];
  const meta = {
    questionId: question.questionId,
    questionFrontendId: question.questionFrontendId,
    title: question.title,
    titleSlug: question.titleSlug,
    difficulty: question.difficulty,
    langSlug,
    solutionFile: `solution.${extension}`,
    sampleTestCase: question.sampleTestCase || '',
    url: `https://leetcode.com/problems/${question.titleSlug}/`,
    topicTags: (question.topicTags || []).map((tag) => tag.name),
  };

  await writeIfNeeded(path.join(problemDir, 'meta.json'), `${JSON.stringify(meta, null, 2)}\n`, { force: true, files });
  await writeIfNeeded(path.join(problemDir, 'problem.md'), problemMarkdown(question), { force: true, files });
  await writeIfNeeded(path.join(problemDir, 'cases.txt'), `${question.sampleTestCase || ''}\n`, { force, files });
  await writeIfNeeded(path.join(problemDir, meta.solutionFile), snippet.code, { force, files });

  return { problemDir, files };
}

export function findProblemDir(workspaceRoot, slugOrId) {
  if (!slugOrId) {
    const currentMeta = path.join(process.cwd(), 'meta.json');
    if (existsSync(currentMeta)) {
      return process.cwd();
    }
    return undefined;
  }

  const problemsRoot = path.join(workspaceRoot, 'problems');
  if (!existsSync(problemsRoot)) {
    return undefined;
  }

  const candidates = readdirSyncCompat(problemsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(problemsRoot, entry.name));

  const normalized = slugOrId.toLowerCase();
  return candidates.find((candidate) => {
    const base = path.basename(candidate).toLowerCase();
    return base === normalized || base.endsWith(`_${normalized}`) || base.includes(normalized);
  });
}

export async function listLocalProblems(workspaceRoot) {
  const problemsRoot = path.join(workspaceRoot, 'problems');
  if (!existsSync(problemsRoot)) {
    return [];
  }

  const entries = await readdir(problemsRoot, { withFileTypes: true });
  const problems = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    const problemDir = path.join(problemsRoot, entry.name);
    try {
      const meta = await loadProblemMeta(problemDir);
      problems.push({ ...meta, path: problemDir });
    } catch {
      // Ignore directories that are not managed by this tool.
    }
  }

  return problems.sort((a, b) => Number(a.questionFrontendId) - Number(b.questionFrontendId));
}

export async function loadProblemMeta(problemDir) {
  const metaPath = path.join(problemDir, 'meta.json');
  return JSON.parse(await readFile(metaPath, 'utf8'));
}

export async function resolveProblemPaths(problemDir, options = {}) {
  const meta = await loadProblemMeta(problemDir);
  const langSlug = options.lang || meta.langSlug;
  const solutionPath = options.file
    ? path.resolve(process.cwd(), options.file)
    : path.join(problemDir, meta.solutionFile || `solution.${LANGUAGE_EXTENSIONS.get(langSlug)}`);
  const casesPath = path.join(problemDir, 'cases.txt');

  if (!LANGUAGE_EXTENSIONS.has(langSlug)) {
    throw new Error(`Unsupported language slug "${langSlug}". Supported: ${supportedLanguageSlugs().join(', ')}`);
  }

  if (!existsSync(solutionPath)) {
    throw new Error(`Solution file does not exist: ${solutionPath}`);
  }

  return {
    meta,
    solutionPath,
    casesPath,
    langSlug,
  };
}

function findSnippet(question, langSlug) {
  if (!LANGUAGE_EXTENSIONS.has(langSlug)) {
    throw new Error(`Unsupported language slug "${langSlug}". Supported: ${supportedLanguageSlugs().join(', ')}`);
  }

  const snippet = (question.codeSnippets || []).find((candidate) => candidate.langSlug === langSlug);
  if (!snippet) {
    const available = (question.codeSnippets || []).map((candidate) => candidate.langSlug).join(', ');
    throw new Error(`Problem has no "${langSlug}" snippet. Available languages: ${available}`);
  }

  return snippet;
}

function problemDirName(question) {
  const frontEndId = String(question.questionFrontendId || question.questionId || '').padStart(4, '0');
  return `${frontEndId}_${question.titleSlug}`;
}

function problemMarkdown(question) {
  const topics = (question.topicTags || []).map((tag) => tag.name).join(', ') || 'None';
  return `# ${question.questionFrontendId}. ${question.title}

- Difficulty: ${question.difficulty}
- URL: https://leetcode.com/problems/${question.titleSlug}/
- Topics: ${topics}

${htmlToMarkdown(question.content || '')}
`;
}

async function writeIfNeeded(filePath, content, { force, files }) {
  const existed = existsSync(filePath);
  if (existed && !force) {
    files.push({ action: 'kept', path: filePath });
    return;
  }

  await writeFile(filePath, ensureTrailingNewline(content), 'utf8');
  files.push({ action: existed ? 'wrote' : 'created', path: filePath });
}

function ensureTrailingNewline(value) {
  return value.endsWith('\n') ? value : `${value}\n`;
}

function htmlToMarkdown(html) {
  return html
    .replace(/\r/g, '')
    .replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, code) => `\n\`\`\`\n${decodeHtmlEntities(stripTags(code)).trim()}\n\`\`\`\n`)
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<\/li>/gi, '')
    .replace(/<p[^>]*>/gi, '')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<sup[^>]*>([\s\S]*?)<\/sup>/gi, (_, value) => `^${stripTags(value).trim()}`)
    .replace(/<sub[^>]*>([\s\S]*?)<\/sub>/gi, (_, value) => `_${stripTags(value).trim()}`)
    .replace(/<strong[^>]*>/gi, '**')
    .replace(/<\/strong>/gi, '**')
    .replace(/<b[^>]*>/gi, '**')
    .replace(/<\/b>/gi, '**')
    .replace(/<em[^>]*>/gi, '*')
    .replace(/<\/em>/gi, '*')
    .replace(/<i[^>]*>/gi, '*')
    .replace(/<\/i>/gi, '*')
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, code) => `\`${decodeHtmlEntities(stripTags(code)).trim()}\``)
    .replace(/<\/?[a-z][^>]*>/gi, '')
    .replace(/\t+/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    .split('\n')
    .map((line) => decodeHtmlEntities(line).trimEnd())
    .join('\n');
}

function stripTags(value) {
  return value.replace(/<\/?[a-z][^>]*>/gi, '');
}

function decodeHtmlEntities(value) {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&le;/g, '<=')
    .replace(/&ge;/g, '>=')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&minus;/g, '-')
    .replace(/&times;/g, 'x')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function readdirSyncCompat(filePath, options) {
  return readdirSync(filePath, options);
}
