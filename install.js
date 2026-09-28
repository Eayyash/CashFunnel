#!/usr/bin/env node
/**
 * Tasheel Command Center — cross-platform baseline installer.
 *
 * Run with: node install.js
 * Works identically on macOS, Windows, and Linux -- pure Node.js (fs/path/
 * os/child_process), no shell-specific syntax, no OS-specific package
 * manager calls. The only external dependency is Node.js itself (which you
 * already have, since you're running this) and git.
 *
 * WHAT THIS IS: a one-time baseline setup for a NEW person/machine that
 * wants to start their own independent copy of the Tasheel dashboard
 * suite -- their own GitHub account, their own git history, their own
 * repo. It is NOT a way to sync with or pull updates from anyone else's
 * existing installation, and running it never touches any other machine,
 * repo, or account:
 *
 *   - The dashboards you get are a point-in-time snapshot (whatever was
 *     bundled alongside this script), not a live connection to the
 *     original project. New dashboards or agents you build here are
 *     yours alone; nothing you do here can reach or affect the original
 *     machine's repo, config, or agents, and nothing that happens on that
 *     other machine after today will reach you automatically.
 *   - You will be asked to authenticate with YOUR OWN GitHub account
 *     (via the official `gh` CLI's own login flow -- this script never
 *     sees or handles your credentials). The new repo this script creates
 *     has no relationship to anyone else's GitHub account or repo.
 *
 * Usage: node install.js
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync, spawnSync } = require('child_process');

const HERE = __dirname; // the extracted bundle's own folder -- dashboards/scripts/agents live alongside this file
const IS_WIN = process.platform === 'win32';

function log(msg) { console.log(msg); }
function section(title) { console.log('\n=== ' + title + ' ==='); }

function which(cmd) {
  try {
    execSync(IS_WIN ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'ignore' });
    return true;
  } catch (e) { return false; }
}

function run(cmd, opts) {
  return spawnSync(cmd, { shell: true, stdio: 'inherit', ...opts });
}

function copyRecursive(src, dest) {
  const stat = fs.statSync(src);
  if (stat.isDirectory()) {
    fs.mkdirSync(dest, { recursive: true });
    for (const entry of fs.readdirSync(src)) {
      copyRecursive(path.join(src, entry), path.join(dest, entry));
    }
  } else {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(src, dest);
  }
}

// ── 1. Prerequisite check ──────────────────────────────────────────────
section('1. Checking prerequisites');
if (!which('git')) {
  console.error('ERROR: git is not installed or not on PATH.');
  console.error(IS_WIN
    ? '  Install it from https://git-scm.com/download/win, then re-run this script.'
    : '  macOS: install Xcode Command Line Tools (`xcode-select --install`) or `brew install git`, then re-run.');
  process.exit(1);
}
log('git: OK (' + execSync('git --version').toString().trim() + ')');
log('node: OK (' + process.version + ')');
const hasGh = which('gh');
log('gh CLI: ' + (hasGh ? 'OK' : 'not found (optional, but recommended for the GitHub step below)'));

// ── 2. Target directory (auto-detected, override with AI_WORK_BASE env var) ──
section('2. Choosing install location');
const BASE = process.env.AI_WORK_BASE || path.join(os.homedir(), 'Documents', 'EIA Work', 'AI-Work');
const PROJECT_DIR = path.join(BASE, 'Analysis Agent');
log('Base directory: ' + BASE);
log('Project directory: ' + PROJECT_DIR);
fs.mkdirSync(PROJECT_DIR, { recursive: true });

// ── 3. Copy the bundled dashboards, scripts, and agent docs ─────────────
section('3. Copying dashboards, scripts, and agent docs from this bundle');
const BUNDLE_ITEMS = ['dashboards', 'scripts', '.claude'];
BUNDLE_ITEMS.forEach(item => {
  const src = path.join(HERE, item);
  if (!fs.existsSync(src)) { log('  (skip) ' + item + ' not present in this bundle'); return; }
  if (item === 'dashboards') {
    // dashboards/*.html land at the project root, not in a dashboards/ subfolder
    for (const f of fs.readdirSync(src)) {
      copyRecursive(path.join(src, f), path.join(PROJECT_DIR, f));
      log('  copied ' + f);
    }
  } else {
    copyRecursive(src, path.join(PROJECT_DIR, item));
    log('  copied ' + item + '/');
  }
});

// ── 4. package.json + npm install ───────────────────────────────────────
section('4. Installing npm packages');
const packageJson = {
  dependencies: { xlsx: '^0.18.5' },
  devDependencies: { docx: '^9.7.1', 'http-server': '^14.1.1' },
};
fs.writeFileSync(path.join(PROJECT_DIR, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
const npmResult = run(IS_WIN ? 'npm.cmd install --no-fund --no-audit' : 'npm install --no-fund --no-audit', { cwd: PROJECT_DIR });
if (npmResult.status !== 0) log('  WARNING: npm install reported a problem -- you can re-run `npm install` in the project folder later.');

// ── 5. Archive folders + pipeline.config.json ───────────────────────────
section('5. Setting up the daily-pipeline folders');
const archiveFolders = {
  downloadsDir: path.join(os.homedir(), 'Downloads'),
  acquisitionArchiveDir: path.join(BASE, 'Acquisition for Loans'),
  funnelArchiveDir: path.join(BASE, 'Tawarruq Funnel'),
  simahArchiveDir: path.join(BASE, 'SIMAH Qarar JSON'),
  smsArchiveDir: path.join(BASE, 'SMS Campaigns'),
  smsSentListsDir: path.join(BASE, 'SMS Analyz'),
  snbReferralArchiveDir: path.join(BASE, 'SNB Referral'),
};
Object.entries(archiveFolders).forEach(([key, dir]) => {
  if (key === 'downloadsDir') return;
  fs.mkdirSync(dir, { recursive: true });
});
const pipelineConfig = { ...archiveFolders, acquisitionHistoricalFiles: [] };
fs.writeFileSync(path.join(PROJECT_DIR, 'pipeline.config.json'), JSON.stringify(pipelineConfig, null, 2) + '\n');
log('Archive folders created under: ' + BASE);
log('Wrote pipeline.config.json');

// ── 6. .gitignore (same conventions as the original project) ───────────
const gitignore = ['*.csv', '*.xlsx', '*.zip', 'node_modules/', 'package.json', 'package-lock.json',
  'holistic_view_data.json', 'JSON SIMAH/', 'pipeline.config.json', ''].join('\n');
fs.writeFileSync(path.join(PROJECT_DIR, '.gitignore'), gitignore);

// ── 7. GitHub account connection (YOUR account, not anyone else's) ─────
section('7. Connect your own GitHub account');
log('This project will live in its own brand-new git repository -- separate');
log('from wherever this bundle originally came from. To back it up to');
log('GitHub under YOUR account:');
if (hasGh && process.stdin.isTTY) {
  log('\nThe GitHub CLI (`gh`) is installed. Starting its login flow now --');
  log('this opens YOUR browser and signs in to YOUR account. This script');
  log('never sees or stores your credentials; `gh` handles the whole thing.\n');
  const ghAuth = run('gh auth login');
  if (ghAuth.status !== 0) {
    log('\n(Skipped or failed -- no problem, you can run `gh auth login` yourself anytime.)');
  }
} else if (hasGh) {
  log('\n`gh` is installed, but this isn\'t an interactive terminal, so the login');
  log('prompt is skipped. Run `gh auth login` yourself whenever you\'re ready.');
} else {
  log('\nThe GitHub CLI isn\'t installed, so this step is manual:');
  log('  1. Install it from https://cli.github.com (optional but convenient), OR');
  log('  2. Just create a repo at https://github.com/new under your own account');
  log('     and use plain `git remote add origin <your-repo-url>` later.');
}

// ── 8. Independent git history -- a fresh repo, no ties to the original ─
section('8. Initializing an independent git repository');
run('git init', { cwd: PROJECT_DIR });
run('git add -A', { cwd: PROJECT_DIR });
const commitResult = run('git commit -m "Initial baseline from Tasheel Command Center template"', { cwd: PROJECT_DIR });
if (commitResult.status === 0) {
  log('\nCreated a brand-new local repository with one commit: your own');
  log('starting point, completely separate from any other machine\'s history.');
}
log('\nTo push this to YOUR OWN GitHub account:');
if (hasGh) {
  log('  cd "' + PROJECT_DIR + '"');
  log('  gh repo create --private --source=. --remote=origin --push');
} else {
  log('  1. Create an empty repo at https://github.com/new (do NOT initialize it with a README)');
  log('  2. cd "' + PROJECT_DIR + '"');
  log('  3. git remote add origin <the URL github gave you>');
  log('  4. git push -u origin master');
}
log('\n(This script does not run that push for you -- creating a remote repo');
log('and pushing to it is your call to make, on your own account.)');

// ── 9. Verify every dashboard's embedded <script> blocks parse cleanly ──
section('9. Verifying dashboards');
const dashboardFiles = fs.readdirSync(PROJECT_DIR).filter(f => f.endsWith('.html'));
dashboardFiles.forEach(f => {
  try {
    const html = fs.readFileSync(path.join(PROJECT_DIR, f), 'utf-8');
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
    let bad = 0;
    scripts.forEach((s, i) => { try { new Function(s[1]); } catch (e) { bad++; log('  ' + f + ' block' + i + ' SYNTAX ERROR: ' + e.message); } });
    if (!bad) log('  OK  ' + f + ' (' + scripts.length + ' script block(s))');
  } catch (e) { log('  ERROR reading ' + f + ': ' + e.message); }
});

// ── Done ─────────────────────────────────────────────────────────────
section('Done');
log('\nCommand Center: file://' + path.join(PROJECT_DIR, 'index.html').replace(/\\/g, '/'));
log('Open that path in a browser now -- every dashboard already has real');
log('data baked in from this bundle. Nothing else to run just to look at it.');
log('\nGoing forward, this is entirely your own independent project:');
log('- Drop new daily export files in ' + archiveFolders.downloadsDir + ' and run the same');
log('  five pipeline agents (see .claude/agents/*.md) exactly as documented.');
log('- Build new dashboards, edit anything, commit to your own repo freely --');
log('  none of it can reach or be reached by wherever this bundle came from.');
