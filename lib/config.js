import { readFileSync } from 'node:fs';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { emitKeypressEvents } from 'node:readline';
import readline from 'node:readline/promises';

const CONFIG_DIR = '.leetcode-local';
const CONFIG_FILE = 'config.json';

export function configPath() {
  return path.join(os.homedir(), CONFIG_DIR, CONFIG_FILE);
}

export function loadConfig({ quiet = false } = {}) {
  try {
    const raw = readFileSyncCompat(configPath());
    const parsed = JSON.parse(raw);
    return normalizeConfig(parsed);
  } catch (error) {
    if (!quiet && error.code !== 'ENOENT') {
      console.warn(`Warning: could not read ${configPath()}: ${error.message}`);
    }
    return {};
  }
}

export async function saveConfig(config) {
  const filePath = configPath();
  await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
  await writeFile(filePath, `${JSON.stringify(normalizeConfig(config), null, 2)}\n`, {
    mode: 0o600,
  });
  await chmod(filePath, 0o600);
}

export async function promptForConfig({ current = {}, defaultWorkspace }) {
  console.log('Cookie setup — paste the "Cookie:" request header from your browser.');
  console.log('');
  console.log('1. In your browser, open https://leetcode.com/problemset/ and make sure');
  console.log('   you are signed in.');
  console.log('2. Open the DevTools "Network" tab:');
  console.log('   - macOS:   press  Cmd (⌘) + Option (⌥) + I  to open DevTools,');
  console.log('              then click the "Network" tab. (Shortcut to jump straight to');
  console.log('              the Network tab in Chrome: Cmd + Option + I, then Cmd + [ / ]');
  console.log('              to switch panels.)');
  console.log('   - Windows/Linux: press  Ctrl + Shift + I  (or F12), then "Network".');
  console.log('   - Or right-click the page -> "Inspect", then open the "Network" tab.');
  console.log('3. Reload the page so requests appear:  Cmd + R (macOS) / Ctrl + R (Win/Linux).');
  console.log('4. In the request list, click a request sent to leetcode.com');
  console.log('   (the "graphql" request, or the top-level document request, works well).');
  console.log('5. In the panel that opens, find the "Headers" section, scroll to');
  console.log('   "Request Headers", and locate the line that starts with  "Cookie:".');
  console.log('6. Select the entire value after "Cookie:" and copy it:');
  console.log('   - macOS:   select the text and press  Cmd (⌘) + C  (or right-click ->');
  console.log('              "Copy value").');
  console.log('   - Windows/Linux:  select and press  Ctrl + C.');
  console.log('7. Paste it at the prompt below:');
  console.log('   - macOS:   Cmd (⌘) + V    - Windows/Linux:  Ctrl + V  (or Ctrl + Shift + V');
  console.log('              in some terminals). The input is hidden as you paste.');
  console.log('');
  console.log('Leave it blank to keep the current saved cookies.');

  const cookieHeader = await hiddenQuestion(`Cookie header${current.session ? ' [keep current]' : ''}: `);
  const parsedCookies = parseCookieInput(cookieHeader);
  let session = parsedCookies.LEETCODE_SESSION;
  let csrfToken = parsedCookies.csrftoken;

  if (cookieHeader && (!session || !csrfToken)) {
    console.log('Could not find both LEETCODE_SESSION and csrftoken in that header.');
    console.log('Fallback: paste the individual cookie values instead.');
    console.log('Open DevTools -> "Application" tab (macOS shortcut: Cmd + Option + I, then');
    console.log('select the "Application" panel) -> Storage -> Cookies -> https://leetcode.com,');
    console.log('then copy the values of the LEETCODE_SESSION and csrftoken rows.');
    const sessionInput = session
      ? ''
      : await hiddenQuestion(`LEETCODE_SESSION${current.session ? ' [keep current]' : ''}: `);
    const csrfInput = csrfToken
      ? ''
      : await hiddenQuestion(`csrftoken${current.csrfToken ? ' [keep current]' : ''}: `);
    const fallbackCookies = parseCookieInput(`${sessionInput}; ${csrfInput}`);
    session = session || fallbackCookies.LEETCODE_SESSION || stripCookieAssignment(sessionInput, 'LEETCODE_SESSION');
    csrfToken = csrfToken || fallbackCookies.csrftoken || stripCookieAssignment(csrfInput, 'csrftoken');
  }

  const workspaceAnswer = await plainQuestion(`Workspace directory [${current.workspaceDir || defaultWorkspace}]: `);

  return normalizeConfig({
    session: session || current.session || '',
    csrfToken: csrfToken || current.csrfToken || '',
    workspaceDir: path.resolve(workspaceAnswer || current.workspaceDir || defaultWorkspace),
    baseUrl: current.baseUrl || 'https://leetcode.com',
  });
}

export async function promptForCredentials() {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error('Password login requires an interactive terminal. Run `lc login --force` directly in your shell, or use `lc setup`.');
  }

  const username = (await plainQuestion('LeetCode username or email: ')).trim();
  const password = await hiddenQuestion('LeetCode password: ');

  if (!username) {
    throw new Error('Username or email is required.');
  }
  if (!password) {
    throw new Error('Password is required.');
  }

  return { username, password };
}

function normalizeConfig(config) {
  const normalized = {};

  if (config.session) {
    normalized.session = String(config.session).trim();
  }
  if (config.csrfToken) {
    normalized.csrfToken = String(config.csrfToken).trim();
  }
  if (config.workspaceDir) {
    normalized.workspaceDir = path.resolve(String(config.workspaceDir));
  }
  if (config.baseUrl) {
    normalized.baseUrl = String(config.baseUrl).replace(/\/$/, '');
  }

  return normalized;
}

function parseCookieInput(input) {
  const cookies = {};
  const withoutHeader = String(input || '').replace(/^cookie:\s*/i, '');

  for (const part of withoutHeader.split(';')) {
    const trimmed = part.trim();
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex === -1) {
      continue;
    }

    const name = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (name === 'LEETCODE_SESSION' || name === 'csrftoken') {
      cookies[name] = value;
    }
  }

  return cookies;
}

function stripCookieAssignment(input, name) {
  const value = String(input || '').trim();
  const prefix = `${name}=`;
  if (value.startsWith(prefix)) {
    return value.slice(prefix.length).trim();
  }
  return value;
}

function readFileSyncCompat(filePath) {
  return readFileSync(filePath, 'utf8');
}

async function plainQuestion(prompt) {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  try {
    return await rl.question(prompt);
  } finally {
    rl.close();
  }
}

async function hiddenQuestion(prompt) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    return plainQuestion(prompt);
  }

  return readHiddenLine(prompt);
}

function readHiddenLine(prompt) {
  return new Promise((resolve, reject) => {
    const stdin = process.stdin;
    const stdout = process.stdout;
    const wasRaw = stdin.isRaw;
    let value = '';

    function cleanup() {
      stdin.off('keypress', onKeypress);
      if (stdin.setRawMode) {
        stdin.setRawMode(Boolean(wasRaw));
      }
      stdin.pause();
    }

    function onKeypress(input, key = {}) {
      if (key.ctrl && key.name === 'c') {
        cleanup();
        stdout.write('\n');
        reject(new Error('Interrupted.'));
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        cleanup();
        stdout.write('\n');
        resolve(value.trim());
        return;
      }

      if (key.name === 'backspace' || key.name === 'delete') {
        if (value.length > 0) {
          value = value.slice(0, -1);
          stdout.write('\b \b');
        }
        return;
      }

      if (!input || key.ctrl || key.meta) {
        return;
      }

      value += input;
      stdout.write('*');
    }

    stdout.write(prompt);
    emitKeypressEvents(stdin);
    if (stdin.setRawMode) {
      stdin.setRawMode(true);
    }
    stdin.resume();
    stdin.on('keypress', onKeypress);
  });
}
