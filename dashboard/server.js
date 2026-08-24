import express from "express";
import { google } from "googleapis";
import RSSParser from "rss-parser";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const readJson = (f, fallback = null) => {
  try {
    return JSON.parse(fs.readFileSync(path.join(__dirname, f), "utf8"));
  } catch {
    return fallback;
  }
};

const config = readJson("config.json", {});
const secrets = readJson("secrets.json", {});
const TOKEN_FILE = path.join(__dirname, "token.json");
const PORT = config.port || 3000;
const REDIRECT_URI = `http://localhost:${PORT}/auth/google/callback`;
const SCOPES = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/gmail.readonly",
];

// Loopback only. The dashboard has no login, so it must not be reachable from
// the local network (shared wifi, etc.) — only from this machine's browser.
const HOST = "127.0.0.1";

const app = express();
const rss = new RSSParser({ timeout: 10000 });
const log = (msg) => console.log(`[${new Date().toISOString()}] ${msg}`);

// Small TTL cache. Running all day means every open tab would otherwise hit
// Yahoo/RSS on its own timer; this shares one upstream call between them.
const cache = new Map();
async function cached(key, seconds, fn) {
  const hit = cache.get(key);
  if (hit && Date.now() < hit.expires) return hit.value;
  const value = await fn();
  cache.set(key, { value, expires: Date.now() + seconds * 1000 });
  return value;
}

// ---------- Google OAuth ----------
const googleConfigured = () =>
  Boolean(secrets.googleClientId && secrets.googleClientSecret);

function oauthClient() {
  const client = new google.auth.OAuth2(
    secrets.googleClientId,
    secrets.googleClientSecret,
    REDIRECT_URI
  );
  const tokens = readJson("token.json");
  if (tokens) client.setCredentials(tokens);
  client.on("tokens", (t) => {
    const existing = readJson("token.json", {});
    fs.writeFileSync(TOKEN_FILE, JSON.stringify({ ...existing, ...t }, null, 2));
  });
  return client;
}

const hasToken = () => fs.existsSync(TOKEN_FILE);

app.get("/api/auth/status", (req, res) => {
  res.json({ configured: googleConfigured(), connected: hasToken() });
});

app.get("/auth/google", (req, res) => {
  if (!googleConfigured())
    return res.status(400).send("Google OAuth is not configured. Add secrets.json.");
  const url = oauthClient().generateAuthUrl({
    access_type: "offline",
    prompt: "consent",
    scope: SCOPES,
  });
  res.redirect(url);
});

app.get("/auth/google/callback", async (req, res) => {
  try {
    const client = oauthClient();
    const { tokens } = await client.getToken(req.query.code);
    const existing = readJson("token.json", {});
    fs.writeFileSync(
      TOKEN_FILE,
      JSON.stringify({ ...existing, ...tokens }, null, 2)
    );
    res.redirect("/");
  } catch (err) {
    res.status(500).send("OAuth error: " + err.message);
  }
});

app.post("/api/auth/disconnect", (req, res) => {
  try {
    if (hasToken()) fs.unlinkSync(TOKEN_FILE);
  } catch {}
  res.json({ ok: true });
});

function requireGoogle(res) {
  if (!googleConfigured()) {
    res.status(400).json({ error: "not_configured" });
    return false;
  }
  if (!hasToken()) {
    res.status(401).json({ error: "not_connected" });
    return false;
  }
  return true;
}

// ---------- Calendar ----------
app.get("/api/calendar", async (req, res) => {
  if (!requireGoogle(res)) return;
  try {
    const auth = oauthClient();
    const cal = google.calendar({ version: "v3", auth });
    const now = new Date();
    const end = new Date(now);
    end.setDate(end.getDate() + 7);
    const { data } = await cal.events.list({
      calendarId: "primary",
      timeMin: now.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: "startTime",
      maxResults: 15,
    });
    const events = (data.items || []).map((e) => ({
      summary: e.summary || "(no title)",
      start: e.start?.dateTime || e.start?.date,
      end: e.end?.dateTime || e.end?.date,
      allDay: Boolean(e.start?.date && !e.start?.dateTime),
      location: e.location || null,
      hangoutLink: e.hangoutLink || null,
    }));
    res.json({ events });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Gmail ----------
const HL = config.emailHighlight || {};

// Word-boundary matchers so "intern" doesn't match "international".
const matchers = (() => {
  const out = [];
  for (const [label, terms] of Object.entries(HL.groups || {})) {
    for (const t of terms) {
      const escaped = t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      out.push({ label, term: t, re: new RegExp(`\\b${escaped}\\b`, "i") });
    }
  }
  return out;
})();

function tagMessage(msg) {
  const hay = `${msg.from} ${msg.subject} ${msg.snippet}`;
  const tags = new Set();
  const matched = new Set();
  for (const m of matchers) {
    if (m.re.test(hay)) {
      tags.add(m.label);
      matched.add(m.term);
    }
  }
  return { ...msg, tags: [...tags], matched: [...matched], highlight: tags.size > 0 };
}

// Gmail OR-search across every configured keyword: {a b c} means OR.
function highlightQuery() {
  const terms = new Set();
  for (const list of Object.values(HL.groups || {}))
    for (const t of list) terms.add(t.includes(" ") ? `"${t}"` : t);
  if (!terms.size) return null;
  // -category:promotions keeps marketing mail from matching on generic words.
  return `in:inbox -category:promotions newer_than:${
    HL.searchDays || 90
  }d {${[...terms].join(" ")}}`;
}

async function fetchMessageMeta(gmail, id) {
  const msg = await gmail.users.messages.get({
    userId: "me",
    id,
    format: "metadata",
    metadataHeaders: ["From", "Subject", "Date"],
  });
  const headers = {};
  for (const h of msg.data.payload?.headers || [])
    headers[h.name.toLowerCase()] = h.value;
  const from = headers.from || "";
  const nameMatch = from.match(/^\s*"?([^"<]*?)"?\s*</);
  return {
    id,
    threadId: msg.data.threadId || id,
    from: (nameMatch ? nameMatch[1].trim() : from) || from,
    subject: headers.subject || "(no subject)",
    date: headers.date || null,
    snippet: msg.data.snippet || "",
    unread: (msg.data.labelIds || []).includes("UNREAD"),
  };
}

async function listTagged(gmail, q, maxResults) {
  const list = await gmail.users.messages.list({ userId: "me", q, maxResults });
  const ids = (list.data.messages || []).map((m) => m.id);
  const msgs = await Promise.all(ids.map((id) => fetchMessageMeta(gmail, id)));
  return { messages: msgs.map(tagMessage), estimate: list.data.resultSizeEstimate || msgs.length };
}

app.get("/api/gmail", async (req, res) => {
  if (!requireGoogle(res)) return;
  try {
    const auth = oauthClient();
    const gmail = google.gmail({ version: "v1", auth });

    const unread = await listTagged(gmail, "is:unread in:inbox", 8);

    let priority = [];
    const hq = highlightQuery();
    if (hq) {
      const hits = await listTagged(gmail, hq, HL.maxPriority || 8);
      const seen = new Set(unread.messages.map((m) => m.id));
      // Keep only genuine keyword matches; dedupe against the unread list.
      priority = hits.messages.filter((m) => m.highlight && !seen.has(m.id));
    }

    res.json({
      unreadCount: unread.estimate,
      messages: unread.messages,
      priority,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- News ----------
app.get("/api/news", async (req, res) => {
  const category = req.query.category === "dev" ? "dev" : "headlines";
  const feeds = config.feeds?.[category] || [];
  try {
    const items = await cached(`news:${category}`, config.refreshSeconds?.news || 900, async () => {
      const results = await Promise.allSettled(
        feeds.map((f) => rss.parseURL(f.url).then((data) => ({ source: f.name, data })))
      );
      const items = [];
      for (const r of results) {
        if (r.status !== "fulfilled") continue;
        const { source, data } = r.value;
        for (const item of (data.items || []).slice(0, 8)) {
          items.push({
            source,
            title: item.title,
            link: item.link,
            date: item.isoDate || item.pubDate || null,
          });
        }
      }
      items.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
      return items.slice(0, 20);
    });
    res.json({ items });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Markets ----------
async function fetchQuote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(
    symbol
  )}?range=1d&interval=1d`;
  const r = await fetch(url, {
    headers: { "User-Agent": "Mozilla/5.0 (dashboard)" },
  });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const json = await r.json();
  const meta = json?.chart?.result?.[0]?.meta;
  if (!meta) throw new Error("no data");
  const price = meta.regularMarketPrice;
  const prev = meta.chartPreviousClose ?? meta.previousClose;
  const change = price - prev;
  const changePct = prev ? (change / prev) * 100 : 0;
  return {
    symbol: meta.symbol || symbol,
    name: meta.shortName || meta.symbol || symbol,
    price,
    change,
    changePct,
    currency: meta.currency || "USD",
  };
}

app.get("/api/markets", async (req, res) => {
  const symbols = config.tickers || [];
  try {
    const quotes = await cached("markets", config.refreshSeconds?.markets || 120, async () => {
      const results = await Promise.allSettled(symbols.map(fetchQuote));
      return results.filter((r) => r.status === "fulfilled").map((r) => r.value);
    });
    res.json({ quotes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Crypto (CoinGecko, free, no key) ----------
app.get("/api/crypto", async (req, res) => {
  const ids = config.crypto || [];
  if (!ids.length) return res.json({ coins: [] });
  try {
    const url = `https://api.coingecko.com/api/v3/simple/price?ids=${ids.join(
      ","
    )}&vs_currencies=usd&include_24hr_change=true`;
    const r = await fetch(url);
    const data = await r.json();
    const coins = ids.map((id) => ({
      id,
      price: data[id]?.usd ?? null,
      changePct: data[id]?.usd_24h_change ?? null,
    }));
    res.json({ coins });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ---------- Western Club Digest (local JSON file) ----------
app.get("/api/western", (req, res) => {
  const configured = config.westernFindingsPath;
  if (!configured) return res.status(404).json({ error: "not_configured" });
  // Relative paths are resolved against the dashboard folder, not the cwd the
  // service happened to start in, so the shipped default works from anywhere.
  const p = path.resolve(__dirname, configured);
  try {
    const data = JSON.parse(fs.readFileSync(p, "utf8"));
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: "read_failed", detail: err.message });
  }
});

// ---------- Config for frontend ----------
app.get("/api/config", (req, res) => {
  res.json({
    weather: config.weather || {},
    refreshSeconds: config.refreshSeconds || {},
    hasCrypto: (config.crypto || []).length > 0,
  });
});

app.use(express.static(path.join(__dirname, "public")));

const server = app.listen(PORT, HOST, () => {
  log(`Personal dashboard running at http://localhost:${PORT}`);
  if (!googleConfigured())
    log("Google not configured yet — copy secrets.example.json to secrets.json.");
});

// Exit code 0 tells the watchdog "stop, this was intentional"; any other code
// is a crash worth restarting.
server.on("error", (err) => {
  if (err.code === "EADDRINUSE") {
    log(`Port ${PORT} already in use — the dashboard is already running. Exiting.`);
    process.exit(0);
  }
  log(`Fatal listen error: ${err.message}`);
  process.exit(1);
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    log(`Received ${sig}, shutting down.`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}
