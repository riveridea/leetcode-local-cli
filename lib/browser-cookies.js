import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { cp, mkdtemp, readdir, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const COOKIE_NAMES = new Set(['LEETCODE_SESSION', 'csrftoken']);

const CHROMIUM_BROWSERS = [
  {
    id: 'chrome',
    name: 'Google Chrome',
    root: path.join(os.homedir(), 'Library/Application Support/Google/Chrome'),
    keychainService: 'Chrome Safe Storage',
    keychainAccount: 'Chrome',
  },
  {
    id: 'edge',
    name: 'Microsoft Edge',
    root: path.join(os.homedir(), 'Library/Application Support/Microsoft Edge'),
    keychainService: 'Microsoft Edge Safe Storage',
    keychainAccount: 'Microsoft Edge',
  },
  {
    id: 'brave',
    name: 'Brave',
    root: path.join(os.homedir(), 'Library/Application Support/BraveSoftware/Brave-Browser'),
    keychainService: 'Brave Safe Storage',
    keychainAccount: 'Brave',
  },
  {
    id: 'arc',
    name: 'Arc',
    root: path.join(os.homedir(), 'Library/Application Support/Arc/User Data'),
    keychainService: 'Arc Safe Storage',
    keychainAccount: 'Arc',
  },
  {
    id: 'chromium',
    name: 'Chromium',
    root: path.join(os.homedir(), 'Library/Application Support/Chromium'),
    keychainService: 'Chromium Safe Storage',
    keychainAccount: 'Chromium',
  },
];

export async function importLeetCodeCookiesFromBrowsers({ browser, profile } = {}) {
  if (process.platform !== 'darwin') {
    return {
      ok: false,
      reason: 'Automatic cookie import is currently implemented for macOS only.',
    };
  }

  const browsers = browser
    ? CHROMIUM_BROWSERS.filter((candidate) => candidate.id === browser || candidate.name.toLowerCase().includes(browser.toLowerCase()))
    : CHROMIUM_BROWSERS;

  if (browser && browsers.length === 0) {
    return {
      ok: false,
      reason: `Unknown browser "${browser}". Supported: ${CHROMIUM_BROWSERS.map((candidate) => candidate.id).join(', ')}.`,
    };
  }

  const attempts = [];
  for (const candidate of browsers) {
    const profiles = await findChromiumCookieDbs(candidate, profile);
    const key = await getMacChromiumKey(candidate);

    for (const cookieDb of profiles) {
      const result = await readLeetCodeCookies(cookieDb, candidate, key);
      attempts.push(result);
      if (result.ok) {
        return result;
      }
    }
  }

  const foundWithoutDecrypt = attempts.find((attempt) => attempt.foundEncrypted);
  if (foundWithoutDecrypt) {
    return {
      ok: false,
      needsKeychainUnlock: true,
      reason: `Found LeetCode cookies in ${foundWithoutDecrypt.browserName} ${foundWithoutDecrypt.profileName}, but could not decrypt them through macOS Keychain.`,
    };
  }

  return {
    ok: false,
    reason: 'No LeetCode browser cookies were found. Log in to leetcode.com in Chrome/Edge first, or use manual setup.',
  };
}

async function findChromiumCookieDbs(browser, requestedProfile) {
  let entries;
  try {
    entries = await readdir(browser.root, { withFileTypes: true });
  } catch {
    return [];
  }

  const profiles = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) {
      continue;
    }

    if (requestedProfile && entry.name !== requestedProfile) {
      continue;
    }

    const profileDir = path.join(browser.root, entry.name);
    profiles.push(
      {
        browser,
        profileName: entry.name,
        path: path.join(profileDir, 'Network', 'Cookies'),
      },
      {
        browser,
        profileName: entry.name,
        path: path.join(profileDir, 'Cookies'),
      },
    );
  }

  return profiles;
}

async function readLeetCodeCookies(cookieDb, browser, keychainPassword) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), 'lc-cookies-'));
  const tempDb = path.join(tempDir, 'Cookies');

  try {
    try {
      await cp(cookieDb.path, tempDb);
    } catch {
      return {
        ok: false,
        browserName: browser.name,
        profileName: cookieDb.profileName,
      };
    }

    const rows = await queryCookieRows(tempDb);
    const cookies = new Map();
    let foundEncrypted = false;
    let newestUpdate = 0;

    for (const row of rows) {
      newestUpdate = Math.max(newestUpdate, Number(row.lastUpdateUtc) || 0);
      const value = decryptCookieValue(row, keychainPassword);
      if (!value && row.encryptedHex) {
        foundEncrypted = true;
      }
      if (value && COOKIE_NAMES.has(row.name) && !cookies.has(row.name)) {
        cookies.set(row.name, value);
      }
    }

    const session = cookies.get('LEETCODE_SESSION');
    const csrfToken = cookies.get('csrftoken');
    if (session && csrfToken) {
      return {
        ok: true,
        session,
        csrfToken,
        browserName: browser.name,
        profileName: cookieDb.profileName,
        cookieDb: cookieDb.path,
        lastUpdateUtc: newestUpdate,
      };
    }

    return {
      ok: false,
      browserName: browser.name,
      profileName: cookieDb.profileName,
      foundEncrypted,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function queryCookieRows(cookieDb) {
  const query = `
select host_key, name, hex(value), hex(encrypted_value), expires_utc, last_update_utc
from cookies
where host_key like '%leetcode.com%'
  and name in ('LEETCODE_SESSION', 'csrftoken')
order by last_update_utc desc
`;
  const { stdout } = await execFileAsync('sqlite3', ['-separator', '\t', cookieDb, query], {
    encoding: 'utf8',
    timeout: 5000,
    maxBuffer: 1024 * 1024,
  });

  return stdout
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [hostKey, name, valueHex, encryptedHex, expiresUtc, lastUpdateUtc] = line.split('\t');
      return {
        hostKey,
        name,
        valueHex,
        encryptedHex,
        expiresUtc,
        lastUpdateUtc,
      };
    })
    .filter((row) => !isExpiredChromeCookie(row.expiresUtc));
}

function decryptCookieValue(row, keychainPassword) {
  if (row.valueHex) {
    const value = Buffer.from(row.valueHex, 'hex').toString('utf8');
    if (value) {
      return value;
    }
  }

  if (!row.encryptedHex || !keychainPassword) {
    return undefined;
  }

  const encrypted = Buffer.from(row.encryptedHex, 'hex');
  if (encrypted.length === 0) {
    return undefined;
  }

  if (encrypted.subarray(0, 3).toString('utf8') !== 'v10') {
    return undefined;
  }

  const decrypted = decryptMacChromiumV10(encrypted.subarray(3), keychainPassword);
  if (!decrypted) {
    return undefined;
  }

  const hostHash = crypto.createHash('sha256').update(row.hostKey).digest();
  const valueBytes = decrypted.subarray(0, 32).equals(hostHash)
    ? decrypted.subarray(32)
    : decrypted;
  const value = valueBytes.toString('utf8');

  return value || undefined;
}

function decryptMacChromiumV10(encrypted, keychainPassword) {
  const key = crypto.pbkdf2Sync(keychainPassword, 'saltysalt', 1003, 16, 'sha1');
  const iv = Buffer.alloc(16, 0x20);

  try {
    const decipher = crypto.createDecipheriv('aes-128-cbc', key, iv);
    decipher.setAutoPadding(false);
    let decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
    const padding = decrypted[decrypted.length - 1];
    if (padding < 1 || padding > 16) {
      return undefined;
    }
    decrypted = decrypted.subarray(0, -padding);
    return decrypted;
  } catch {
    return undefined;
  }
}

async function getMacChromiumKey(browser) {
  const loginKeychain = path.join(os.homedir(), 'Library/Keychains/login.keychain-db');
  const baseAttempts = [
    ['find-generic-password', '-w', '-a', browser.keychainAccount, '-s', browser.keychainService],
    ['find-generic-password', '-w', '-s', browser.keychainService],
    ['find-generic-password', '-w', '-l', browser.keychainService],
  ];
  const attempts = baseAttempts.flatMap((args) => [args, [...args, loginKeychain]]);

  for (const args of attempts) {
    try {
      const { stdout } = await execFileAsync('security', args, {
        encoding: 'utf8',
        timeout: 5000,
        maxBuffer: 64 * 1024,
      });
      const password = stdout.trim();
      if (password) {
        return password;
      }
    } catch {
      // Try the next keychain lookup shape.
    }
  }

  return undefined;
}

function isExpiredChromeCookie(expiresUtc) {
  const value = Number(expiresUtc);
  if (!Number.isFinite(value) || value === 0) {
    return false;
  }

  const chromeEpochOffsetMs = Date.UTC(1601, 0, 1);
  const expiresMs = chromeEpochOffsetMs + value / 1000;
  return expiresMs < Date.now();
}
