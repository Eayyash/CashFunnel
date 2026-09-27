# Running the Dashboard Agents on a New Machine

Ready-to-run prompts for all five daily-update agents (`FunnelBA`, `DailyBA`,
`SIMAHDaily`, `SMSDaily`, `SNBReferralDaily`). Run these from inside the
project root (`cd` into wherever you cloned the repo on the new machine) —
Claude Code auto-loads `.claude/agents/*.md` when you reference them.

## One-time setup (only needed once, before any agent will run)

Run **[`NEW_MACHINE_SETUP.md`](NEW_MACHINE_SETUP.md)** first — it's a fully
automated script (clone, `npm install`, archive folders,
`pipeline.config.json`, dashboard verification) that needs no interactive
input at all. It replaces the old `node scripts/setup_config.js` prompt flow
and `REPLICATE_ON_NEW_MACHINE.md` (now deprecated).

---

## FunnelBA — new `Acquisition_for_Loans_*.csv`

Interactive (inside a `claude` session):
```
@.claude/agents/FunnelBA.md new Acquisition for Loans file is ready, please process it
```

Headless / scriptable:
```bash
claude -p "@.claude/agents/FunnelBA.md new Acquisition for Loans file is ready, please process it"
```

## DailyBA — new `Tawarruq_Funnel_*.xlsx`

Interactive:
```
@.claude/agents/DailyBA.md new Tawarruq Funnel file is ready, please process it
```

Headless:
```bash
claude -p "@.claude/agents/DailyBA.md new Tawarruq Funnel file is ready, please process it"
```

## SIMAHDaily — new `SIMAH_Qarar_JSON_*.csv`

Interactive:
```
@.claude/agents/SIMAHDaily.md new SIMAH Qarar JSON file is ready, please process it
```

Headless:
```bash
claude -p "@.claude/agents/SIMAHDaily.md new SIMAH Qarar JSON file is ready, please process it"
```

## SMSDaily — new `SMS_Campaign_*.xlsx`

Interactive:
```
@.claude/agents/SMSDaily.md new SMS Campaign file is ready, please process it
```

Headless:
```bash
claude -p "@.claude/agents/SMSDaily.md new SMS Campaign file is ready, please process it"
```

## SNBReferralDaily — new `SNB_Referral_*.csv`

Interactive:
```
@.claude/agents/SNBReferralDaily.md new SNB Referral file is ready, please process it
```

Headless:
```bash
claude -p "@.claude/agents/SNBReferralDaily.md new SNB Referral file is ready, please process it"
```

---

## Notes

- Each agent auto-discovers new files itself (from `downloadsDir`/the
  relevant archive folder in `pipeline.config.json`) — you don't need to name
  the file in the prompt, just drop it in Downloads first.
- The `claude -p "..."` form runs one-shot and exits (good for Task
  Scheduler / cron on the new machine) — it needs the `claude` CLI installed
  and already authenticated on that machine.
- Full replication details are in `NEW_MACHINE_SETUP.md`.
