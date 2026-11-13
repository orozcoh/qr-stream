#!/usr/bin/env node
/**
 * Two-phase release helper.
 *
 *   pnpm release:check
 *   pnpm release:prepare <version>   # bump, changelog check, tests, PR, verify, merge
 *   pnpm release:publish             # tag, npm publish, GitHub release, smoke
 *
 * No dependencies. The auth preflight refuses to run if the active gh account
 * does not own the repo or npm is not logged in.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

const REPO = 'orozcoh/qr-stream';
const PACKAGE = '@orozcoh/qr-stream';
const CHANGELOG = 'CHANGELOG.md';

const args = process.argv.slice(2);
const command = args[0] ?? 'help';
const has = (flag) => args.includes(flag);
const valueOf = (flag) => {
  const index = args.indexOf(flag);
  return index >= 0 ? args[index + 1] : undefined;
};
const positional = args.slice(1).filter((arg) => !arg.startsWith('--'));
const yes = has('--yes');
const dry = has('--dry-run');
const skipChecks = has('--skip-checks');
const skipDeploy = has('--skip-deploy-check');
const noSmoke = has('--no-smoke');
const updateRelease = has('--update-release');
const resume = has('--resume');
const distTag = valueOf('--tag') ?? 'latest';

function fail(message) {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}
function info(message) {
  console.log(`\n▶ ${message}`);
}
function note(message) {
  console.log(`  ${message}`);
}

function printable(cmd, cmdArgs) {
  const parts = [cmd];
  for (let index = 0; index < cmdArgs.length; index += 1) {
    if (cmdArgs[index] === '--otp') {
      parts.push('--otp', '***');
      index += 1;
    } else {
      parts.push(cmdArgs[index]);
    }
  }
  return parts.join(' ');
}

function run(cmd, cmdArgs, options = {}) {
  const line = printable(cmd, cmdArgs);
  if (dry) {
    console.log(`  $ ${line}`);
    return { status: 0, stdout: '' };
  }
  if (!options.quiet) console.log(`\n$ ${line}`);
  const result = spawnSync(cmd, cmdArgs, {
    cwd: options.cwd ?? process.cwd(),
    stdio: options.stdio ?? 'inherit',
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error) fail(`${cmd}: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFail) {
    fail(`${line} failed (exit ${result.status})`);
  }
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

function capture(cmd, cmdArgs, options = {}) {
  const result = spawnSync(cmd, cmdArgs, {
    cwd: options.cwd ?? process.cwd(),
    encoding: 'utf8',
    env: process.env,
  });
  if (result.error) fail(`${cmd}: ${result.error.message}`);
  if (result.status !== 0 && !options.allowFail) {
    fail(`${printable(cmd, cmdArgs)} failed (exit ${result.status})${result.stderr ? `\n${result.stderr.trim()}` : ''}`);
  }
  const text = result.stdout ?? '';
  return {
    status: result.status ?? 1,
    stdout: options.trim === false ? text : text.trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

async function confirm(question) {
  if (yes) return;
  if (!stdin.isTTY) fail('confirmation is required but stdin is not a terminal; pass --yes');
  const rl = createInterface({ input: stdin, output: stdout });
  const answer = (await rl.question(`${question} [y/N] `)).trim().toLowerCase();
  rl.close();
  if (answer !== 'y' && answer !== 'yes') fail('cancelled');
}

function requireGh() {
  const user = capture('gh', ['api', 'user', '--jq', '.login'], { allowFail: true });
  if (user.status !== 0 || !user.stdout) {
    fail('gh is not logged in; run: gh auth login');
  }
  const login = user.stdout;
  const owner = capture('gh', ['repo', 'view', REPO, '--json', 'owner', '--jq', '.owner.login']).stdout;
  if (owner && login !== owner) {
    fail(`gh active account is ${login}, but the repo owner is ${owner}; run: gh auth switch --user ${owner}`);
  }
  note(`gh: ${login}`);
}

function requireNpm() {
  const result = capture('npm', ['whoami'], { allowFail: true });
  if (result.status !== 0 || !result.stdout) {
    fail('npm is not logged in (or the stored token is invalid); run: npm login');
  }
  note(`npm: ${result.stdout}`);
}

function readPackage() {
  return JSON.parse(readFileSync('package.json', 'utf8'));
}
function readVersion() {
  return readPackage().version;
}
function writeVersion(version) {
  const pkg = readPackage();
  pkg.version = version;
  writeFileSync('package.json', `${JSON.stringify(pkg, null, 2)}\n`);
}

function parseVersion(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(version);
  if (!match) fail(`invalid version ${version}; expected x.y.z or x.y.z-prerelease`);
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? null,
  };
}
function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);
  for (const field of ['major', 'minor', 'patch']) {
    if (left[field] !== right[field]) return left[field] - right[field];
  }
  if (left.pre === null && right.pre !== null) return 1;
  if (left.pre !== null && right.pre === null) return -1;
  if (left.pre !== null && right.pre !== null) return left.pre.localeCompare(right.pre);
  return 0;
}

function changelogBody(version) {
  if (!existsSync(CHANGELOG)) return null;
  const lines = readFileSync(CHANGELOG, 'utf8').split('\n');
  const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const heading = new RegExp(`^##\\s+${escaped}(?:\\s|$)`);
  const start = lines.findIndex((line) => heading.test(line));
  if (start === -1) return null;
  let end = lines.length;
  for (let index = start + 1; index < lines.length; index += 1) {
    if (/^##\s+/.test(lines[index])) {
      end = index;
      break;
    }
  }
  const body = lines.slice(start, end).join('\n').trim();
  return body ? `${body}\n` : null;
}

function changelogSection(version) {
  if (!existsSync(CHANGELOG)) fail(`${CHANGELOG} not found`);
  const body = changelogBody(version);
  if (!body) fail(`${CHANGELOG} has no non-empty "## ${version}" section; add it before preparing the release`);
  return body;
}

function releasedState(version) {
  const tag = `v${version}`;
  const npmView = capture('npm', ['view', `${PACKAGE}@${version}`, 'version'], { allowFail: true });
  const release = capture('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'tagName'], { allowFail: true });
  return {
    tag,
    published: npmView.status === 0 && npmView.stdout === version,
    tagExists: Boolean(capture('git', ['tag', '--list', tag], { allowFail: true }).stdout),
    hasRelease: release.status === 0,
  };
}

function ensureCleanMain(allowed = []) {
  const branch = capture('git', ['branch', '--show-current']).stdout;
  if (branch !== 'main') fail(`must be on main (currently ${branch || 'detached'})`);
  const status = capture('git', ['status', '--porcelain'], { trim: false }).stdout;
  if (status) {
    const changed = status
      .split('\n')
      .filter(Boolean)
      .map((line) => line.slice(3).trim())
      .filter((path) => !allowed.includes(path));
    if (changed.length > 0) fail(`worktree has unexpected changes:\n${changed.join('\n')}`);
  }
  capture('git', ['fetch', 'origin', '--tags']);
  const head = capture('git', ['rev-parse', 'HEAD']).stdout;
  const remote = capture('git', ['rev-parse', 'origin/main']).stdout;
  if (head !== remote) fail('local main is not up to date with origin/main; run: git pull --ff-only');
}

function checkDeploy(sha) {
  if (skipDeploy) return;
  const runs = JSON.parse(
    capture('gh', [
      'run',
      'list',
      '--repo',
      REPO,
      '--workflow',
      'deploy.yml',
      '--branch',
      'main',
      '--limit',
      '5',
      '--json',
      'databaseId,headSha,status,conclusion',
    ]).stdout || '[]',
  );
  const latest = runs.find((item) => item.headSha === sha);
  if (!latest) {
    note('no deploy run found for HEAD yet; skipping the deploy check');
    return;
  }
  if (latest.status !== 'completed') {
    info(`waiting for deploy ${latest.databaseId}`);
    run('gh', ['run', 'watch', String(latest.databaseId), '--repo', REPO, '--exit-status', '--interval', '10']);
    return;
  }
  if (latest.conclusion !== 'success') fail(`deploy ${latest.databaseId} concluded ${latest.conclusion}`);
  note(`deploy ${latest.databaseId}: success`);
}

function smoke(version) {
  const dir = mkdtempSync(join(tmpdir(), 'qr-stream-smoke-'));
  let passed = false;
  try {
    run('npm', ['init', '-y'], { cwd: dir, stdio: 'ignore' });
    run('npm', ['install', `${PACKAGE}@${version}`, '--no-audit', '--no-fund'], { cwd: dir });
    const code = `import('${PACKAGE}').then((m) => {
      if (typeof m.createQrStreamWriter !== 'function' || typeof m.createQrStreamReader !== 'function') {
        console.error('missing exports');
        process.exit(1);
      }
      console.log('smoke ok');
    }).catch((error) => { console.error(error); process.exit(1); })`;
    run('node', ['--input-type=module', '-e', code], { cwd: dir });
    passed = true;
  } finally {
    if (passed) {
      rmSync(dir, { recursive: true, force: true });
    } else {
      console.error(`\nSmoke workspace kept for inspection: ${dir}`);
    }
  }
}

function waitForNpm(version) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    const result = capture('npm', ['view', `${PACKAGE}@${version}`, 'version'], { allowFail: true });
    if (result.status === 0 && result.stdout === version) return;
    spawnSync('sleep', ['2']);
  }
  fail(`npm does not report ${version} after publish`);
}

function check() {
  requireGh();
  requireNpm();
  const branch = capture('git', ['branch', '--show-current']).stdout;
  const status = capture('git', ['status', '--porcelain'], { trim: false }).stdout;
  const version = readVersion();
  const state = releasedState(version);
  capture('git', ['fetch', 'origin', '--tags']);
  const head = capture('git', ['rev-parse', 'HEAD']).stdout;
  const remote = capture('git', ['rev-parse', 'origin/main']).stdout;

  info('release preflight');
  note(`branch: ${branch || 'detached'}`);
  note(`worktree: ${status ? 'dirty' : 'clean'}`);
  note(`main: ${head === remote ? 'up to date' : 'not synced with origin/main'}`);
  note(`version: ${version}`);
  note(`changelog: ${changelogBody(version) ? 'present' : 'missing'}`);
  note(`npm: ${state.published ? 'already published' : 'not published'}`);
  note(`tag ${state.tag}: ${state.tagExists ? 'exists' : 'absent'}`);
  note(`release: ${state.hasRelease ? 'exists' : 'absent'}`);

  if (branch !== 'main') fail('release requires main');
  if (status) fail('release requires a clean worktree');
  if (head !== remote) fail('local main is not up to date with origin/main; run: git pull --ff-only');
  note('preflight ok');
}

async function prepare(version) {
  if (!version) fail('usage: pnpm release:prepare <version>');
  const current = readVersion();
  if (compareVersions(version, current) <= 0) {
    fail(`version ${version} must be greater than the current ${current}`);
  }
  requireGh();
  ensureCleanMain([CHANGELOG]);
  const notes = changelogSection(version);
  const state = releasedState(version);
  if (state.published) fail(`${PACKAGE}@${version} is already published`);
  if (state.tagExists) fail(`tag ${state.tag} already exists`);
  if (state.hasRelease) fail(`GitHub release ${state.tag} already exists`);

  if (dry) {
    info(`dry run: prepare ${version}`);
    note(`would bump package.json ${current} -> ${version}`);
    note('would run typecheck, typecheck:core, test, build, demo:build, deploy:dry');
    note(`would create chore/release-${version}, commit, push, open PR, wait for verify, merge, pull main`);
    return;
  }

  const branch = `chore/release-${version}`;
  const branchExists = Boolean(capture('git', ['branch', '--list', branch], { allowFail: true }).stdout);
  if (branchExists) {
    if (!resume) fail(`branch ${branch} already exists; delete it or rerun with --resume`);
    run('git', ['checkout', branch]);
  } else {
    run('git', ['checkout', '-b', branch]);
  }

  writeVersion(version);
  run('pnpm', ['typecheck']);
  run('pnpm', ['typecheck:core']);
  run('pnpm', ['test']);
  run('pnpm', ['build']);
  run('pnpm', ['demo:build']);
  run('pnpm', ['deploy:dry']);

  run('git', ['add', 'package.json', CHANGELOG]);
  run('git', ['commit', '-m', `chore(release): prepare ${version}`]);
  run('git', ['push', '-u', 'origin', branch]);
  run('gh', [
    'pr',
    'create',
    '--repo',
    REPO,
    '--base',
    'main',
    '--head',
    branch,
    '--title',
    `chore(release): prepare ${version}`,
    '--body',
    `Release ${version}.\n\n${notes}\nVerification: typecheck, typecheck:core, test, build, demo:build, deploy:dry.\n`,
  ]);

  const pr = capture('gh', ['pr', 'view', branch, '--repo', REPO, '--json', 'number', '--jq', '.number']).stdout;
  info(`waiting for verify on PR #${pr}`);
  run('gh', ['pr', 'checks', pr, '--repo', REPO, '--watch', '--interval', '10']);
  await confirm(`Merge PR #${pr} into main?`);
  run('gh', ['pr', 'merge', pr, '--repo', REPO, '--merge']);
  run('git', ['checkout', 'main']);
  run('git', ['pull', '--ff-only']);
  run('git', ['branch', '-D', branch], { allowFail: true });
  run('git', ['push', 'origin', '--delete', branch], { allowFail: true });

  const sha = capture('git', ['rev-parse', 'HEAD']).stdout;
  checkDeploy(sha);
  info(`prepared ${version} on main at ${sha.slice(0, 7)}`);
  note('next: pnpm release:publish');
}

async function publish() {
  requireGh();
  requireNpm();
  ensureCleanMain();

  const version = readVersion();
  const notes = changelogSection(version);
  const tag = `v${version}`;
  const head = capture('git', ['rev-parse', 'HEAD']).stdout;

  const localTag = capture('git', ['tag', '--list', tag], { allowFail: true }).stdout;
  const remoteTag = capture('git', ['ls-remote', '--tags', 'origin', `refs/tags/${tag}`], { allowFail: true }).stdout;
  if (localTag || remoteTag) {
    const peeled = capture('git', ['rev-parse', `${tag}^{commit}`], { allowFail: true }).stdout;
    if (peeled !== head) fail(`tag ${tag} exists but does not point at HEAD (${head.slice(0, 7)})`);
  }

  const npmView = capture('npm', ['view', `${PACKAGE}@${version}`, 'version'], { allowFail: true });
  const published = npmView.status === 0 && npmView.stdout === version;
  if (published && !resume) fail(`${PACKAGE}@${version} is already published`);

  const release = capture('gh', ['release', 'view', tag, '--repo', REPO, '--json', 'tagName'], { allowFail: true });
  const hasRelease = release.status === 0;
  if (hasRelease && !updateRelease && !resume) fail(`GitHub release ${tag} already exists`);

  checkDeploy(head);
  if (!skipChecks) {
    run('pnpm', ['test']);
    run('pnpm', ['typecheck']);
  }

  if (dry) {
    info(`dry run: publish ${PACKAGE}@${version}`);
    note(`would tag ${tag}, push it, ${published ? 'skip npm publish (already published)' : 'run npm publish'}, ${hasRelease ? 'update' : 'create'} the GitHub release, and smoke-test`);
    return;
  }

  await confirm(`Publish ${PACKAGE}@${version}?`);
  if (!localTag && !remoteTag) run('git', ['tag', '-a', tag, '-m', version]);
  if (!remoteTag) run('git', ['push', 'origin', tag]);

  if (!published) {
    const npmArgs = ['publish'];
    if (process.env.NPM_OTP) npmArgs.push('--otp', process.env.NPM_OTP);
    if (distTag !== 'latest') npmArgs.push('--tag', distTag);
    run('npm', npmArgs);
  }

  const after = capture('npm', ['view', `${PACKAGE}@${version}`, 'version'], { allowFail: true });
  if (after.status !== 0 || after.stdout !== version) waitForNpm(version);

  const dir = mkdtempSync(join(tmpdir(), 'qr-stream-release-'));
  try {
    const notesFile = join(dir, 'notes.md');
    writeFileSync(notesFile, notes);
    if (hasRelease) {
      run('gh', ['release', 'edit', tag, '--repo', REPO, '--notes-file', notesFile]);
    } else {
      run('gh', ['release', 'create', tag, '--repo', REPO, '--title', version, '--notes-file', notesFile]);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }

  if (!noSmoke) smoke(version);
  info(`published ${PACKAGE}@${version}`);
  note(`npm: https://www.npmjs.com/package/${PACKAGE}/v/${version}`);
  note(`release: https://github.com/${REPO}/releases/tag/${tag}`);
}

function help() {
  console.log(`Usage:
  pnpm release:check
  pnpm release:prepare <version>
  pnpm release:publish

Options:
  --yes                 skip confirmation prompts
  --dry-run             print actions without changing anything
  --skip-checks         skip the final test/typecheck guard in publish
  --skip-deploy-check   skip waiting for the main deploy run
  --no-smoke            skip the registry install smoke test
  --update-release      update an existing GitHub release
  --resume              continue when the tag or npm version already exists
  --tag <name>          npm dist-tag (default: latest)

Environment:
  NPM_OTP               passed to npm publish as --otp when set`);
}

async function main() {
  if (command === 'check') return check();
  if (command === 'prepare') return prepare(positional[0]);
  if (command === 'publish') return publish();
  if (command === 'help' || command === '--help' || command === '-h') return help();
  fail(`unknown command ${command}`);
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)));
