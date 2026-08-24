// ---------- helpers ----------
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

async function getJSON(url) {
  const r = await fetch(url);
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

function stamp(key) {
  const el = document.querySelector(`[data-stamp="${key}"]`);
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function relTime(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return Math.floor(diff / 60) + "m ago";
  if (diff < 86400) return Math.floor(diff / 3600) + "h ago";
  return Math.floor(diff / 86400) + "d ago";
}

// ---------- clock / header ----------
function tickClock() {
  const now = new Date();
  $("clock").textContent = now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  $("date").textContent = now.toLocaleDateString([], {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
  const h = now.getHours();
  const part = h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
  $("greeting").textContent = part;
}

// ---------- weather ----------
const WMO = {
  0: ["Clear sky", "☀️"], 1: ["Mainly clear", "🌤️"], 2: ["Partly cloudy", "⛅"],
  3: ["Overcast", "☁️"], 45: ["Fog", "🌫️"], 48: ["Rime fog", "🌫️"],
  51: ["Light drizzle", "🌦️"], 53: ["Drizzle", "🌦️"], 55: ["Heavy drizzle", "🌦️"],
  61: ["Light rain", "🌧️"], 63: ["Rain", "🌧️"], 65: ["Heavy rain", "🌧️"],
  66: ["Freezing rain", "🌧️"], 67: ["Freezing rain", "🌧️"],
  71: ["Light snow", "🌨️"], 73: ["Snow", "🌨️"], 75: ["Heavy snow", "❄️"],
  77: ["Snow grains", "🌨️"], 80: ["Rain showers", "🌦️"], 81: ["Rain showers", "🌦️"],
  82: ["Violent showers", "⛈️"], 85: ["Snow showers", "🌨️"], 86: ["Snow showers", "🌨️"],
  95: ["Thunderstorm", "⛈️"], 96: ["Thunderstorm", "⛈️"], 99: ["Thunderstorm", "⛈️"],
};
const wmo = (c) => WMO[c] || ["—", "🌡️"];

async function coords(fallback) {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(fallback);
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, label: null }),
      () => resolve(fallback),
      { timeout: 6000, maximumAge: 600000 }
    );
  });
}

async function loadWeather(cfg) {
  const el = $("weather");
  try {
    const fb = {
      lat: cfg.weather.fallbackLatitude,
      lon: cfg.weather.fallbackLongitude,
      label: cfg.weather.fallbackLabel,
    };
    const { lat, lon, label } = await coords(fb);
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,relative_humidity_2m` +
      `&daily=weather_code,temperature_2m_max,temperature_2m_min&timezone=auto&forecast_days=5`;
    const r = await fetch(url);
    const d = await r.json();
    const cur = d.current;
    const [desc, icon] = wmo(cur.weather_code);

    let place = label;
    if (!place) {
      try {
        const g = await fetch(
          `https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}`
        ).then((x) => x.json());
        place = g.city || g.locality || g.principalSubdivision || "";
      } catch {
        place = "";
      }
    }

    const days = d.daily.time
      .map((t, i) => {
        const [, di] = wmo(d.daily.weather_code[i]);
        const dn = new Date(t).toLocaleDateString([], { weekday: "short" });
        return `<div class="fc-day"><div class="d">${i === 0 ? "Today" : dn}</div>
          <div class="i">${di}</div>
          <div class="t">${Math.round(d.daily.temperature_2m_max[i])}°<span class="lo"> ${Math.round(
          d.daily.temperature_2m_min[i]
        )}°</span></div></div>`;
      })
      .join("");

    el.innerHTML = `
      <div class="weather-now">
        <div class="weather-icon">${icon}</div>
        <div>
          <div class="weather-temp">${Math.round(cur.temperature_2m)}°</div>
          <div class="weather-desc">${desc}${place ? " · " + esc(place) : ""}</div>
          <div class="weather-meta">Feels ${Math.round(cur.apparent_temperature)}° · 💧 ${
      cur.relative_humidity_2m
    }% · 💨 ${Math.round(cur.wind_speed_10m)} km/h</div>
        </div>
      </div>
      <div class="forecast">${days}</div>`;
    stamp("weather");
  } catch (e) {
    el.innerHTML = `<div class="error">Weather unavailable</div>`;
  }
}

// ---------- calendar ----------
function fmtEventTime(ev) {
  if (ev.allDay) return "All day";
  return new Date(ev.start).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function loadCalendar() {
  const el = $("agenda");
  const { ok, status, data } = await getJSON("/api/calendar");
  if (status === 401 || status === 400) return renderConnect(el, data.error);
  if (!ok) return (el.innerHTML = `<div class="error">${esc(data.error || "Error")}</div>`);
  const events = data.events || [];
  if (!events.length) return (el.innerHTML = `<div class="loading">Nothing scheduled 🎉</div>`);

  const today = new Date().toDateString();
  const tomorrow = new Date(Date.now() + 86400000).toDateString();
  let html = "";
  let lastDay = null;
  for (const ev of events) {
    const day = new Date(ev.start).toDateString();
    if (day !== lastDay) {
      const label = day === today ? "Today" : day === tomorrow ? "Tomorrow" : new Date(ev.start).toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
      html += `<div class="day-label">${label}</div>`;
      lastDay = day;
    }
    html += `<div class="evt">
      <div class="evt-time">${fmtEventTime(ev)}</div>
      <div class="evt-body">
        <div class="evt-title">${esc(ev.summary)}</div>
        ${ev.location ? `<div class="evt-sub">📍 ${esc(ev.location)}</div>` : ""}
        ${ev.hangoutLink ? `<div class="evt-sub"><a href="${esc(ev.hangoutLink)}" target="_blank">Join meet →</a></div>` : ""}
      </div>
    </div>`;
  }
  el.innerHTML = html;
  stamp("calendar");
}

// ---------- gmail ----------
async function loadGmail() {
  const el = $("email");
  const { ok, status, data } = await getJSON("/api/gmail");
  if (status === 401 || status === 400) return renderConnect(el, data.error);
  if (!ok) return (el.innerHTML = `<div class="error">${esc(data.error || "Error")}</div>`);
  const msgs = data.messages || [];
  const priority = data.priority || [];

  const mailLink = (m) => `https://mail.google.com/mail/u/0/#inbox/${esc(m.threadId)}`;
  const tagPills = (m) =>
    (m.tags || []).map((t) => `<span class="tag tag-${esc(t.toLowerCase())}">${esc(t)}</span>`).join("");

  const renderMail = (m) => `<div class="item mail${m.highlight ? " mail-hl" : ""}">
      <div class="mail-top">
        <span class="mail-from">${esc(m.from)}</span>
        ${m.unread === false ? '<span class="mail-read">read</span>' : ""}
      </div>
      <div class="mail-subj"><a href="${mailLink(m)}" target="_blank" rel="noopener">${esc(m.subject)}</a></div>
      <div class="mail-snip">${esc(m.snippet)}</div>
      ${m.tags && m.tags.length ? `<div class="mail-tags">${tagPills(m)}</div>` : ""}
    </div>`;

  let html = `<div class="unread-count">${data.unreadCount} <span>unread</span></div>`;

  const hlUnread = msgs.filter((m) => m.highlight).length;
  if (priority.length || hlUnread) {
    html += `<div class="mail-section">⭐ Relevant to you${
      priority.length ? ` <span class="mail-count">${priority.length + hlUnread}</span>` : ""
    }</div>`;
    for (const m of msgs.filter((m) => m.highlight)) html += renderMail(m);
    for (const m of priority) html += renderMail(m);
  }

  const rest = msgs.filter((m) => !m.highlight);
  if (rest.length) {
    if (priority.length || hlUnread) html += `<div class="mail-section">Other unread</div>`;
    for (const m of rest) html += renderMail(m);
  }
  if (!msgs.length && !priority.length) html += `<div class="loading">Inbox zero 🎉</div>`;

  el.innerHTML = html;
  stamp("gmail");
}

function renderConnect(el, error) {
  if (error === "not_configured") {
    el.innerHTML = `<div class="hint">Google not set up yet. Add <code>secrets.json</code> with your OAuth credentials, then restart the server.</div>`;
  } else {
    el.innerHTML = `<a class="connect" href="/auth/google">Connect Google</a>
      <div class="hint">Read-only access to Calendar &amp; Gmail.</div>`;
  }
}

// ---------- markets ----------
async function loadMarkets() {
  const el = $("markets");
  const { ok, data } = await getJSON("/api/markets");
  if (!ok) return (el.innerHTML = `<div class="error">Markets unavailable</div>`);
  const quotes = data.quotes || [];
  if (!quotes.length) return (el.innerHTML = `<div class="loading">No tickers configured</div>`);
  el.innerHTML = quotes
    .map((q) => {
      const up = q.change >= 0;
      const sign = up ? "+" : "";
      return `<div class="quote">
        <div>
          <div class="q-sym">${esc(q.symbol)}</div>
          <div class="q-name">${esc(q.name)}</div>
        </div>
        <div class="q-price">
          <div class="q-val">${q.price != null ? q.price.toFixed(2) : "—"}</div>
          <div class="q-chg ${up ? "up" : "down"}">${sign}${q.change.toFixed(2)} (${sign}${q.changePct.toFixed(2)}%)</div>
        </div>
      </div>`;
    })
    .join("");
  stamp("markets");
}

// ---------- news ----------
async function loadNews(category, elId) {
  const el = $(elId);
  const { ok, data } = await getJSON(`/api/news?category=${category}`);
  if (!ok) return (el.innerHTML = `<div class="error">Feed unavailable</div>`);
  const items = data.items || [];
  if (!items.length) return (el.innerHTML = `<div class="loading">No items</div>`);
  el.innerHTML = items
    .map(
      (it) => `<div class="item">
        <div class="item-title"><a href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title)}</a></div>
        <div class="item-meta"><span class="pill">${esc(it.source)}</span><span>${relTime(it.date)}</span></div>
      </div>`
    )
    .join("");
  stamp(category);
}

// ---------- western club digest ----------
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function parseEventDate(str) {
  // Handles "2026-08-12"; returns null for fuzzy strings like "2026-09 (TBA)"
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(str).trim());
  if (!m) return null;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function whenBadge(date) {
  if (!date) return { text: "TBA", cls: "when-later" };
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((date - today) / 86400000);
  let text, cls;
  if (days === 0) text = "Today";
  else if (days === 1) text = "Tomorrow";
  else text = `in ${days}d`;
  if (days <= 3) cls = "when-soon";
  else if (days <= 7) cls = "when-week";
  else cls = "when-later";
  return { text, cls };
}

function dateBadge(str, date) {
  if (date) return `<div class="m">${MONTHS[date.getMonth()]}</div><div class="d">${date.getDate()}</div>`;
  const ym = /^(\d{4})-(\d{2})/.exec(String(str));
  const mon = ym ? MONTHS[Number(ym[2]) - 1] : "";
  return `<div class="m">${mon}</div><div class="d" style="font-size:0.9rem">TBA</div>`;
}

async function loadWestern() {
  const el = $("western");
  const { ok, data } = await getJSON("/api/western");
  if (!ok) return (el.innerHTML = `<div class="error">Digest unavailable (${esc(data.error || "error")})</div>`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // upcoming: future/today parseable dates + fuzzy ones, sorted
  const events = (data.upcoming_events || [])
    .map((e) => ({ ...e, _d: parseEventDate(e.date) }))
    .filter((e) => !e._d || e._d >= today)
    .sort((a, b) => {
      if (a._d && b._d) return a._d - b._d;
      if (a._d) return -1;
      if (b._d) return 1;
      return 0;
    })
    .slice(0, 8);

  const eventsHtml = events
    .map((e) => {
      const when = whenBadge(e._d);
      const clubs = e.clubs ? e.clubs.join(", ") : e.club;
      const handle = e.handle || (e.handles ? e.handles.join(" ") : "");
      const bits = [];
      if (e.time) bits.push(e.time);
      if (e.location) bits.push(e.location);
      const meta = [clubs, handle].filter(Boolean).join(" · ");
      return `<div class="devt${e.confirmed === false ? " unconfirmed" : ""}">
        <div class="devt-date">${dateBadge(e.date, e._d)}</div>
        <div class="devt-body">
          <div class="devt-title">${esc(e.title)}</div>
          <div class="devt-meta">${esc(meta)}${bits.length ? " — " + esc(bits.join(" · ")) : ""}</div>
        </div>
        <div class="devt-when ${when.cls}">${when.text}</div>
      </div>`;
    })
    .join("");

  const checklist = (data.action_checklist || [])
    .map((c) => `<li>${esc(c)}</li>`)
    .join("");

  el.innerHTML = `
    ${data.for_you ? `<div class="digest-callout">${esc(data.for_you)}</div>` : ""}
    <div class="digest-cols">
      <div class="digest-col">
        <h3>Upcoming</h3>
        ${eventsHtml || '<div class="loading">No upcoming events</div>'}
      </div>
      <div class="digest-col">
        <h3>Action checklist</h3>
        <ul class="checklist">${checklist}</ul>
      </div>
    </div>
    ${data.meta ? `<div class="digest-foot">${esc(data.meta.title || "")}${data.meta.as_of ? " · as of " + esc(data.meta.as_of) : ""}</div>` : ""}`;
  stamp("western");
}

// ---------- orchestration ----------
let cfg = { weather: {}, refreshSeconds: {} };
const timers = [];

function schedule(fn, seconds) {
  fn();
  if (seconds) timers.push(setInterval(fn, seconds * 1000));
}

async function init() {
  tickClock();
  setInterval(tickClock, 1000 * 10);

  const res = await getJSON("/api/config");
  if (res.ok) cfg = res.data;
  const rs = cfg.refreshSeconds || {};

  schedule(loadWestern, rs.western || 3600);
  schedule(() => loadWeather(cfg), rs.weather || 900);
  schedule(loadCalendar, rs.calendar || 300);
  schedule(loadGmail, rs.gmail || 180);
  schedule(loadMarkets, rs.markets || 120);
  schedule(() => loadNews("headlines", "headlines"), rs.news || 900);
  schedule(() => loadNews("dev", "dev"), rs.news || 900);
}

$("refreshAll").addEventListener("click", (e) => {
  e.target.classList.add("spin");
  setTimeout(() => e.target.classList.remove("spin"), 800);
  loadWestern();
  loadWeather(cfg);
  loadCalendar();
  loadGmail();
  loadMarkets();
  loadNews("headlines", "headlines");
  loadNews("dev", "dev");
});

init();
