const fs = require("fs");
const H = require("./build-plan.js");
const { d, key, sourceUrl, parseTime, addMin, subMin, EVENT_REMINDERS, DEADLINE_REMINDERS, TZ, TODAY, OUT } = H;

// Strip run-specific prose so the stable subject survives compiler re-runs.
function subjectOf(title) {
  let s = title;
  s = s.replace(/^(CLOSES TONIGHT|TOMORROW \d{1,2}:\d{2} [AP]M|DEADLINE|WATCH|VARSITY OPEN TRYOUTS|VARSITY TRYOUT ADMIN)\s*[—-]\s*/i, (m) => (/tryout/i.test(m) ? m : ""));
  s = s.replace(/\s*\((CONFIRMED THIS RUN|NEW THIS RUN|EARLIEST SITTING)\)/gi, "");
  s = s.replace(/\s*—\s*(VENUE CHANGED TO HARRIS PARK|CONFIRMED THIS RUN|NEW THIS RUN)/gi, "");
  s = s.replace(/\s*\(prior-year posts landed [^)]*\)/gi, "");
  s = s.replace(/^WATCH\s*[—-]\s*/i, "");
  return s.trim();
}

const { OVERRIDE, DEADLINE_ALIAS, FLAG_ONLY, cleanSubject } = require("./title-fixes.js");

const DEADLINE_RE = /DEADLINE|applications close|registration CLOSES|closes|add\/drop|withdraw|must be met/i;
const OPEN_RE = /OPENS|applications expected|program begins|reopens/i;

// Tier A = the user's four bullets (events/socials/info sessions, app opens,
// app closes, interview windows & scheduled rounds). Tier B = other
// date-bearing items (varsity games, academic calendar, campus logistics).
const TIER_A_CATS = new Set(["recruitment", "career", "networking", "social"]);
function tierOf(e) {
  if (TIER_A_CATS.has(e.category)) return "A";
  if (e.category === "campus" && /Clubs Week|Homecoming|Kick Off|Closing Ceremonies|Festival/i.test(e.title)) return "A";
  if (e.category === "rec" && /registration/i.test(e.title)) return "A";
  if (e.category === "athletics" && /TRYOUT/i.test(e.title)) return "A"; // scheduled rounds
  return "B";
}

// ---------------------------------------------------------- registry tiers --
// NOTE: this is NOT `tierOf` above. That returns the A/B urgency class. This is
// the watchlist tier 1-4 from the skill's registry (Tier 1 swept every run,
// Tiers 2-4 every third), which lives on findings.clubs[].tier -- on the
// ACCOUNT, not on the event. Events are matched back to it by their org label.
//
// Two different things were both called "tier", so keep the names distinct.
const ALLOWED_REGISTRY_TIERS = new Set([1, 2]);

const tierByOrg = new Map();
for (const c of d.clubs || []) {
  if (typeof c.tier !== "number") continue;
  if (c.short) tierByOrg.set(c.short, c.tier);
  if (c.name) tierByOrg.set(c.name, c.tier);
}

// Returns the registry tier for a row's org label, or undefined when the org is
// not on the club watchlist at all. Untiered is the COMMON case, not an edge
// case: employer info sessions, Mustangs fixtures, academic dates and USC
// campus events all arrive via Lane B, which has no tier concept. They are kept
// -- excluding them would silently empty most of the calendar.
function registryTierOf(org) {
  return tierByOrg.get(org);
}

function excludedByTier(org) {
  const t = registryTierOf(org);
  if (t === undefined) return false;
  return !ALLOWED_REGISTRY_TIERS.has(t);
}

const rows = [];
const seen = new Set();

function push(r) {
  if (seen.has(r.dashboard_id)) return;
  seen.add(r.dashboard_id);
  rows.push(r);
}

function buildDescription({ signup, detail, eligibility, contact, srcUrl, dashboard_id }) {
  const parts = [];
  if (signup) parts.push("Apply / sign up: " + signup);
  if (eligibility) parts.push("Eligibility: " + eligibility);
  if (detail) parts.push(detail);
  if (contact) parts.push("Contact: " + contact);
  parts.push("Source: " + (srcUrl || "n/a"));
  parts.push("dashboard_id: " + dashboard_id);
  return parts.join("\n\n");
}

// ---------- upcoming_events ----------
for (const e of d.upcoming_events) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(e.date)) continue;
  if (e.date < TODAY) continue;
  if (FLAG_ONLY.includes(e.date + "|" + e.club)) { rows.push({ SKIP: true, reason: "date not confirmed by source", raw: e }); continue; }

  let ov = OVERRIDE[`${e.date}|${e.club}`] || {};
  // An override carrying `match` applies only to the row whose title matches,
  // so a club with two items on one date does not get clobbered.
  if (ov.match && !ov.match.test(e.title)) ov = {};
  const subject = ov.subject || cleanSubject(e.club, subjectOf(e.title));
  const id = key(e.club, subject);
  const isDeadline = ov.kind ? ov.kind === "deadline" : (DEADLINE_RE.test(e.title) && !OPEN_RE.test(e.title));
  const t = parseTime(e.time);

  // Google treats an all-day event's end date as EXCLUSIVE, so a one-day event
  // needs end = start + 1; start === end is rejected outright. The multi-day
  // spanEnd values in title-fixes.js are already written exclusive (Clubs Week
  // runs Sept 14-18 and carries spanEnd 09-19), so only the derived
  // single-day ends need the bump.
  const nextDay = (ymd) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  };

  let start, end, allDay = false;
  if (ov.allDay) {
    allDay = true; start = e.date; end = ov.spanEnd || nextDay(e.date);
  } else if (t && t.end) {
    start = `${e.date}T${t.start}:00`; end = `${e.date}T${t.end}:00`;
  } else if (t) {
    // single stated time: deadlines end at it, openings start at it
    if (isDeadline) { start = `${e.date}T${subMin(t.start, 60)}:00`; end = `${e.date}T${t.start}:00`; }
    else { const dur = /Football/i.test(e.title) ? 180 : 60; start = `${e.date}T${t.start}:00`; end = `${e.date}T${addMin(t.start, dur)}:00`; }
  } else if (isDeadline) {
    start = `${e.date}T23:00:00`; end = `${e.date}T23:59:00`;
  } else {
    allDay = true; start = e.date; end = nextDay(e.date);
  }

  push({
    dashboard_id: id,
    tier: tierOf(e),
    kind: ov.kind || (isDeadline ? "deadline" : OPEN_RE.test(e.title) ? "open" : "event"),
    summary: `${e.club} - ${subject}`,
    date: e.date,
    allDay, start, end,
    location: e.location || (/virtual|VIRTUAL/.test(e.title + " " + (e.detail || "")) ? "Virtual" : null),
    description: buildDescription({
      signup: e.signup, detail: e.detail, eligibility: e.eligibility,
      srcUrl: sourceUrl(e.source, e.handle), dashboard_id: id,
    }),
    reminders: isDeadline ? DEADLINE_REMINDERS : EVENT_REMINDERS,
    confirmed: e.confirmed !== false,
    category: e.category,
    origin: "upcoming_events",
  });
}

// ---------- deadlines (only those not already represented) ----------
for (const dl of d.deadlines) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dl.date)) {
    rows.push({ SKIP: true, reason: "no resolvable date", raw: dl });
    continue;
  }
  if (dl.date < TODAY) continue;
  if (FLAG_ONLY.includes(dl.date + "|" + dl.org)) { rows.push({ SKIP: true, reason: "date not confirmed by source", raw: dl }); continue; }
  const alias = DEADLINE_ALIAS[dl.date + "|" + dl.org];
  if (alias) { const [ad, ac] = alias.split("|"); const ovv = OVERRIDE[alias] || {}; const asub = ovv.subject; if (rows.some(r => !r.SKIP && r.date === ad && (asub ? r.summary === ac + " - " + asub : r.summary.startsWith(ac + " -")))) continue; }
  const ovd = OVERRIDE[dl.date + "|" + dl.org] || {};
  const subject = ovd.subject || cleanSubject(dl.org, dl.what.split(/[.(]/)[0].replace(/\s*—.*$/, "").trim());
  const id = key(dl.org, subject);
  if (seen.has(id)) continue;

  // suppress if an upcoming_event on the same date already covers this org
  const dup = rows.find((r) => !r.SKIP && r.date === dl.date && r.summary.startsWith(dl.org + " -"));
  if (dup) continue;

  push({
    dashboard_id: id,
    tier: /application|registration|ratification|standards/i.test(dl.what) ? "A" : "B",
    kind: "deadline",
    summary: `${dl.org} - ${subject}`,
    date: dl.date,
    allDay: false,
    start: `${dl.date}T23:00:00`,
    end: `${dl.date}T23:59:00`,
    location: null,
    description: buildDescription({ detail: dl.what, srcUrl: sourceUrl(dl.source), dashboard_id: id }),
    reminders: DEADLINE_REMINDERS,
    confirmed: dl.confirmed !== false,
    category: "deadline",
    origin: "deadlines",
  });
}

// Writable rows and flagged rows go in SEPARATE keys. They used to share one
// `rows` array with the flagged ones tagged SKIP, which is a trap for an
// unattended writer: anything iterating `rows` without testing the flag would
// create the very items "flag, never guess" says must never be written.
const kept = rows.filter((r) => !r.SKIP);

// Registry tiers 3-4 are reported but never written, so the calendar stays on
// the watchlist the user actually tracks. Excluded rows go in their own key
// rather than being dropped on the floor -- phase 3 writes `rows` only, so
// anything here is inert, but it stays auditable in the log.
const excluded_by_tier = kept
  .filter((r) => excludedByTier(r.summary.split(" - ")[0]))
  .map((r) => ({ ...r, excluded_registry_tier: registryTierOf(r.summary.split(" - ")[0]) }));

const writable = kept
  .filter((r) => !excludedByTier(r.summary.split(" - ")[0]))
  .sort((a, b) => a.start.localeCompare(b.start));
const flagged = rows.filter((r) => r.SKIP);

// Tag every event this pipeline creates, so anything on the Western Clubs
// calendar without the tag came from somewhere else (the imported Western
// Connect feed, or a hand-added entry) and is not ours to touch.
//
// Applied HERE, after the dedup passes above: those match on summary prefixes
// (`startsWith(org + " -")`) and equality, so tagging earlier would silently
// defeat duplicate detection. The suffix is also NOT part of dashboard_id --
// keys hash club + curated subject -- so tagging cannot orphan existing events.
const TAG = " [DASHBOARD]";
for (const r of writable) {
  if (!r.summary.endsWith(TAG)) r.summary += TAG;
}

fs.writeFileSync(
  OUT,
  // colorId 2 = Sage, the closest event colour to Pistachio. Pistachio itself is
  // a CALENDAR colour in Google Calendar and is not offered by the events API,
  // whose palette is only: 1 Lavender, 2 Sage, 3 Grape, 4 Flamingo, 5 Banana,
  // 6 Tangerine, 7 Peacock, 8 Graphite, 9 Blueberry, 10 Basil, 11 Tomato.
  JSON.stringify({ generated: TODAY, timeZone: TZ, colorId: "2", rows: writable, flagged, excluded_by_tier }, null, 1)
);
console.log("rows:", writable.length, "| flagged (never written):", flagged.length);
console.log("tier A:", writable.filter((r) => r.tier === "A").length, "tier B:", writable.filter((r) => r.tier === "B").length);
console.log(
  "excluded by registry tier (never written):", excluded_by_tier.length,
  excluded_by_tier.length ? "-> " + [...new Set(excluded_by_tier.map((r) => r.summary.split(" - ")[0] + " (T" + r.excluded_registry_tier + ")"))].join(", ") : ""
);
