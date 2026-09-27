# Tasheel Command Center — New Machine Setup

This file is a **fully automated, zero-intervention installer**, not just
documentation. Run the one script in Section 2 top to bottom on a new
machine (different Windows user, no shared OneDrive account, nothing
pre-installed) and you end up with a **working Command Center showing
every current scorecard**, plus a pipeline ready to keep updating itself
the moment a new daily export lands.

It supersedes `REPLICATE_ON_NEW_MACHINE.md` (that file is now marked
deprecated) — this one reflects how the pipeline actually works today and
needs far less manual work than that older doc assumed.

## Why this can be zero-intervention (read this once)

Two facts about how this project is built make full automation possible:

1. **Every dashboard is a self-contained HTML file with its data already
   baked in, and all ten of them are committed to git** (`index.html` —
   the Command Center itself — plus `Acquisition_Command_Dashboard.html`,
   `Application_Cost.html`, `Business_Performance_View.html`,
   `Credit_Card_Dashboard.html`, `Funnel_Analysis.html`,
   `Holistic_View.html`, `Mobile_Journey_Source_of_Truth.html`,
   `SIMAH_Intelligence.html`, `SMS_Analyzer.html`, `SNB_Overview.html`).
   A plain `git clone` alone already gets you every current scorecard,
   fully populated — no rebuild, no data transfer, nothing to seed.
2. **The pipeline scripts that keep them updated are almost entirely
   self-seeding.** `update_funnel.js` reads Funnel_Analysis.html's own
   embedded `FUNNEL_DEFAULT` as its starting point; SIMAH's per-date
   history in `simah_data/*.json` (323 files) is git-tracked; every SMS
   Campaign and SNB Referral export is confirmed to be a **full cumulative
   snapshot back to day one**, not an incremental delta — so the very next
   real daily file dropped in on the new machine reconstructs the whole
   history on its own. The only pipeline that reads a configured
   "historical" seed list at all is Acquisition (`merge_csv.js`), and it's
   left empty here deliberately (see the caveat below) rather than trying
   to transfer the multi-hundred-MB daily archive.

The one thing genuinely **not** transferred by this script is the raw
daily source-file *archive* itself (the actual `.csv`/`.xlsx`/`JSON SIMAH`
files, all gitignored, several GB combined across months). You don't need
them to see today's dashboards or to keep the pipeline running forward —
you'd only need them to regenerate history from scratch, which the
pipeline never actually does.

## 1. Prerequisites

- Windows with **Git Bash** available (this script is bash, matching every
  other script in this repo)
- Internet access to github.com and the npm registry
- `winget` (built into Windows 10 2004+/Windows 11) — the script uses it to
  auto-install Git and Node.js if they're missing, with **no prompts**

Nothing else needs to be installed or configured by hand first.

## 2. Run this (the entire automated setup)

Paste this whole block into Git Bash and run it. It is idempotent — safe
to re-run if it's interrupted partway through.

```bash
set -e

# ── 0. Target directory (auto-detected, override with $AI_WORK_BASE if you want a non-default location) ──
BASE="${AI_WORK_BASE:-$HOME/Documents/EIA Work/AI-Work}"
REPO_DIR="$BASE/Analysis Agent"
REPO_URL="https://github.com/Eayyash/CashFunnel.git"
echo "==> Target base directory: $BASE"
mkdir -p "$BASE"

# ── 1. Prerequisite check — auto-install via winget if missing, no prompts ──
missing=()
command -v git  >/dev/null 2>&1 || missing+=("Git.Git")
command -v node >/dev/null 2>&1 || missing+=("OpenJS.NodeJS.LTS")
if [ ${#missing[@]} -gt 0 ]; then
  if command -v winget >/dev/null 2>&1; then
    for pkg in "${missing[@]}"; do
      echo "==> Installing $pkg via winget…"
      winget install --id "$pkg" -e --silent --accept-package-agreements --accept-source-agreements || true
    done
    echo ""
    echo "Git/Node were just installed. Close this Git Bash window, open a NEW one"
    echo "(so PATH picks up the install), and re-run this same script — it will"
    echo "pick up right where it left off."
    exit 0
  else
    echo "ERROR: git and/or node are missing, and winget isn't available to auto-install them."
    echo "Install Node.js LTS (https://nodejs.org) and Git (https://git-scm.com) manually, then re-run this script."
    exit 1
  fi
fi
echo "==> git: $(git --version) | node: $(node --version) | npm: $(npm --version)"

# ── 2. Clone (or update) the repo ──
if [ -d "$REPO_DIR/.git" ]; then
  echo "==> Repo already present at $REPO_DIR — pulling latest…"
  git -C "$REPO_DIR" fetch origin
  git -C "$REPO_DIR" checkout master
  git -C "$REPO_DIR" pull origin master
else
  echo "==> Cloning into $REPO_DIR…"
  git clone "$REPO_URL" "$REPO_DIR"
fi
cd "$REPO_DIR"

# ── 3. package.json is gitignored -- recreate it exactly, then install ──
cat > package.json <<'EOF'
{
  "dependencies": {
    "xlsx": "^0.18.5"
  },
  "devDependencies": {
    "docx": "^9.7.1",
    "http-server": "^14.1.1"
  }
}
EOF
echo "==> Installing npm packages…"
npm install --no-fund --no-audit

# ── 4. Archive folders -- siblings of the repo, same layout as the original machine ──
mkdir -p "$BASE/Acquisition for Loans" "$BASE/Tawarruq Funnel" "$BASE/SIMAH Qarar JSON" \
         "$BASE/SMS Campaigns" "$BASE/SMS Analyz" "$BASE/SNB Referral"
echo "==> Archive folders created under: $BASE"

# ── 5. pipeline.config.json -- generated directly, no interactive prompts ──
# (setup_config.js's interactive Q&A is skipped entirely; this writes the
# exact same schema it would have produced.)
AI_WORK_BASE_NODE="$BASE" node -e '
const fs = require("fs");
const path = require("path");
const os = require("os");
const base = process.env.AI_WORK_BASE_NODE;
const config = {
  downloadsDir: path.join(os.homedir(), "Downloads"),
  acquisitionArchiveDir: path.join(base, "Acquisition for Loans"),
  funnelArchiveDir: path.join(base, "Tawarruq Funnel"),
  simahArchiveDir: path.join(base, "SIMAH Qarar JSON"),
  smsArchiveDir: path.join(base, "SMS Campaigns"),
  smsSentListsDir: path.join(base, "SMS Analyz"),
  snbReferralArchiveDir: path.join(base, "SNB Referral"),
  // Deliberately empty -- see "Why this can be zero-intervention" above.
  // The next real daily Acquisition export is a full cumulative snapshot
  // and reconstructs the whole dataset on its own; nothing needs pre-seeding.
  acquisitionHistoricalFiles: []
};
fs.writeFileSync("pipeline.config.json", JSON.stringify(config, null, 2) + "\n");
console.log("Wrote pipeline.config.json:");
console.log(JSON.stringify(config, null, 2));
'

# ── 6. Verify every dashboard's embedded <script> blocks parse cleanly ──
echo ""
echo "==> Verifying dashboards…"
for f in index.html Acquisition_Command_Dashboard.html Application_Cost.html \
         Business_Performance_View.html Credit_Card_Dashboard.html Funnel_Analysis.html \
         Holistic_View.html Mobile_Journey_Source_of_Truth.html SIMAH_Intelligence.html \
         SMS_Analyzer.html SNB_Overview.html; do
  if [ -f "$f" ]; then
    node -e "
      const fs=require('fs');
      const html=fs.readFileSync('$f','utf8');
      const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
      let bad=0;
      scripts.forEach((s,i)=>{ try{ new Function(s[1]); }catch(e){ bad++; console.log('  $f block'+i+' SYNTAX ERROR: '+e.message); } });
      if(!bad) console.log('  ✅ $f ('+scripts.length+' script block(s))');
    "
  else
    echo "  ⚠️  $f not found -- check the clone succeeded"
  fi
done

echo ""
echo "✅ Setup complete."
echo ""
echo "Command Center: file://$REPO_DIR/index.html"
echo "Open that path in a browser now -- every scorecard is already populated"
echo "from the last commit. Nothing else to run just to look at it."
```

## 3. What you'll see immediately

Opening `index.html` (the Command Center) gives you every dashboard with
today's real numbers already in place — Acquisition, Application Cost,
Business Performance, Credit Card, Funnel Analysis, Holistic View, Mobile
Journey, SIMAH Intelligence, SMS Analyzer, SNB Overview. Nothing is blank
or placeholder data.

## 4. Keeping it updated going forward

Nothing changes about how you use the pipeline day to day — it's the
exact same agents, triggered the exact same way, once a new file lands in
Downloads (or wherever `downloadsDir` points):

| Agent | Triggered by | Updates |
|---|---|---|
| **FunnelBA** | New `Acquisition_for_Loans_*.csv` | Acquisition Command Dashboard, Application Cost, SNB Overview, Business Performance View |
| **DailyBA** | New `Tawarruq_Funnel_*.xlsx` | Funnel Analysis, Business Performance View |
| **SIMAHDaily** | New `SIMAH_Qarar_JSON_*.csv` | SIMAH Intelligence, `simah_data/` chunks, Business Performance View |
| **SMSDaily** | New `SMS_Campaign_*.xlsx` | SMS Analyzer |
| **SNBReferralDaily** | New `SNB_Referral_*.csv` | SNB Overview |

Reference the relevant `.claude/agents/*.md` file (all five are already in
the clone) exactly as on the original machine — they're fully
self-contained instructions and don't hardcode any machine-specific path
any more (everything routes through `pipeline.config.json`).

## 5. Known limitations (not blockers, just be aware)

- **SMS "sent lists" reference folder (`SMS Analyz`) starts empty.** These
  are large, standing bulk recipient-list files (500K+ rows each) that are
  never git-tracked and aren't part of this script's transfer. SMS
  Analyzer's "SMS Sent Campaigns" section will simply show nothing new
  until you manually copy files into that folder on the new machine — this
  degrades gracefully (a documented, non-error condition in
  `build_sms_analyzer.js`), it doesn't break anything else.
- **`git push` needs your own GitHub credentials on the new machine.**
  This script deliberately does not touch authentication — set up `gh auth
  login` or your usual git credential method once, yourself. (Not
  automatable for good reason: credentials should never be scripted or
  transferred by an assistant.)
- **A handful of one-off analysis scripts** (`build_coconut_*.js`,
  `build_ucfs_company_compare.js`, `compute_full_booked_competitor_stats.js`,
  `convert_simah_jsonl_to_daily_csv.js`, `generate_narratives.js`) still
  have hardcoded paths from ad-hoc investigations earlier in this project.
  None of the five standing daily-pipeline agents depend on them, so they
  don't affect the Command Center — only touch them if you specifically
  need to re-run one of those one-off analyses on the new machine.

## 6. Verifying success

- [ ] `file://<path>/Analysis Agent/index.html` opens and every tile links to a populated dashboard
- [ ] `node scripts/merge_csv.js` (after a real new `Acquisition_for_Loans_*.csv` arrives) runs without the "pipeline.config.json not found" error
- [ ] `git -C "<path>/Analysis Agent" remote -v` shows the correct origin
- [ ] `git push` succeeds once you've set up your own GitHub auth
