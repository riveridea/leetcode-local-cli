#!/usr/bin/env node

import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

import { LeetCodeApi } from '../lib/api.js';
import { importLeetCodeCookiesFromBrowsers } from '../lib/browser-cookies.js';
import {
  configPath,
  loadConfig,
  promptForConfig,
  promptForCredentials,
  saveConfig,
} from '../lib/config.js';
import {
  formatCheckResult,
  formatCompanyTags,
  formatProgressGrid,
  formatProblemList,
  formatTopicTags,
  printResult,
} from '../lib/format.js';
import {
  createProblemFiles,
  defaultWorkspaceRoot,
  findProblemDir,
  listLocalProblems,
  loadProblemMeta,
  resolveProblemPaths,
  supportedLanguageSlugs,
} from '../lib/workspace.js';

const COMMANDS = new Map([
  ['help', commandHelp],
  ['login', commandLogin],
  ['setup', commandSetup],
  ['status', commandStatus],
  ['pull', commandPull],
  ['open', commandOpen],
  ['test', commandTest],
  ['submit', commandSubmit],
  ['list', commandList],
  ['progress', commandProgress],
  ['topics', commandTopics],
  ['frequent', commandTopics],
  ['companies', commandCompanies],
  ['company', commandCompany],
]);

main().catch((error) => {
  console.error(`\nError: ${error.message}`);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exitCode = 1;
});

async function main() {
  const argv = process.argv.slice(2);
  const commandName = argv[0] ?? 'help';
  const command = COMMANDS.get(commandName);

  if (!command) {
    throw new Error(`Unknown command "${commandName}". Run "lc help" for usage.`);
  }

  await command(parseArgs(argv.slice(1)));
}

async function commandHelp() {
  console.log(`leetcode-local-cli

Usage:
  lc login [--force]
  lc setup [--manual] [--browser chrome] [--profile "Profile 2"]
  lc status
  lc pull <title-slug> [--lang cpp] [--workspace ./problems-root] [--force]
  lc open [title-slug] [--editor vim]
  lc test [title-slug] [--input cases.txt] [--file solution.cpp] [--lang cpp] [--json]
  lc submit [title-slug] [--file solution.cpp] [--lang cpp] [--json]
  lc list
  lc progress [--limit 500] [--columns 50] [--cell-size 2] [--ascii]
  lc topics
  lc topics <topic[,topic...]> [--limit 20] [--json]
  lc companies [search] [--limit 50]
  lc company <company[,company...]> [--limit 20] [--json]

Examples:
  lc login
  lc setup
  lc pull two-sum --lang cpp
  lc open two-sum --editor vim
  lc test two-sum
  lc submit two-sum
  lc progress
  lc topics two pointers
  lc topics dfs --limit 15
  lc topics "two pointers, binary search"
  lc companies open
  lc company google --limit 20

Notes:
  - lc login prompts for your password locally and saves only cookies on success.
  - lc setup tries to import browser cookies automatically, then falls back to
    manual cookie paste when import is unavailable. If browser cookies are
    encrypted, setup asks macOS to unlock your login keychain and retries.
  - If LeetCode blocks CLI password login with CAPTCHA/Cloudflare, use lc setup
    and paste the full browser Cookie request header.
  - Use this only with your own account and respect LeetCode rate limits and terms.

Supported language slugs:
  ${supportedLanguageSlugs().join(', ')}
`);
}

async function commandLogin(args) {
  const current = loadConfig({ quiet: true });
  const api = new LeetCodeApi(current);

  if (!args.options.force && (current.session || process.env.LEETCODE_SESSION)) {
    try {
      const status = await api.getUserStatus();
      if (status.isSignedIn) {
        console.log(`Already signed in as ${status.username || 'your LeetCode account'}. Use "lc login --force" to refresh cookies.`);
        return;
      }
      console.log('Saved cookies are present but no longer signed in. Refreshing login.');
    } catch (error) {
      console.log(`Could not validate saved cookies: ${error.message}`);
      if (!args.options.force) {
        console.log('Use "lc login --force" to refresh cookies with password login, or try again when the network is available.');
        return;
      }
      console.log('Continuing with password login because --force was provided.');
    }
  }

  const { username, password } = await promptForCredentials();
  const login = await api.loginWithPassword({ username, password });
  await saveConfig({
    ...current,
    session: login.session,
    csrfToken: login.csrfToken,
    workspaceDir: current.workspaceDir || defaultWorkspaceRoot(process.cwd()),
    baseUrl: current.baseUrl || 'https://leetcode.com',
  });

  console.log(`Signed in as ${login.username || username}. Saved cookies to ${configPath()}.`);
}

async function commandSetup(args) {
  const current = loadConfig({ quiet: true });
  if (!args.options.manual) {
    console.log('Trying to import LeetCode cookies from local browser profiles...');
    let imported = await importLeetCodeCookiesFromBrowsers({
      browser: args.options.browser,
      profile: args.options.profile,
    });

    if (!imported.ok && imported.needsKeychainUnlock && process.stdin.isTTY && process.stdout.isTTY) {
      console.log(imported.reason);
      console.log('macOS needs to unlock your login keychain to decrypt browser cookies.');
      console.log('Enter your login keychain password at the macOS prompt. The CLI will not store it.');
      const unlocked = await unlockLoginKeychain();
      if (unlocked) {
        console.log('Retrying browser cookie import after keychain unlock...');
        imported = await importLeetCodeCookiesFromBrowsers({
          browser: args.options.browser,
          profile: args.options.profile,
        });
      }
    }

    if (imported.ok) {
      const nextConfig = {
        ...current,
        session: imported.session,
        csrfToken: imported.csrfToken,
        workspaceDir: current.workspaceDir || defaultWorkspaceRoot(process.cwd()),
        baseUrl: current.baseUrl || 'https://leetcode.com',
      };
      const oldFingerprint = cookieFingerprintSummary(current);
      await saveConfig(nextConfig);
      console.log(`Imported cookies from ${imported.browserName} (${imported.profileName}).`);
      printCookieChangeSummary(oldFingerprint, cookieFingerprintSummary(nextConfig));
      console.log(`Saved config to ${configPath()}`);
      await validateSavedLogin(nextConfig);
      return;
    }

    console.log(`Automatic import unavailable: ${imported.reason}`);
    console.log('Falling back to manual cookie setup. Use "lc setup --manual" to skip import next time.');
  }

  const answers = await promptForConfig({
    current,
    defaultWorkspace: defaultWorkspaceRoot(process.cwd()),
  });

  const oldFingerprint = cookieFingerprintSummary(current);
  await saveConfig(answers);
  console.log(`Saved config to ${configPath()}`);
  printCookieChangeSummary(oldFingerprint, cookieFingerprintSummary(answers));
  await validateSavedLogin(answers);
}

async function commandStatus() {
  const config = loadConfig({ quiet: true });
  const sessionSource = process.env.LEETCODE_SESSION ? 'env' : config.session ? 'config' : 'missing';
  const csrfSource = process.env.LEETCODE_CSRFTOKEN ? 'env' : config.csrfToken ? 'config' : 'missing';
  const workspace = config.workspaceDir || defaultWorkspaceRoot(process.cwd());

  console.log(`Config: ${configPath()}`);
  console.log(`Workspace: ${workspace}`);
  console.log(`LEETCODE_SESSION: ${sessionSource}`);
  console.log(`csrftoken: ${csrfSource}`);

  if (!config.session && !process.env.LEETCODE_SESSION) {
    console.log('\nRun "lc login", "lc setup", or set LEETCODE_SESSION before using run or submit.');
  }
}

async function commandPull(args) {
  const slug = requiredPositional(args, 0, 'title-slug');
  const lang = args.options.lang || 'cpp';
  const workspaceRoot = resolveWorkspaceRoot(args);
  const api = new LeetCodeApi(loadConfig({ quiet: true }));

  const question = await api.getQuestion(slug);
  const created = await createProblemFiles({
    workspaceRoot,
    question,
    langSlug: lang,
    force: Boolean(args.options.force),
  });

  console.log(`Created ${created.problemDir}`);
  for (const file of created.files) {
    console.log(`  ${file.action}: ${file.path}`);
  }
}

async function commandOpen(args) {
  const workspaceRoot = resolveWorkspaceRoot(args);
  const slug = args.positionals[0];
  const problemDir = findProblemDir(workspaceRoot, slug);

  if (!problemDir) {
    throw new Error(slug ? `No local problem found for "${slug}". Run "lc pull ${slug}" first.` : 'No local problem found from this directory.');
  }

  const { solutionPath } = await resolveProblemPaths(problemDir, args.options);
  const editor = args.options.editor || process.env.EDITOR || 'vim';
  await openEditor(editor, solutionPath);
}

async function commandTest(args) {
  const workspaceRoot = resolveWorkspaceRoot(args);
  const slug = args.positionals[0];
  const problemDir = findProblemDir(workspaceRoot, slug);

  if (!problemDir) {
    throw new Error(slug ? `No local problem found for "${slug}". Run "lc pull ${slug}" first.` : 'No local problem found from this directory.');
  }

  const config = loadConfig({ quiet: true });
  const api = new LeetCodeApi(config);
  const meta = await loadProblemMeta(problemDir);
  const { solutionPath, casesPath, langSlug } = await resolveProblemPaths(problemDir, args.options);

  const code = await readFile(solutionPath, 'utf8');
  const dataInput = await readTestInput(args.options.input || casesPath);
  const run = await api.interpretSolution({
    titleSlug: meta.titleSlug,
    questionId: meta.questionId,
    langSlug,
    code,
    dataInput,
  });

  console.log(`Run id: ${run.interpret_id}`);
  const result = await api.pollCheck(run.interpret_id, {
    timeoutMs: numberOption(args.options.timeout, 90_000),
  });

  printResult(formatCheckResult(result, { mode: 'test' }));
  printJsonIfRequested(result, args.options);
}

async function commandSubmit(args) {
  const workspaceRoot = resolveWorkspaceRoot(args);
  const slug = args.positionals[0];
  const problemDir = findProblemDir(workspaceRoot, slug);

  if (!problemDir) {
    throw new Error(slug ? `No local problem found for "${slug}". Run "lc pull ${slug}" first.` : 'No local problem found from this directory.');
  }

  const config = loadConfig({ quiet: true });
  const api = new LeetCodeApi(config);
  const meta = await loadProblemMeta(problemDir);
  const { solutionPath, langSlug } = await resolveProblemPaths(problemDir, args.options);

  const code = await readFile(solutionPath, 'utf8');
  const submitted = await api.submitSolution({
    titleSlug: meta.titleSlug,
    questionId: meta.questionId,
    langSlug,
    code,
  });

  console.log(`Submission id: ${submitted.submission_id}`);
  const result = await api.pollCheck(submitted.submission_id, {
    timeoutMs: numberOption(args.options.timeout, 120_000),
  });

  printResult(formatCheckResult(result, { mode: 'submit' }));
  printJsonIfRequested(result, args.options);
}

async function commandList(args) {
  const workspaceRoot = resolveWorkspaceRoot(args);
  const problems = await listLocalProblems(workspaceRoot);

  if (problems.length === 0) {
    console.log('No local problems found. Run "lc pull two-sum" to create one.');
    return;
  }

  for (const problem of problems) {
    console.log(`${problem.questionFrontendId.padStart(4, '0')}  ${problem.titleSlug}  ${problem.langSlug}  ${problem.path}`);
  }
}

async function commandProgress(args) {
  const config = loadConfig({ quiet: true });
  const api = new LeetCodeApi(config);
  const limit = args.options.limit ? integerOption(args.options.limit, 0, { min: 1 }) : undefined;
  const columns = integerOption(args.options.columns, 50, { min: 10 });
  const cellSize = integerOption(args.options.cellSize, 2, { min: 1 });
  const pageSize = integerOption(args.options.pageSize, 100, { min: 20 });
  const result = await api.listProblemStatuses({
    limit,
    pageSize,
  });

  console.log(formatProgressGrid({
    total: result.total,
    questions: result.questions,
    columns,
    cellSize,
    ascii: Boolean(args.options.ascii),
  }));
  printJsonIfRequested(result, args.options);
}

async function commandTopics(args) {
  const config = loadConfig({ quiet: true });
  const api = new LeetCodeApi(config);
  const tags = await api.getTopKnowledgeTags();

  if (args.positionals.length === 0) {
    console.log(formatTopicTags(tags));
    return;
  }

  const topicInputs = splitTopicInput(args.positionals);
  const topicSlugs = topicInputs.map((topic) => resolveTopicSlug(topic, tags));
  const limit = integerOption(args.options.limit, 20, { min: 1 });
  const skip = integerOption(args.options.skip, 0, { min: 0 });
  const result = await api.listProblemsByTopics({
    topicSlugs,
    limit,
    skip,
  });

  console.log(formatProblemList({
    total: result.total,
    questions: result.questions,
    topicLabels: topicSlugs,
  }));
  printJsonIfRequested(result, args.options);
}

async function commandCompanies(args) {
  const config = loadConfig({ quiet: true });
  const api = new LeetCodeApi(config);
  const companies = await api.getCompanyTags();
  const query = args.positionals.join(' ').trim();
  const filtered = query
    ? companies.filter((company) => companyMatches(company, query))
    : companies;
  const limit = integerOption(args.options.limit, 50, { min: 1 });

  console.log(formatCompanyTags(filtered.slice(0, limit), { query }));
}

async function commandCompany(args) {
  if (args.positionals.length === 0) {
    throw new Error('Missing company name or slug. Run "lc companies" to see valid company slugs.');
  }

  const config = loadConfig({ quiet: true });
  const api = new LeetCodeApi(config);
  const companies = await api.getCompanyTags();
  const companyInputs = splitCommaInput(args.positionals);
  const companySlugs = companyInputs.map((company) => resolveCompanySlug(company, companies));
  const limit = integerOption(args.options.limit, 20, { min: 1 });
  const skip = integerOption(args.options.skip, 0, { min: 0 });
  const result = await api.listProblemsByCompanies({
    companySlugs,
    limit,
    skip,
  });

  console.log(formatProblemList({
    total: result.total,
    questions: result.questions,
    topicLabels: companySlugs,
    label: 'Most frequent company-tagged problems for',
  }));
  printJsonIfRequested(result, args.options);
}


function parseArgs(argv) {
  const options = {};
  const positionals = [];

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (!token.startsWith('--')) {
      positionals.push(token);
      continue;
    }

    const withoutPrefix = token.slice(2);
    const [name, inlineValue] = withoutPrefix.split('=', 2);
    if (inlineValue !== undefined) {
      options[toCamelCase(name)] = inlineValue;
      continue;
    }

    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      options[toCamelCase(name)] = true;
      continue;
    }

    options[toCamelCase(name)] = next;
    i += 1;
  }

  return { options, positionals };
}

function toCamelCase(value) {
  return value.replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

function requiredPositional(args, index, label) {
  const value = args.positionals[index];
  if (!value) {
    throw new Error(`Missing ${label}. Run "lc help" for usage.`);
  }
  return value;
}

function resolveWorkspaceRoot(args) {
  const explicit = args.options.workspace;
  if (explicit) {
    return path.resolve(process.cwd(), explicit);
  }

  const config = loadConfig({ quiet: true });
  if (config.workspaceDir) {
    return config.workspaceDir;
  }

  return defaultWorkspaceRoot(process.cwd());
}

async function readTestInput(inputPath) {
  if (!inputPath) {
    throw new Error('No test input found. Create cases.txt or pass --input <path>.');
  }

  const absolutePath = path.resolve(process.cwd(), inputPath);
  if (existsSync(absolutePath)) {
    return readFile(absolutePath, 'utf8');
  }

  if (existsSync(inputPath)) {
    return readFile(inputPath, 'utf8');
  }

  throw new Error(`Test input file does not exist: ${inputPath}`);
}

async function openEditor(editor, filePath) {
  await new Promise((resolve, reject) => {
    const child = spawn(editor, [filePath], {
      stdio: 'inherit',
      shell: false,
    });

    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${editor} exited with code ${code}`));
      }
    });
  });
}

async function unlockLoginKeychain() {
  const keychainPath = path.join(os.homedir(), 'Library/Keychains/login.keychain-db');

  try {
    await new Promise((resolve, reject) => {
      const child = spawn('security', ['unlock-keychain', keychainPath], {
        stdio: 'inherit',
        shell: false,
      });

      child.on('error', reject);
      child.on('exit', (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`security unlock-keychain exited with code ${code}`));
        }
      });
    });
    return true;
  } catch (error) {
    console.log(`Could not unlock login keychain: ${error.message}`);
    return false;
  }
}

function numberOption(value, fallback) {
  if (value === undefined || value === true) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Expected a positive number, got "${value}".`);
  }

  return parsed;
}

function integerOption(value, fallback, { min = 1 } = {}) {
  const parsed = value === undefined || value === true ? fallback : Number(value);
  if (!Number.isFinite(parsed) || parsed < min) {
    throw new Error(`Expected an integer >= ${min}, got "${value}".`);
  }
  if (!Number.isInteger(parsed)) {
    throw new Error(`Expected an integer, got "${value}".`);
  }
  return parsed;
}

function printJsonIfRequested(result, options) {
  if (!options.json) {
    return;
  }

  console.log('');
  console.log('Raw LeetCode result:');
  console.log(JSON.stringify(result, null, 2));
}

function splitTopicInput(positionals) {
  return splitCommaInput(positionals);
}

function splitCommaInput(positionals) {
  return positionals
    .join(' ')
    .split(',')
    .map((part) => part.trim())
    .filter(Boolean);
}

function resolveTopicSlug(input, tags) {
  const aliases = new Map([
    ['bfs', 'breadth-first-search'],
    ['breadth first search', 'breadth-first-search'],
    ['dfs', 'depth-first-search'],
    ['depth first search', 'depth-first-search'],
    ['dp', 'dynamic-programming'],
    ['dynamic programming', 'dynamic-programming'],
    ['graph theory', 'graph'],
    ['heap', 'heap-priority-queue'],
    ['priority queue', 'heap-priority-queue'],
    ['two pointer', 'two-pointers'],
    ['two pointers', 'two-pointers'],
  ]);
  const normalized = normalizeTopicInput(input);
  const alias = aliases.get(normalized);
  if (alias) {
    return alias;
  }

  const bySlug = tags.find((tag) => tag.slug === normalized);
  if (bySlug) {
    return bySlug.slug;
  }

  const byName = tags.find((tag) => normalizeTopicInput(tag.name) === normalized);
  if (byName) {
    return byName.slug;
  }

  return slugifyTopic(input);
}

function resolveCompanySlug(input, companies) {
  const aliases = new Map([
    ['facebook', 'facebook'],
    ['fb', 'facebook'],
    ['meta', 'facebook'],
    ['google', 'google'],
    ['alphabet', 'google'],
    ['hft', 'hrt'],
    ['hudson river trading', 'hrt'],
    ['jp morgan', 'jpmorgan'],
    ['jpmorgan chase', 'jpmorgan'],
    ['open ai', 'openai'],
    ['twitter', 'twitter'],
    ['x', 'twitter'],
  ]);
  const normalized = normalizeTopicInput(input);
  const alias = aliases.get(normalized);
  if (alias) {
    return alias;
  }

  const slug = slugifyTopic(input);
  const bySlug = companies.find((company) => company.slug === slug || normalizeTopicInput(company.slug) === normalized);
  if (bySlug) {
    return bySlug.slug;
  }

  const byName = companies.find((company) => normalizeTopicInput(company.name) === normalized);
  if (byName) {
    return byName.slug;
  }

  const containsName = companies.find((company) => normalizeTopicInput(company.name).includes(normalized));
  if (containsName) {
    return containsName.slug;
  }

  return slug;
}

function companyMatches(company, query) {
  const normalizedQuery = normalizeTopicInput(query);
  const slugQuery = slugifyTopic(query);
  return normalizeTopicInput(company.name).includes(normalizedQuery)
    || company.slug.includes(slugQuery);
}

function normalizeTopicInput(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ');
}

function slugifyTopic(value) {
  return String(value)
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .replace(/-+/g, '-');
}

async function validateSavedLogin(config) {
  try {
    const status = await new LeetCodeApi(config).getUserStatus();
    if (status.isSignedIn) {
      console.log(`Verified LeetCode login as ${status.username || 'your account'}.`);
      return;
    }

    console.log('Saved cookies, but LeetCode did not accept them as signed in.');
    console.log('Open leetcode.com in the browser, confirm you are logged in, then rerun "lc setup --manual" with fresh cookie values.');
  } catch (error) {
    console.log(`Saved cookies, but could not verify them now: ${error.message}`);
    console.log('Run "lc login" later to check whether the saved cookies are valid.');
  }
}

function cookieFingerprintSummary(config) {
  return {
    session: cookieFingerprint(config.session),
    csrfToken: cookieFingerprint(config.csrfToken),
  };
}

function cookieFingerprint(value) {
  const text = String(value || '');
  if (!text) {
    return { length: 0, fingerprint: 'missing' };
  }

  return {
    length: text.length,
    fingerprint: crypto.createHash('sha256').update(text).digest('hex').slice(0, 12),
  };
}

function printCookieChangeSummary(before, after) {
  console.log(`LEETCODE_SESSION: ${formatCookieChange(before.session, after.session)}`);
  console.log(`csrftoken: ${formatCookieChange(before.csrfToken, after.csrfToken)}`);
}

function formatCookieChange(before, after) {
  const changed = before.fingerprint !== after.fingerprint || before.length !== after.length;
  return `${changed ? 'updated' : 'unchanged'} (${after.length} chars, ${after.fingerprint})`;
}
