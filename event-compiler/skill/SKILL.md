---
name: western-club-events
description: Compile upcoming Western University (UWO) events and opportunities — club/Instagram events plus official Western, USC, Ivey, Gazette, Mustangs, Campus Rec and Careers sources — and record the findings as a structured JSON file with a diff against the previous run. Use when asked to gather/refresh Western club events, recruitment dates, campus events, or a "club watchlist" / "igchecker" run.
metadata:
  type: reference
---

# Western (UWO) Event & Opportunity Checker

Purpose: sweep a fixed registry of **Instagram accounts** and **public web sources** for
upcoming Western University (London, Ontario) events, recruitment deadlines, and
opportunities; compile them into `western_club_findings.json`; and report **what changed
since the last run**. Built for a first-year BMOS student with Ivey AEO status.

Scope is deliberately wider than Instagram: the web sources below carry things that never
appear on club Instagram at all (employer info sessions, career fairs, varsity schedules,
intramural registration deadlines, academic dates, accelerator application windows).

## Two lanes — read this first

**Lane A is the primary source.** The majority of Western club information — dated events,
info nights, coffee chats, application posts and their deadlines — exists **only** on
Instagram post graphics and nowhere on the public web. A run that skips Lane A is a
degraded run, not a normal one. Lane B is the essential complement, not a replacement.

**Lane A — Instagram (primary; the dated club events).** Instagram is login-gated: a
logged-out browser hits a login wall on every profile, so captions, stories, and event
graphics are unreadable without a session. The method, unchanged from previous runs:

- Use the user's **already-signed-in Chrome session** via the `mcp__claude-in-chrome__*`
  tools. This is the supported path and it is expected to work on every run.
- **Never enter the user's credentials**, and never ask for them. If a login wall appears,
  the session has lapsed — ask the user to sign in themselves in the Chrome tab.
- Read each profile grid by navigating to the handle, waiting, scrolling, and screenshotting.
  `browser_batch` (navigate + wait + scroll + screenshot) is fastest. Transcribe dates,
  times, venues and signup instructions off the post graphics.
- Expect rate limiting. Sweep highest tier first so a cut-off costs the least. On a
  rate-limit, back off and record `lane_a_status: "partial — rate limited"` plus which
  handles went unread, so the next run can start there.
- Stories are ephemeral and usually not capturable — grid posts are the reliable surface.
- If the session is not signed in on a **scheduled** run: complete Lane B, set
  `lane_a_status: "skipped — not signed in"`, and **lead the report with that fact** so the
  user knows the run was degraded and can sign in before the next one. Do not treat a
  Lane-B-only run as a normal result.

**Lane B — Public web (always available).** Official calendars, club sites, directories, and
news. No login. Carries the hard deadlines Instagram never publishes (career fairs, employer
info sessions, intramural registration, accelerator windows, academic dates).

## Read-only rule (non-negotiable)

This tool **observes; it never acts on the user's account.** While browsing Instagram, do not
click Follow, Request, Like, Save, comment, DM, or reply to a story, and do not accept or send
anything. Do not follow accounts the user is not already following — merely *note* them in
`not_yet_followed_by_user` so the user can decide. The only permitted interactions are
navigating, waiting, scrolling, and screenshotting. The same applies to Lane B: read pages,
never submit forms, register, or apply on the user's behalf.

## Honest framing for the output

Club recruitment dates (info nights, coffee chats, application deadlines) are released on
Instagram in **late August / September**. O-Week and Clubs Week official dates are often not
posted until close to the date. Never present a search-suggested or prior-year date as the
current-year official date — set `confirmed: false` / `status: "unconfirmed"` and record the
reference year separately. Eligibility ("open to first-years") is rarely published; treat the
tier labels below as priors, not facts, and confirm from the actual application post.

## Process

1. **Load the previous run.** Read `./western_club_findings.json` if it exists; keep it in
   memory as `previous` for the diff in step 6. If absent, this is a first run.
2. **Verify anchor dates** from official Western sources (beware search contamination:
   "USC" also means University of Southern California):
   - O-Week: `oweek.ca` (and `/general-schedule/`). If the page shows "updating", record
     `status: "unconfirmed"` plus the prior-year reference. Never hardcode a year here.
   - USC Clubs Week: `westernusc.ca/clubsweek` + `clubsweek.ca` + `club-spotlight.ca` +
     `@clubsusc`. Mid-to-late September in the UCC. Record the registration-link-drop date
     if posted; flag exact dates unconfirmed if not.
3. **Sweep Lane A first** — the handles in the *Instagram registry* tables, highest tier
   first, so a rate-limit cut-off loses the least important accounts. This is where most of
   the dated events come from, so give it the bulk of the run. Read-only (see rule above).
4. **Sweep Lane B** — every source in the *Web source registry* table, respecting its
   cadence column. Extract dated items only; ignore evergreen page copy.
5. **Compile** into the JSON schema below. Classify every dated event as upcoming vs.
   recently-passed relative to today. Capture recruitment signals (co-recruiting clubs,
   historical close dates).
6. **Diff against `previous`** and fill `changes_since_last_run`: new events, events whose
   date/detail changed, events that moved from upcoming to passed, and newly-confirmed
   anchor dates. This is the part the user actually reads on a recurring run.
7. **Write** `./western_club_findings.json` (Write tool, exact schema below). This replaces
   any Gmail-draft output — do **not** create an email unless explicitly asked.
8. **Report**: the file path, the diff, what's confirmed vs. "watch for", and any handles the
   user does not yet follow. On a scheduled run where nothing changed, say so in one line.

## Output JSON schema (write this exact shape)

Store at `./western_club_findings.json`.

```json
{
  "meta": {
    "title": "Western Event & Club Digest",
    "student_profile": "First-year BMOS student with Ivey AEO status",
    "as_of": "YYYY-MM-DD",
    "generated": "YYYY-MM-DD",
    "run_type": "manual | scheduled",
    "lane_a_status": "read | skipped — not signed in | partial — rate limited",
    "lane_b_sources_checked": ["events.westernu.ca", "..."],
    "timezone": "America/Toronto (ET)",
    "notes": ["source caveats, e.g. stories not captured, dates read from post graphics"]
  },
  "for_you": "1-2 sentence orientation callout for the student.",
  "changes_since_last_run": {
    "previous_run": "YYYY-MM-DD or null",
    "new_events": [ { "date": "...", "club": "...", "title": "...", "source": "..." } ],
    "changed_events": [ { "title": "...", "was": "...", "now": "..." } ],
    "now_passed": ["title (date)"],
    "newly_confirmed": ["e.g. Clubs Week dates confirmed as Sept 21-25"],
    "nothing_changed": false
  },
  "anchor_dates": {
    "o_week": {
      "status": "confirmed | unconfirmed",
      "official_source": "oweek.ca ...",
      "reference_prior_year": "prior-year dates",
      "search_suggested": "date (NOT verified) or null",
      "contact": "orientation@uwo.ca"
    },
    "usc_clubs_week": {
      "status": "confirmed | unconfirmed",
      "official_source": "westernusc.ca/clubsweek ...",
      "registration_link_drops": "YYYY-MM-DD or null",
      "reference_prior_year": "prior-year dates",
      "search_suggested": "date (NOT verified) or null",
      "location": "UCC Building + online; 220+ clubs",
      "contact": "clubs@westernusc.ca",
      "note": "why it matters for a first-year"
    },
    "academic_dates": { "term_start": "...", "add_drop": "...", "reading_week": "...", "source": "uwo.ca/univsec/pdf/academic_policies/" }
  },
  "upcoming_events": [
    {
      "date": "YYYY-MM-DD",
      "time": "HH:MM-HH:MM ET (optional)",
      "club": "SHORT",
      "handle": "@handle (optional if web-sourced)",
      "title": "event name",
      "category": "recruitment | networking | conference | career | campus | athletics | rec | academic | social",
      "location": "venue/address (optional)",
      "detail": "price, signup, who it's for (optional)",
      "signup": "link-in-bio / URL / deadline (optional)",
      "source": "instagram | events.westernu.ca | career.uwo.ca | ... (required)",
      "eligibility": "open to all Western | HBA-only | unknown",
      "confirmed": true
    }
  ],
  "recently_passed_events": [
    {
      "date": "YYYY-MM-DD",
      "club": "SHORT (or clubs: [] + handles: [] for co-hosted)",
      "handle": "@handle",
      "title": "event name",
      "source": "...",
      "signal": "optional — what this implies for recruitment"
    }
  ],
  "deadlines": [
    { "date": "YYYY-MM-DD", "what": "application/registration name", "org": "SHORT", "source": "...", "confirmed": true }
  ],
  "recruitment_signals": [
    { "club": "SHORT", "signal": "e.g. consultant apps close ~late Sept" }
  ],
  "clubs": [
    {
      "short": "PBSN",
      "name": "Pre-Business Students' Network",
      "tier": 1,
      "category": "Pre-business umbrella (many AEOs) — TOP PICK",
      "instagram": "@pbsnuwo",
      "website": "pbsn.ca",
      "ig_stats": "posts/followers (optional)",
      "profile": "what it is / what it runs",
      "first_year_entry": "how a first-year actually gets in",
      "eligibility": "open to all Western | HBA-only | unknown — ask",
      "typical_recruitment": "Early-to-mid September",
      "user_follows": true
    }
  ],
  "accounts_monitored": {
    "finance_capital_markets": ["@westerncapitalmarkets", "..."],
    "consulting": ["..."],
    "entrepreneurship_tech": ["..."],
    "ivey_bmos": ["..."],
    "campus_life": ["..."],
    "not_yet_followed_by_user": ["..."],
    "unverified_handles": ["handles that could not be confirmed this run"]
  },
  "web_sources_monitored": [
    { "name": "Western Events Calendar", "url": "events.westernu.ca", "unique_value": "what it gives that IG does not", "last_checked": "YYYY-MM-DD" }
  ],
  "action_checklist": ["imperative to-dos with dates"]
}
```

---

## Instagram registry

Tiers are **eligibility priors for a first-year**, not importance. Sweep Tier 1 → Tier 4.

### Tier 1 — Confirmed / likely first-year intake (the core September list)

| Club | Full name | Category | Instagram | Website | First-year entry point |
|---|---|---|---|---|---|
| PBSN | Pre-Business Students' Network | Pre-business umbrella (many AEOs) — **top pick** | @pbsnuwo | pbsn.ca | First-year programming + project teams |
| WCM | Western Capital Markets | Finance / capital markets — **largest finance club (380+)** | @westerncapitalmarkets | westerncapitalmarkets.com | Peer mentorship program; seminars; NYC/London/SF trips |
| WIC | Western Investment Club | Value investing, ~$350K real equities portfolio | @westerninvestmentclub | westerninvestmentclub.ca | **Analyst** (fall, competitive) or **Researcher** (open to ~January) |
| WREC | Western Real Estate Club | Real estate — explicitly all-Western | @westernrealestateclub | linktr.ee/westernrealestateclub | Analyst Program |
| W5 | Western Entrepreneur Association | Entrepreneurship (largest on campus) | @w5uwo | w5entrepreneurs.com | Ideation accelerator, Summit, community tier |
| WFN | Western Founders Network | Tech/business, 600+ members | @westernfoundersnetwork | foundersnetwork.ca | TCC, Future View, Product Design Sprint teams |
| 180DC | 180 Degrees Consulting Western | Social-impact / pro-bono consulting | @180dcwestern | 180dc.org/branches/Western-Ontario | Junior consultant / analyst intake; global policy is open to any year |
| WMC | Western Management Consulting | Pro-bono strategy consulting | @wmcconsulting | — | Consultant apps (closed ~Sept 22 last cycle) |
| Aleph | The Aleph Group | Consulting (tech/startup, real clients) | @thealephgroup | thealephgroup.ca | Fall analyst/consultant intake |
| WAI | Western AI | AI/tech community (2,000+) | @westernu.ai | — | Open community + Discord |
| WATC | Western Algorithmic Trading Club | Quant / markets — ML, valuation, crypto divisions | — *(verify)* | westernalgo.com | Analyst roles; "all faculties regardless of coding proficiency" |

### Tier 2 — "Looks closed, isn't" (Ivey-branded, Western-wide programs)

| Club | Instagram | Website | Note |
|---|---|---|---|
| Ivey Private Capital | @iveyprivatecapital | linkedin.com/company/ivey-private-capital | **Analyst & Associate program**, pro-bono work in PE/VC/real estate/credit. "All Western and Ivey students are welcome" at program overview sessions. The flagship example of this tier. |
| IVCC — Ivey Venture Capital Club | @iveyventurecapital | iveyventurecapitalclub.com | Mission is VC education "as accessible as possible"; 35+ VC firm relationships; VC Bootcamp. Recruits outward. |
| IAMC — Ivey Asset Management Club | — *(verify)* | iveyassetmanagement.com | Largest buy-side finance org. Non-Ivey eligibility genuinely **ambiguous** — email iveyamc@gmail.com in early September rather than assume. |
| Ivey Real Estate / Sales & Trading / Fintech / Technology Club | — *(verify)* | iveyhbaa.com/clubs | Nominally HBA-only, but run public speaker events, firm trips, job boards. Attend for relationships even without a role. |

### Tier 3 — Open membership, no gate

| Club | Instagram | Note |
|---|---|---|
| Ivey Finance Club | @iveyfinanceclub | Ivey HBA finance community; public speaker events |
| Ivey Consulting Club | @iveyconsultingclub | iveyconsultingclub.com; casebook + public sessions |
| Western Women in Leadership | @wwomeninleadership | Closest active analogue to a "Women in Finance" org at Western (2,700+) |
| Empower UWO | — *(verify; clubsweek.ca/empower-uwo)* | Women-focused community initiative |
| Morrissette Entrepreneurship | @morrissette.entrepreneurship | Official Western accelerator/Propel programming — see web registry |
| Others (sweep opportunistically) | — | Western Accounting Association · Western Marketing Association · DECA Western · Western Sport Business Club · Enactus Western · Hack Western · Women in Tech Society · ACE Western · Sports Analytics Club |

### Tier 4 — Closed until HBA1 (don't burn September on these)

Ivey Business Review (explicitly "exclusively Ivey HBA and MBA students") · Community
Consulting Project · Ivey Accounting Club · IIBC (@ivey.iibc) · Ivey Case Competition Club ·
rest of the HBAA roster · Ivey Mustangs Network (requires a year of varsity sport).

### Campus-wide & official accounts (always sweep)

| Account | Instagram | Why |
|---|---|---|
| Western University | @westernuniversity | Main institutional account |
| Western USC | @westernusc | Elections, campus policy, O-Week |
| USC Events | @westernusc_events | Concerts, festivals, large campus events |
| USC Clubs | @clubsusc | Clubs Week + directory |
| Western Gazette | @westerngazette *(also @westerngazettedocs)* | Student paper — **best single account for what's actually happening** |
| Western Mustangs | @westernmustangs | Varsity schedules, Homecoming |
| Western Recreation | @western_rec | Campus rec, club sports (relevant: BJJ, skiing) |
| Western Intramurals | @westernims | Intramural leagues + registration |
| Ivey Business School | @iveybusiness | AEO news, HBA timelines |
| Ivey HBAA | @iveyhbaa | Ivey undergrad student council |
| DMSA | @dmsawestern | DAN Management Students' Association — **the user's actual faculty council for years 1–2** |
| DAN Management (dept) | @westernudan | Official department account |

**Unverified handles** — confirm during the first run and update this file: Western
Algorithmic Trading Club, IAMC, Empower UWO, Ivey Real Estate / Sales & Trading / Fintech /
Technology, and any "Western Consulting Group" account (searches surface unrelated
engineering firms; **WMC is the real Western consulting club** — do not add a look-alike).
There is no dedicated "Western Women in Finance" account at UWO; @wwomeninleadership is the
closest active equivalent.

---

## Web source registry

These carry what Instagram does not. Each row states its unique value — that is the test for
keeping it in the sweep.

| Source | URL | Unique value (not on Instagram) | Cadence |
|---|---|---|---|
| Western Events Calendar | uwo.ca/events | Official campus-wide calendar, filterable by type/audience/department; lectures, wellness, sustainability. *(`events.westernu.ca` refuses connections — use `uwo.ca/events`.)* | every run |
| Western Connect — Events | connect.uwo.ca/events/EventList.htm | The system of record for **employer info sessions** and registration | every run |
| Career Education — Events & Workshops | career.uwo.ca/take_action/events_workshops | Career prep workshops, résumé/interview sessions | every run |
| hirewesternu Career Fair | hirewesternu.ca/hire_western_talent/recruiting_at_western/career_fair.html | Career fair dates + employer lists — never posted by clubs. *(The `career.uwo.ca/take_action/hirewesternu_fairs` path 404s.)* | every run |
| Employer Information Sessions | career.uwo.ca/take_action/information_sessions | Sept–April, Mon–Thu; firm-specific recruiting sessions | every run |
| USC | westernusc.ca (+ /clubsweek) | Official Clubs Week logistics, USC governance, elections | every run |
| Clubs Week directory | clubsweek.ca | Per-club Clubs Week pages + booth info | Aug–Oct |
| Clubs Spotlight | club-spotlight.ca | Full USC clubs directory — use to discover clubs not yet in the registry | monthly |
| Western Link | westernlink.ca | Student-org platform; org pages and event postings | every run |
| O-Week | oweek.ca (+ /general-schedule) | Official O-Week schedule | Aug–Sept |
| Western News | news.westernu.ca | Institutional announcements, new programs, policy | every run |
| Western Gazette | westerngazette.ca | Student journalism — context and coverage IG posts omit | every run |
| Western Mustangs | westernmustangs.ca | Full varsity schedule + Homecoming | every run |
| Campus Recreation | uwo.ca/campusrec (+ /intramurals) | **Intramural + club-sport registration deadlines** (BJJ, ski) — hard deadlines, not on IG | every run |
| Ivey HBA events | ivey.uwo.ca/hba/events | Official AEO/HBA timelines and events | every run |
| Ivey HBAA clubs directory | iveyhbaa.com/clubs | Authoritative roster + eligibility language for Ivey clubs | monthly |
| Morrissette Entrepreneurship | entrepreneurship.uwo.ca (+ /for-students/clubs) | **Accelerator/Propel application windows** and the entrepreneurial-clubs directory | every run |
| Academic sessional dates | westerncalendar.uwo.ca/SessionalDates.cfm | Term start, add/drop, reading week — constrains everything else. Authoritative. *(The `uwo.ca/univsec/pdf/academic_policies/` PDFs 404 — do not use them.)* | monthly |
| Registrar — Important Dates | registrar.uwo.ca/resources/important_dates_and_deadlines.html | Fee deadlines, withdrawal dates, exam periods | monthly |
| Club sites | westerncapitalmarkets.com · westerninvestmentclub.ca · foundersnetwork.ca · w5entrepreneurs.com · thealephgroup.ca · westernalgo.com · iveyventurecapitalclub.com · dmsawestern.com | Application forms and deadlines often live here before the IG post | every run |

---

## Scheduled-run mode

When invoked by a schedule (every other day) rather than by hand:

- Set `meta.run_type: "scheduled"`.
- Do **not** prompt the user or wait for input. Attempt Lane A normally through the existing
  Chrome session — it is the primary source and should be tried every time. If the session
  has lapsed, skip it, record `lane_a_status`, and surface that at the top of the report;
  never enter credentials and never block waiting for a login.
- Always complete Lane B.
- Stay read-only throughout: no follows, likes, comments, DMs, registrations, or form
  submissions (see *Read-only rule*).
- Overwrite `western_club_findings.json` in place, but only after computing the diff against
  the old contents.
- Lead the report with `changes_since_last_run`. If nothing changed, say exactly that in one
  line and stop — do not restate the whole digest.
- Escalate anything time-critical: a deadline inside the next 4 days, a newly-confirmed
  O-Week / Clubs Week date, or a first-year application post going live.

## Action checklist to include in every run

These are **suggestions written into the JSON for the user to act on** — the tool never
performs them itself.

- Suggest the user follow the Tier 1 + campus-wide handles they're missing, and enable post +
  story notifications for their top 2–3. Do not follow anything on their behalf.
- While browsing, observe the "Following" vs "Follow" button state and list the not-yet-
  followed handles in `not_yet_followed_by_user`. Observe only — never click it.
- Block off Clubs Week (mid-to-late Sept); visit UCC booths, grab QR codes / mailing lists.
- Watch for "First-Year" / "Analyst" application posts in September (apps often close late
  Sept–early Oct).
- Email iveyamc@gmail.com in early September to settle IAMC eligibility.
- Register for intramurals / club sports before the Campus Rec deadline.
- Re-check each Tier 1 club's IG in the first two weeks of September for exact dates.

## Reuse notes

- To refresh for a new term, re-run steps 1–8; the registries rarely change.
- When a handle in *unverified* is confirmed (or found not to exist), **update this file**.
- Add a club to the registry only with its tier and eligibility; add a web source only if it
  passes the "unique value" test in the table above.
- Output is a JSON file, not an email. Build a styled digest only if asked — and generate it
  from the same JSON.
