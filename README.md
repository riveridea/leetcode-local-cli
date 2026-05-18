# leetcode-local-cli

Small npm CLI for practicing LeetCode from this machine while editing solutions
with Vim or any other editor.

The tool uses your own LeetCode account session. It can save browser cookies, or
it can try an interactive username/password login and then save only the session
cookies. It does not try to bypass CAPTCHA, paywalls, rate limits, or other
account controls.

## Setup

Install the short `lc` command globally from this local checkout:

```sh
npm link
```

After that, use `lc` directly:

```sh
lc help
```

You can still run through npm from this directory if needed:

```sh
npm run lc -- help
```

```sh
lc login
```

If saved cookies are still valid, `lc login` skips the password prompt. Use this
to force a password login refresh:

```sh
lc login --force
```

LeetCode may block automated password login with Cloudflare, CAPTCHA, or 2FA.
When that happens, use cookie setup instead:

```sh
lc setup
```

`lc setup` first tries to import LeetCode cookies automatically from local
Chromium-family browser profiles on macOS, including Chrome, Edge, Brave, Arc,
and Chromium. You can narrow the search:

```sh
lc setup --browser chrome --profile "Profile 2"
```

If automatic import finds encrypted browser cookies, `lc setup` asks macOS to
unlock your login keychain and retries the import. The CLI does not store the
keychain password.

If automatic import still cannot decrypt the browser cookie store, it falls back
to manual setup. To skip automatic import:

```sh
lc setup --manual
```

For manual setup, paste one full browser `Cookie:` request header:

1. Open `https://leetcode.com/problemset/` and confirm you are signed in.
2. Open DevTools -> **Network**.
3. Refresh the page.
4. Click a `leetcode.com` request, usually `graphql`.
5. Copy the full Request Headers `Cookie:` value.
6. Paste it into `lc setup --manual`.

If that header is missing one of the required cookies, the CLI falls back to
asking for the individual `LEETCODE_SESSION` and `csrftoken` values.

They are saved to `~/.leetcode-local/config.json` with file mode `0600`.
You can also avoid the config file and set environment variables:

```sh
export LEETCODE_SESSION='...'
export LEETCODE_CSRFTOKEN='...'
```

## Workflow

Fetch a problem into `./problems`:

```sh
lc pull two-sum --lang cpp
```

Edit the generated solution:

```sh
lc open two-sum --editor vim
```

Run LeetCode's sample tests against the local file:

```sh
lc test two-sum
```

Submit the solution:

```sh
lc submit two-sum
```

Add `--json` to `test` or `submit` when you need to inspect the raw result
returned by LeetCode:

```sh
lc test two-sum --json
```

## Files

Each pulled problem gets a directory like:

```text
problems/0001_two-sum/
  cases.txt
  meta.json
  problem.md
  solution.cpp
```

Edit `cases.txt` to run different test data, or pass a separate file:

```sh
lc test two-sum --input ./my-cases.txt
```

Use `lc list` to see local problems and `lc status` to check config.

## Progress Grid

Show your LeetCode completion status as a compact grid:

```sh
lc progress
```

Legend:

```text
■ solved  ◧ attempted  □ not tried
```

Useful options:

```sh
lc progress --limit 500
lc progress --columns 40
lc progress --cell-size 3
lc progress --ascii
```

## Topic Frequency Search

List common topic slugs:

```sh
lc topics
```

Find the most frequent problems for a topic:

```sh
lc topics two pointers --limit 10
lc topics binary-search --limit 10
lc topics dfs --limit 10
```

Multiple comma-separated topics are also supported:

```sh
lc topics "two pointers, binary search" --limit 20
```

The command uses LeetCode's frequency field when your cookies are configured.
Without cookies, LeetCode may omit frequency values.

## Company Frequency Search

List common company slugs, or search for a company slug:

```sh
lc companies --limit 50
lc companies open
```

Find the most frequent problems tagged for a company:

```sh
lc company google --limit 20
lc company meta --limit 20
lc company openai --limit 20
```

Company tags require your LeetCode cookies because LeetCode exposes this data
through account-backed endpoints. Some company tags may include paid problems.

## Notes

LeetCode does not publish a stable official CLI API for this workflow. This tool
uses the same web endpoints that the LeetCode site uses today, so future site
changes can require small updates to `lib/api.js`.
