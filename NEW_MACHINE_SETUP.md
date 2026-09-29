# Tasheel Command Center — New Machine Setup

**Updated 2026-09-29.** This replaces the earlier zip-bundle version of
this doc. That version took roughly two hours to finish in practice —
downloading two separate zip parts, extracting and merging them by hand,
and an interactive GitHub login step that ran in the middle of the
install and was easy to get stuck on. This version fixes all three: one
file, one command, no login step blocking anything.

## Choose one, then run one command

**Option A — Use Emad Ayyash's existing account/repo** (fastest, ~3–5 minutes)
Use this if you're Emad, or setting this machine up as a continuation of
the existing project (shared history, can push updates straight back).

```bash
node install.js --mode=existing
```

**Option B — Start a brand-new, independent account** (~3–5 minutes, plus an optional GitHub step later)
Use this if a different person or team is starting their own copy. You
get a fresh, standalone git history — nothing shared with the original.

```bash
node install.js --mode=new
```

Both commands need only **`install.js`** (this one small file — nothing
else to download) plus **Node.js** and **git** already on the machine.
If you run `node install.js` with no `--mode` flag, it asks you that one
question and then runs the rest unattended.

## Why this is fast now

Both modes do the exact same first step: **`git clone` the actual,
public Command Center repo** (`github.com/Eayyash/CashFunnel`). Every
dashboard in it is already committed with real data baked in, so the
clone alone gets you a fully working Command Center — no separate zip,
no manual file merging. From there:

- **Option A** just keeps the clone's git history and remote as they are.
- **Option B** deletes the cloned `.git` folder and re-initializes a
  fresh one with a single baseline commit — same files, zero shared
  history.

Everything else (`npm install`, creating the daily-pipeline archive
folders, writing `pipeline.config.json`) is a few seconds of unattended
work either way.

## What `install.js` does, step by step

1. Checks git and Node.js are present
2. Picks an install location — defaults to
   `~/Documents/EIA Work/AI-Work/Analysis Agent` (override with the
   `AI_WORK_BASE` environment variable if you want it elsewhere)
3. Clones the repo (or pulls latest, if already cloned there before)
4. **Option B only:** strips `.git` and re-initializes a fresh, independent
   repository with one commit
5. Recreates `package.json` (gitignored) and runs `npm install`
6. Creates the archive folders and writes `pipeline.config.json` — no
   prompts for this part
7. Prints the GitHub push-access commands for your situation —
   **informational only, never runs a login for you**. This is the fix
   for the two-hour problem: the old version launched an interactive
   `gh auth login` mid-install; this version just tells you the two
   commands to run yourself, whenever you're ready, completely decoupled
   from getting the dashboards working
8. Verifies every dashboard's embedded script parses cleanly
9. Prints the path to open

## The guarantees this is built around

- **Option B's history is genuinely independent.** One fresh commit,
  no shared history, no shared remote. Nothing done there can reach or
  be reached by the original repo or account, in either direction.
- **Nothing on the original machine is touched by anyone running this.**
  `install.js` only ever reads from the public repo and writes to the
  new machine's own disk.
- **GitHub authentication is always a separate, optional, self-driven
  step.** The script never attempts a login on your behalf, for either
  mode.

## Re-running / updating

Both modes are safe to re-run against the same install location:

- **Option A:** re-running does a `git fetch` + `git pull` instead of a
  fresh clone — this is how you pull in dashboard updates from the
  original repo later.
- **Option B:** re-running (from the same `AI_WORK_BASE`) will hit the
  "already cloned" branch too, but since the `.git` folder here is the
  independent one from your first run, it will try to `git pull` from
  whatever remote you may have added — if you haven't added one, this
  will just report nothing to pull, harmlessly. Re-running does NOT
  reset your independent history a second time.

## Known limitations

- **Raw daily source-file archives are not part of the repo** (the
  actual `.csv`/`.xlsx` exports, gitignored, several GB across months).
  You don't need them to see today's dashboards or to keep the pipeline
  running forward — every pipeline either self-seeds from the dashboard's
  own embedded data or from the next full daily export (each one is a
  complete cumulative snapshot, not a delta). The one exception is the
  bulk "SMS sent lists" reference folder, which starts empty and only
  affects one sub-section of the SMS Analyzer dashboard.
- **Auto-installing git/Node.js itself is not attempted** — package
  managers differ too much across macOS/Windows to do this reliably and
  silently. The script just checks for both and tells you where to get
  whichever is missing.
- A handful of one-off analysis scripts in `scripts/` (not referenced by
  any of the five daily-pipeline agents) still have hardcoded paths from
  earlier ad-hoc work — harmless unless you specifically try to run one.
