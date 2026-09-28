# Tasheel Command Center — New Machine Setup

**Updated 2026-09-28.** This supersedes the earlier version of this doc,
which cloned the dashboards from `github.com/Eayyash/CashFunnel` directly.
That approach doesn't work for someone who isn't the owner of that
account: it ties their new install to somebody else's git history and
gives no way to back their own work up under their own name. The design
here fixes that — see "Why this changed" below if you're curious.

## What you get

A **starter bundle** — a zip file — containing:
- `dashboards/` — all 11 dashboard HTML files, each with real data already
  baked in (they render immediately, no build step needed to look at them)
- `scripts/` — every Node.js pipeline script that keeps a dashboard updated
- `.claude/agents/` — the five agent instruction docs (FunnelBA, DailyBA,
  SIMAHDaily, SMSDaily, SNBReferralDaily)
- `install.js` — a single cross-platform installer (macOS + Windows,
  plain Node.js, no shell-specific code)
- `README.md` — the same instructions as this section, packaged alongside

## Installing it

You need **Node.js** and **git** already on the machine (both free, both
cross-platform). Then, from inside the extracted bundle folder:

```bash
node install.js
```

That single command:

1. Checks git/Node.js are present
2. Picks (or lets you override via `AI_WORK_BASE`) an install location —
   defaults to `~/Documents/EIA Work/AI-Work/Analysis Agent`
3. Copies the dashboards, scripts, and agent docs into place
4. Installs the npm packages the pipeline scripts need
5. Creates the daily-pipeline archive folders and writes
   `pipeline.config.json` — no interactive prompts for this part
6. **Asks you to connect your own GitHub account** — if the `gh` CLI is
   installed, it runs `gh auth login` right there (opens your browser,
   you sign in as yourself; the script itself never sees or stores your
   credentials). If `gh` isn't installed, it prints the two manual steps
   instead.
7. **Initializes a brand-new, independent git repository** in the install
   folder — one fresh commit, zero shared history with wherever the
   bundle came from
8. Verifies every dashboard's embedded script parses cleanly
9. Prints the exact commands to push to your own GitHub, whenever you're
   ready (it does not push for you — creating a remote repo and pushing
   to it under your account is your call, not something a script should
   do without you watching)

Total run time is mostly `npm install` — a minute or two on a normal
connection.

## The guarantees this is built around

- **This machine's repo, config, and agents are never touched by giving
  someone else this bundle.** The bundle is a static snapshot of files;
  handing it out doesn't grant access to anything on your machine.
- **The new machine gets its own independent git history from commit
  one.** It is not a fork, not a clone with a shadow remote, not
  connected in any way to the original repo. A `git log` on the new
  machine shows exactly one commit: the baseline `install.js` just made.
- **Nothing flows either direction after that.** Work done on the new
  machine — new dashboards, new agents, new daily data — never reaches
  the original machine or account. Updates made on the original machine
  afterward never reach the new machine automatically either. If you want
  to bring newer dashboards across later, you do it by generating a fresh
  bundle and re-running `install.js` (which is safe to re-run — see
  "Re-running / updating" below), or by manually copying specific files.
- **GitHub access is always the new user's own.** The installer asks
  *them* to authenticate, not anyone else. There's no account, token, or
  credential of the original owner's anywhere in the bundle or the script.

## Re-running / updating an existing install

`install.js` is safe to run again against the same `AI_WORK_BASE` — it
overwrites the dashboard/script/agent files with whatever's in the bundle
(so a newer bundle brings newer dashboards) but never touches
`pipeline.config.json` if you've already customized it, and never touches
the `.git` history it already created (step 8's `git init`/commit only
fires once — on a second run you'd `git add -A && git commit` yourself
if you want to snapshot the update).

## Known limitations

- **Raw daily source-file archives are not bundled** (the actual
  `.csv`/`.xlsx` exports, gitignored, several GB across months on the
  original machine). You don't need them to see today's dashboards or to
  keep the pipeline running forward — confirmed 2026-09-27 that nearly
  every pipeline self-seeds from the dashboard's own embedded data or
  from the next full daily export (each one is a complete cumulative
  snapshot, not a delta). The one exception is the bulk "SMS sent lists"
  reference folder, which starts empty on a new install and only affects
  one sub-section of the SMS Analyzer dashboard.
- **Auto-installing git/Node.js itself is not attempted** across both
  operating systems from one script — package managers differ too much
  (winget/choco on Windows, Homebrew on macOS) to do this reliably and
  silently. The script checks for both and prints the right per-OS
  install link if either is missing.
- A handful of one-off analysis scripts bundled in `scripts/` (not
  referenced by any of the five daily-pipeline agents) still have
  hardcoded paths from earlier ad-hoc work on the original machine —
  harmless unless you specifically try to run one of those.

## Why this changed (context for the original owner)

The first version of this doc had `install.js`'s predecessor run
`git clone https://github.com/Eayyash/CashFunnel.git` directly. That's
fine for replicating your *own* setup onto a second machine you also
control, but it stops making sense the moment someone else is the one
running the installer: they'd end up with your repo, your remote, your
commit history — no natural way to make it theirs, and no reason they
should need push access to your account in the first place. This version
treats every install as its own independent project from the start,
which is the right default whenever the bundle might leave your hands.
