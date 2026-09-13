# Replicating the Tasheel Dashboard Pipeline on a New Machine

This project is a set of self-contained HTML dashboards (Acquisition, Funnel,
SIMAH, SNB, Business Performance, etc.) plus a set of Node.js scripts and
Claude Code agent definitions that keep them updated daily from raw data
exports. This guide gets the whole thing running on a **different** machine
— a second analyst's laptop, a fresh install, whatever.

Two things are true at once, and matter for what "replicate" means here:

1. **The dashboards themselves are fully self-contained HTML files, already
   committed to git with their data baked in.** A plain `git clone` gets you
   working, viewable dashboards as of the last commit — no rebuild needed
   just to *look* at them.
2. **The raw source data files (CSV/xlsx/JSON exports) are all
   `.gitignore`'d** — they never get committed (see `.gitignore`: `*.csv`,
   `*.xlsx`, `*.zip`, `JSON SIMAH/`). To *keep updating* the dashboards going
   forward on the new machine, you need to supply fresh data files yourself
   — cloning the repo does not bring any pipeline data with it.

---

## 1. Prerequisites

- **Node.js** (v18+, matches what built the existing dashboards — check with `node -v`)
- **git**
- **GitHub CLI (`gh`)** — optional, only needed if you want to check
  GitHub Pages build status the way this session did (`gh api
  repos/<owner>/<repo>/pages/builds/latest`)
- A GitHub account with push access to whichever repo you point this at
  (either the existing `Eayyash/CashFunnel` repo, or your own fork/copy if
  you want a fully independent instance)

## 2. Clone and install

```bash
git clone https://github.com/Eayyash/CashFunnel.git
cd CashFunnel
```

`package.json` is **not** committed (it's in `.gitignore` too, unusually).
Recreate it before installing:

```bash
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
npm install
```

## 3. ⚠️ Hardcoded paths you MUST update

A number of scripts and the three agent instruction files hardcode this
project's original absolute paths (`C:\Users\Emad.Ayyash\...`). On a new
machine, under a different Windows username or OS, these need to change or
the pipeline will silently look in the wrong place (or error out).

**Search for every occurrence before running anything:**

```bash
grep -rn "Emad.Ayyash" scripts/*.js .claude/agents/*.md
```

As of this writing, that's:

| File | What it hardcodes |
|---|---|
| `scripts/merge_csv.js` | `ARCHIVE_DIR` — where processed `Acquisition_for_Loans_*.csv` files get moved after merging |
| `scripts/build_coconut_matches.js`, `build_coconut_v2.js`, `build_ucfs_company_compare.js`, `compute_full_booked_competitor_stats.js`, `convert_simah_jsonl_to_daily_csv.js` | `ARCHIVE_DIR` — the SIMAH Qarar JSON archive folder |
| `scripts/update_funnel.js` | `DOWNLOADS` — where it checks for newly dropped `Tawarruq_Funnel_*.xlsx` files |
| `.claude/agents/FunnelBA.md` | Documents the Acquisition archive folder path (twice) |
| `.claude/agents/DailyBA.md` | Documents the Downloads path + Tawarruq Funnel archive folder path |
| `.claude/agents/SIMAHDaily.md` | Documents the Downloads path + SIMAH Qarar JSON archive folder path |

Decide on your new machine's equivalent folder structure (see section 4),
then update each of the above — either a straight find-and-replace of the
old base path, or point them at wherever you keep archived source files.

## 4. Recreate the folder structure

Outside the repo itself, on the original machine, three sibling folders
hold every processed source file (so nothing pipeline-relevant gets lost,
and reprocessing a file twice is easy to catch — see the "Known incident"
notes in the agent `.md` files for why this matters):

```
<AI-Work>/
  Acquisition for Loans/     <- merge_csv.js archives processed daily CSVs here
  Tawarruq Funnel/           <- update_funnel.js archives processed xlsx here
  SIMAH Qarar JSON/          <- update_simah_from_qarar_csv.js + build_simah_datechunks.js archive here
Analysis Agent/              <- this repo (project root)
```

Create the equivalent on the new machine, and update the hardcoded paths
from section 3 to point at them. Also confirm where new daily files will
actually land for you (this project assumed `Downloads`) — adjust the
`DOWNLOADS` constants and the agent `.md` "Find every new file" steps to
match your own workflow.

## 5. Seed the historical data (not in git)

The full pipeline needs a starting dataset to merge new daily files into.
On the original machine these live as three cumulative monthly snapshots,
referenced by name in `scripts/merge_csv.js`'s `HISTORICAL` array:

```bash
grep -A5 "^const HISTORICAL" scripts/merge_csv.js
```

Copy these three files (and the equivalent SIMAH/Funnel starting data, if
you're also replicating those pipelines) from the original machine into
the new repo's project root — they are **not** retrievable from git. If you
don't have access to the original files, you'll need to get a fresh full
export from source and treat it as day one (`Acquisition_for_Loans_all_merged.csv`
will simply start smaller and grow from there).

Without these, `merge_csv.js` will warn "fewer than 500K rows" (or refuse
to run for lack of any base file at all).

## 6. Running the pipelines

This project doesn't have one single "run everything" entry point — each
data source is its own agent, invoked when a new file arrives. On this
machine (Claude Code), that's done by referencing the relevant `.claude/agents/*.md`
file when a new file shows up; the instructions inside are self-contained
enough to follow manually too if you're not using an agent-capable tool on
the new machine.

| Agent | Triggered by | What it updates |
|---|---|---|
| **FunnelBA** | New `Acquisition_for_Loans_*.csv`/`.xlsx` | `Acquisition_Command_Dashboard.html`, `Application_Cost.html`, `SNB_Overview.html` (step 3b — see FunnelBA.md), `Business_Performance_View.html` |
| **DailyBA** | New `Tawarruq_Funnel_*.xlsx` | `Funnel_Analysis.html`, `Business_Performance_View.html` |
| **SIMAHDaily** | New `SIMAH_Qarar_JSON_*.csv` | `SIMAH_Intelligence.html`, per-date chunk files in `simah_data/`, `Business_Performance_View.html` |

Read each `.claude/agents/*.md` file in full before running anything by
hand — they document real incidents (OOM thresholds, silent data-loss bugs
already fixed, additive-vs-idempotent merge semantics) that matter for
correctness, not just convenience.

**Quick manual smoke test** once paths are fixed and historical data is in
place:

```bash
node --max-old-space-size=8192 scripts/merge_csv.js
node --max-old-space-size=16384 scripts/update_acquisition_dashboard.js Acquisition_for_Loans_all_merged.csv
node --max-old-space-size=16384 scripts/build_snb_overview.js
node --max-old-space-size=4096 scripts/update_bpv.js
```

Then open `Acquisition_Command_Dashboard.html` (and the others) directly
in a browser, or serve the folder locally:

```bash
npx http-server . -p 8091 -c-1
# then browse http://localhost:8091/index.html
```

## 7. GitHub Pages hosting (optional)

If you want the new machine's copy independently hosted the same way
(`https://<you>.github.io/<repo>/`):

1. Push to your own repo (fork, or a fresh empty repo — either works, this
   project has no server-side dependencies, it's static HTML).
2. In that repo's Settings → Pages, set the source to the `master` branch,
   root folder.
3. Note: several dashboards here are 50–90MB (embedded gzip'd data blobs).
   GitHub will warn about files over 50MB on push — that's expected and
   harmless (confirmed working in production for this exact repo), not a
   hard block, unless you're on a plan/host with a hard size cap.

## 8. Verifying you're not silently corrupting data

A few hard-won lessons baked into this pipeline, worth knowing before you
touch anything (full detail in each agent `.md`'s "Known incident" /
"Error handling" sections):

- **SIMAH's merge is additive, not idempotent.** Never re-run the same
  `SIMAH_Qarar_JSON_*.csv` through `update_simah_from_qarar_csv.js` twice —
  it double-counts. The script auto-archives (moves) each file after a
  successful run specifically to prevent this.
- **`merge_csv.js` must always be able to see every file it has ever
  archived**, not just what's currently in the project root — its output
  is rebuilt from scratch every run, with no other memory of the past.
- **Always verify a `git push` actually landed** — compare `git log -1`
  against `git log origin/master -1` rather than trusting a "completed"
  status alone; this repo's large files have occasionally made a push
  silently fail on a slow connection.
- **Syntax-check every HTML file after any script touches it** before
  committing:
  ```bash
  node -e "
  const fs=require('fs');
  const html=fs.readFileSync('FILE.html','utf8');
  const scripts=[...html.matchAll(/<script>([\s\S]*?)<\/script>/g)];
  scripts.forEach((s,i)=>{ try{ new Function(s[1]); }catch(e){ console.log('BLOCK',i,'SYNTAX ERROR:',e.message); } });
  console.log('syntax check done,', scripts.length, 'blocks');
  "
  ```
