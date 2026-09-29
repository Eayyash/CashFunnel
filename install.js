#!/usr/bin/env node
/**
 * Tasheel Command Center — cross-platform installer, two modes.
 *
 * Run with EXACTLY ONE of:
 *   node install.js --mode=existing   # use Emad Ayyash's account/repo directly
 *   node install.js --mode=new        # start a brand-new, independent account/repo
 *
 * (Running with no flag asks ONE question, then proceeds fully unattended.)
 *
 * Works identically on macOS, Windows, and Linux -- pure Node.js (fs/path/
 * os/child_process/readline), no shell-specific syntax. Needs Node.js and
 * git already installed; nothing else.
 *
 * WHY TWO MODES, AND WHY THIS IS FAST:
 * Both modes clone the SAME public repo (github.com/Eayyash/CashFunnel) --
 * there's no separate zip bundle to download, extract, and merge by hand.
 * Every dashboard is git-tracked with real data already baked in, so the
 * clone alone gets you a fully working Command Center; everything else
 * (npm install, config, folders) is a few seconds of unattended work.
 *
 *   --mode=existing: keeps the clone's git history and remote as-is. This
 *   machine can push updates straight back to the same repo, IF it's
 *   already signed in as an account with push access (the Emad Ayyash
 *   account). No login is attempted by this script -- see step 6.
 *
 *   --mode=new: strips the cloned .git folder and re-initializes a fresh,
 *   independent repository with one baseline commit -- zero shared
 *   history with the original repo or account. Nothing done here can
 *   reach or be reached by the original machine/account. If/when you
 *   want to back this up under your OWN GitHub account, step 6 prints
 *   the two commands to do that yourself -- this script never runs an
 *   interactive login for you (that was the single biggest time sink in
 *   the previous version of this installer).
 *
 * Usage: node install.js --mode=existing   OR   node install.js --mode=new
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const readline = require('readline');
const { execSync, spawnSync } = require('child_process');

const IS_WIN = process.platform === 'win32';
const REPO_URL = 'https://github.com/Eayyash/CashFunnel.git';

function log(msg) { console.log(msg); }
function section(title) { console.log('\n=== ' + title + ' ==='); }
function which(cmd) {
  try { execSync(IS_WIN ? `where ${cmd}` : `command -v ${cmd}`, { stdio: 'ignore' }); return true; }
  catch (e) { return false; }
}
function run(cmd, opts) { return spawnSync(cmd, { shell: true, stdio: 'inherit', ...opts }); }

async function askMode() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => {
    console.log('\nWhich account should this Command Center belong to?');
    console.log('  1) Emad Ayyash\'s existing account/repo (fastest -- shared history, can push updates back)');
    console.log('  2) A new, independent account (fresh history, nothing shared with the original)');
    rl.question('Enter 1 or 2: ', ans => {
      rl.close();
      resolve(ans.trim() === '2' ? 'new' : 'existing');
    });
  });
}

async function main() {
  section('0. Mode');
  const flag = process.argv.find(a => a.startsWith('--mode='));
  let mode = flag ? flag.split('=')[1] : null;
  if (mode !== 'existing' && mode !== 'new') {
    if (!process.stdin.isTTY) {
      console.error('ERROR: no valid --mode given and this isn\'t an interactive terminal.');
      console.error('Run one of:\n  node install.js --mode=existing\n  node install.js --mode=new');
      process.exit(1);
    }
    mode = await askMode();
  }
  log('Mode: ' + (mode === 'existing' ? 'existing account (Emad Ayyash) -- shared history' : 'new independent account -- fresh history'));

  // ── 1. Prerequisite check ────────────────────────────────────────────
  section('1. Checking prerequisites');
  if (!which('git')) {
    console.error('ERROR: git is not installed or not on PATH.');
    console.error(IS_WIN
      ? '  Install it from https://git-scm.com/download/win, then re-run this script.'
      : '  macOS: `xcode-select --install` or `brew install git`, then re-run.');
    process.exit(1);
  }
  log('git: OK (' + execSync('git --version').toString().trim() + ')');
  log('node: OK (' + process.version + ')');

  // ── 2. Target directory ──────────────────────────────────────────────
  section('2. Choosing install location');
  const BASE = process.env.AI_WORK_BASE || path.join(os.homedir(), 'Documents', 'EIA Work', 'AI-Work');
  const PROJECT_DIR = path.join(BASE, 'Analysis Agent');
  log('Base directory: ' + BASE);
  log('Project directory: ' + PROJECT_DIR);
  fs.mkdirSync(BASE, { recursive: true });

  // ── 3. Clone the repo (public, no authentication needed to read) ────
  section('3. Cloning the Command Center repo');
  if (fs.existsSync(path.join(PROJECT_DIR, '.git'))) {
    log('Repo already present at ' + PROJECT_DIR + ' -- pulling latest instead of re-cloning…');
    run('git fetch origin', { cwd: PROJECT_DIR });
    run('git checkout master', { cwd: PROJECT_DIR });
    run('git pull origin master', { cwd: PROJECT_DIR });
  } else {
    const cloneResult = run(`git clone "${REPO_URL}" "${PROJECT_DIR}"`);
    if (cloneResult.status !== 0) {
      console.error('ERROR: git clone failed -- check your internet connection and try again.');
      process.exit(1);
    }
  }

  // ── 4. Independent history, mode=new only ────────────────────────────
  if (mode === 'new') {
    section('4. Detaching from the original history (fresh, independent repo)');
    fs.rmSync(path.join(PROJECT_DIR, '.git'), { recursive: true, force: true });
    run('git init', { cwd: PROJECT_DIR });
    run('git add -A', { cwd: PROJECT_DIR });
    const commitResult = run('git commit -m "Initial baseline from Tasheel Command Center"', { cwd: PROJECT_DIR });
    if (commitResult.status === 0) {
      log('Created a brand-new local repository, one commit -- no shared history with the original.');
    }
  } else {
    section('4. Keeping shared history (mode=existing)');
    log('git remote stays pointed at ' + REPO_URL + ' -- this machine can push updates');
    log('back to the same repo once it\'s signed in with push access (see step 6).');
  }

  // ── 5. package.json + npm install ───────────────────────────────────
  section('5. Installing npm packages');
  const packageJson = {
    dependencies: { xlsx: '^0.18.5' },
    devDependencies: { docx: '^9.7.1', 'http-server': '^14.1.1' },
  };
  fs.writeFileSync(path.join(PROJECT_DIR, 'package.json'), JSON.stringify(packageJson, null, 2) + '\n');
  const npmResult = run(IS_WIN ? 'npm.cmd install --no-fund --no-audit' : 'npm install --no-fund --no-audit', { cwd: PROJECT_DIR });
  if (npmResult.status !== 0) log('  WARNING: npm install reported a problem -- you can re-run `npm install` in the project folder later.');

  // ── 6. Archive folders + pipeline.config.json ───────────────────────
  section('6. Setting up the daily-pipeline folders');
  const archiveFolders = {
    downloadsDir: path.join(os.homedir(), 'Downloads'),
    acquisitionArchiveDir: path.join(BASE, 'Acquisition for Loans'),
    funnelArchiveDir: path.join(BASE, 'Tawarruq Funnel'),
    simahArchiveDir: path.join(BASE, 'SIMAH Qarar JSON'),
    smsArchiveDir: path.join(BASE, 'SMS Campaigns'),
    smsSentListsDir: path.join(BASE, 'SMS Analyz'),
    snbReferralArchiveDir: path.join(BASE, 'SNB Referral'),
    digitalFunnelArchiveDir: path.join(BASE, 'Digital Funnel'),
  };
  Object.entries(archiveFolders).forEach(([key, dir]) => {
    if (key === 'downloadsDir') return;
    fs.mkdirSync(dir, { recursive: true });
  });
  const pipelineConfig = { ...archiveFolders, acquisitionHistoricalFiles: [] };
  fs.writeFileSync(path.join(PROJECT_DIR, 'pipeline.config.json'), JSON.stringify(pipelineConfig, null, 2) + '\n');
  log('Archive folders created under: ' + BASE);
  log('Wrote pipeline.config.json');

  // ── 7. GitHub push access -- informational only, never automated ────
  section('7. GitHub push access (optional, do this yourself whenever ready)');
  const hasGh = which('gh');
  if (mode === 'existing') {
    log('This repo is already ' + REPO_URL + '.');
    log('To push updates from this machine, it needs to be signed in as an');
    log('account with push access (the Emad Ayyash account):');
    if (hasGh) {
      log('  gh auth status         # check if already signed in');
      log('  gh auth login          # sign in if not (run this yourself, when ready)');
    } else {
      log('  Install the GitHub CLI (https://cli.github.com) and run `gh auth login`,');
      log('  or configure git credentials for this account by your usual method.');
    }
  } else {
    log('This is a brand-new, independent repo (local only so far). To back it');
    log('up under YOUR OWN GitHub account, whenever you\'re ready:');
    if (hasGh) {
      log('  cd "' + PROJECT_DIR + '"');
      log('  gh auth login                                    # your browser, your account');
      log('  gh repo create --private --source=. --remote=origin --push');
    } else {
      log('  1. Install the GitHub CLI (https://cli.github.com), OR create an empty');
      log('     repo yourself at https://github.com/new (no README/license/.gitignore)');
      log('  2. cd "' + PROJECT_DIR + '"');
      log('  3. git remote add origin <the URL you were given>');
      log('  4. git push -u origin master');
    }
  }
  log('\n(None of this is required to use the dashboards -- they already work locally.)');

  // ── 8. Verify every dashboard's embedded <script> blocks parse cleanly ──
  section('8. Verifying dashboards');
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
  log('data baked in. Nothing else to run just to look at it.');
  log('\nGoing forward: drop new daily export files in ' + archiveFolders.downloadsDir);
  log('and run the matching agent (see .claude/agents/*.md) exactly as documented.');
}

main().catch(e => { console.error(e); process.exit(1); });
