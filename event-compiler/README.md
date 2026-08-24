# Event Compiler

A scheduled agent that sweeps a fixed registry of Instagram club accounts and
official university web sources for dated events, deadlines and recruitment
opportunities, compiles them into structured JSON, and reports **what changed
since the last run**.

It is built for Western University (UWO) in London, Ontario, but the design is
generic: a registry of sources, a two-lane sweep, a strict output schema, and a
diff. Swap the registry and it becomes an event compiler for anywhere.

The output is what the [dashboard](../dashboard/) renders in its Western Club
Digest card.

## Why this exists

Most Western club information — info nights, coffee chats, application posts
and their deadlines — is published **only as text baked into Instagram post
graphics**, and Instagram is login-gated. It is not in any calendar, feed or
API. Meanwhile the hard institutional deadlines (career fairs, employer info
sessions, intramural registration, accelerator windows, academic dates) are on
the public web but scattered across two dozen sites.

Neither source alone gives you a calendar. This compiles both into one.

## How it works

The compiler is a [Claude Code skill](skill/SKILL.md) — a document that tells
the agent what to read, how to read it, and exactly what shape to write. There
is no scraper to break: the reading is done by an LLM driving a real browser and
reading rendered pages and post graphics.

**Lane A — Instagram (primary).** Drives the user's *already-signed-in* Chrome
session through the Claude-in-Chrome tools: navigate to a handle, wait, scroll,
screenshot, transcribe the dates and venues off the post graphics. Handles are
swept highest-tier-first so that a rate-limit cut-off costs the least.

**Lane B — Public web (always available).** ~20 official sources — the Western
events calendar, Western Connect, Career Education, hirewesternu, USC and Clubs
Week, O-Week, Western News, the Gazette, Mustangs, Campus Rec, Ivey HBA,
Morrissette, academic sessional dates, and individual club sites — each with a
cadence and a documented "unique value" that justifies its place in the list.

Both lanes feed one JSON file, which is diffed against the previous run before
being overwritten.

### Read-only, by construction

The compiler **observes; it never acts on the account.** No follows, likes,
comments, DMs, saves, registrations, or form submissions. The only permitted
browser interactions are navigate, wait, scroll and screenshot. Accounts worth
following are *noted* in `not_yet_followed_by_user` for the user to decide on.

This is enforced in three places: the rule in the skill, the explicit
per-run instruction in `run_igchecker.ps1`, and a tool allowlist that withholds
`Bash` and `PowerShell` from the scheduled run entirely.

Credentials are never entered and never requested. If the Chrome session has
lapsed, Lane A is skipped, `lane_a_status` records why, and the report leads
with the fact that the run was degraded.

## Setup

1. Install [Claude Code](https://claude.com/claude-code) and its Chrome
   extension, and sign in to Instagram in that Chrome profile.
2. Install the skill so Claude Code can find it:

   ```powershell
   Copy-Item -Recurse skill "$env:USERPROFILE\.claude\skills\western-club-events"
   ```

   (Or symlink it, so edits to the repo take effect immediately.)
3. Register the scheduled task — every 2 days at 08:47, in the logged-on
   desktop session so Chrome is reachable:

   ```powershell
   powershell -ExecutionPolicy Bypass -File .\setup_igchecker_task.ps1
   ```

Run it once by hand first, to confirm the Chrome session works:

```powershell
powershell -ExecutionPolicy Bypass -File .\run_igchecker.ps1
```

Or invoke the skill directly in an interactive Claude Code session with
`/western-club-events`.

### Managing the task

```powershell
Get-ScheduledTaskInfo -TaskName 'IGChecker - Western Events'   # last/next run + result
Start-ScheduledTask   -TaskName 'IGChecker - Western Events'   # run now
Disable-ScheduledTask -TaskName 'IGChecker - Western Events'
Unregister-ScheduledTask -TaskName 'IGChecker - Western Events' -Confirm:$false
```

Each run writes `logs\igchecker-<timestamp>.log`; the 20 most recent are kept.

## Output

`western_club_findings.json`, written next to the scripts. It is regenerated on
every run, so it is git-ignored — [`sample-findings.json`](sample-findings.json)
is a trimmed copy showing the shape.

| Section | Contents |
| --- | --- |
| `meta` | Run date, `run_type`, `lane_a_status`, handles read, web sources checked, caveats |
| `for_you` | One or two sentences orienting the reader on this run |
| `changes_since_last_run` | New events, changed events, newly-passed, newly-confirmed dates |
| `anchor_dates` | O-Week, Clubs Week, Homecoming, academic dates — each with `confirmed` |
| `upcoming_events` / `recently_passed_events` | Dated items with time, venue, signup route, source |
| `deadlines` | Hard dates, separated out so nothing is missed |
| `recruitment_signals` | Soft evidence about when a club's intake is likely to open |
| `clubs` | The registry as resolved this run — tier, category, handle, site, entry point |
| `accounts_monitored` | Handles by category, plus `not_yet_followed_by_user` and unverified handles |
| `web_sources_monitored` | Each Lane B source with its unique value and last-checked date |
| `action_checklist` | Suggestions for the reader — the tool never performs them |

`changes_since_last_run` is the part that matters on a recurring run. When
nothing has changed, the run says so in one line and stops.

### Honesty rules in the schema

Club recruitment dates are released in late August and September, and O-Week /
Clubs Week dates are often not published until close to the date. A
search-suggested or prior-year date is **never** presented as this year's
official date — it is recorded with `confirmed: false` and the reference year
kept separately. Eligibility ("open to first-years") is rarely published, so
the registry's tier labels are documented as priors, not facts.

## Adapting it to another school

Everything school-specific lives in [`skill/SKILL.md`](skill/SKILL.md), in two
tables:

- **Instagram registry** — handles grouped into tiers by how open their intake
  is, plus the always-sweep institutional accounts.
- **Web source registry** — each source with a URL, a cadence, and the "unique
  value" test: what does this carry that Instagram does not? A source that
  fails that test does not belong in the table.

Replace both tables, adjust the anchor dates in the process section, and the
rest of the machinery — the two lanes, the read-only rule, the schema, the diff,
the scheduled-run behavior — carries over unchanged.

## Files

| File | Purpose |
| --- | --- |
| `skill/SKILL.md` | The compiler: registries, method, output schema, run modes |
| `run_igchecker.ps1` | Scheduled-run wrapper — builds the prompt, sets the tool allowlist, logs, rotates logs |
| `setup_igchecker_task.ps1` | Registers/updates the Windows scheduled task |
| `sample-findings.json` | Trimmed example of the output |
