# Dashboard

A local web dashboard with live weather, calendar agenda, unread email, news
headlines, dev feeds, stock quotes, and the Western Club Digest produced by the
[event compiler](../event-compiler/). It auto-refreshes in the browser.

![The dashboard at localhost:3000](../docs/dashboard.png)

Plain Node + Express on the back, one hand-written page on the front — no build
step, no framework, no bundler.

## Quick start

```bash
npm install
npm start
# open http://localhost:3000
```

Weather, headlines, dev feeds and markets work immediately — no API keys.
Calendar and email need a one-time Google connection ([below](#connect-google-calendar--gmail)).
The Western Club Digest card needs a findings file; point `westernFindingsPath`
at `../event-compiler/sample-findings.json` to see it populated right away.

The server binds to `127.0.0.1`, so it is reachable from this machine's browser
and nowhere else.

## Running it as a background service

On Windows, the dashboard can install itself as a logon task so it is simply
always there — no window, nothing to launch, just open `http://localhost:3000`.
It survives sleep/wake and restarts itself within about 5 seconds if the server
crashes.

```powershell
powershell -ExecutionPolicy Bypass -File scripts\dashboard.ps1 install
```

| Command | What it does |
| --- | --- |
| `status` | Running? For how long? Answering? Google still connected? |
| `restart` | Restart it — use this after editing `config.json` |
| `stop` | Stop it until the next sign-in (or until `start`) |
| `start` | Start it now |
| `log` | Tail `server.log` (add `-Lines 100` for more) |
| `install` | Register the logon task and start it now |
| `uninstall` | Remove the logon task and stop the service |

### How the service is wired

`install` registers a Task Scheduler task named **PersonalDashboard**, triggered
at logon, which runs `scripts\launch-hidden.vbs`. That script starts
`node server.js` in a hidden window, appends its output to `server.log`, and
relaunches it if it exits unexpectedly. An exit code of 0 means the shutdown was
deliberate, so `stop` and Ctrl+C do not cause a restart. No admin rights are
needed — the task runs as your own account. `server.log` rotates to
`server.log.1` once it passes 2 MB.

On macOS or Linux, skip all of this and run `npm start` (or wrap it in
systemd/launchd yourself) — the server itself is platform-independent.

## Connect Google (Calendar + Gmail)

This gives the dashboard **read-only** access to your primary calendar and inbox.

1. Go to https://console.cloud.google.com/ and create a project (or pick one).
2. **APIs & Services → Library**: enable **Google Calendar API** and **Gmail API**.
3. **APIs & Services → OAuth consent screen**:
   - User type: **External**
   - Fill in app name / your email where required, Save.
   - **Audience → Test users**: add your own Google address.
     (In testing mode only test users can sign in — that's fine for personal use.)
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**
   - **Authorized redirect URI**: `http://localhost:3000/auth/google/callback`
   - Create, then copy the **Client ID** and **Client Secret**.
5. Copy `secrets.example.json` to `secrets.json` and paste in your values:

```json
{
  "googleClientId": "xxxxx.apps.googleusercontent.com",
  "googleClientSecret": "xxxxx"
}
```

6. Restart the server, reload the page, and click **Connect Google** in the
   Agenda or Email card. Approve the consent screen. (Google will warn the app
   is unverified — click *Advanced → Go to … (unsafe)*; it's your own app.)

Tokens are stored in `token.json`, which is git-ignored. To disconnect, delete
that file.

## Configuration

Everything lives in `config.json`. Restart after editing.

| Key | What it controls |
| --- | --- |
| `port` | Server port (default 3000). The redirect URI must match. |
| `westernFindingsPath` | Path to the event compiler's JSON, read live on each refresh. Relative paths resolve against this folder. |
| `tickers` | Stock symbols, Yahoo Finance style — `"AAPL"`, `"BTC-USD"`. |
| `crypto` | CoinGecko IDs (`"bitcoin"`, `"ethereum"`). Leave empty to hide the card. |
| `feeds.headlines` / `feeds.dev` | RSS feed URLs, each `{ name, url }`. |
| `weather.fallback*` | Coordinates used if you deny browser geolocation. |
| `refreshSeconds` | Per-section reload intervals. |
| `emailHighlight.groups` | Keyword groups that flag relevant email (see below). |
| `emailHighlight.searchDays` | How far back the targeted inbox search looks. |
| `emailHighlight.maxPriority` | Max relevant messages to surface. |

### Email highlighting

`emailHighlight.groups` maps a group name to a list of keywords. Each group
becomes a colored tag on matching messages. Matching is case-insensitive and
**word-boundary** based, so `intern` will not match `international`. Add or
remove terms freely; a new group name gets a neutral pill unless you add a
`.tag-<lowercase-name>` rule in `public/style.css`.

## API

All endpoints return JSON. The frontend is the only intended consumer.

| Endpoint | Returns |
| --- | --- |
| `GET /api/auth/status` | Whether Google is configured and connected |
| `GET /api/calendar` | Today's agenda from the primary calendar |
| `GET /api/gmail` | Unread count, recent unread, and tagged priority messages |
| `GET /api/news` | Headline and dev feed items |
| `GET /api/markets` | Quotes for `config.tickers` |
| `GET /api/crypto` | Prices for `config.crypto` |
| `GET /api/western` | The event compiler's findings JSON, read fresh |
| `GET /api/config` | The subset of config the frontend needs |
| `GET /auth/google`, `GET /auth/google/callback` | OAuth flow |

News and market responses are cached server-side for one refresh interval, so
extra browser tabs do not multiply the upstream requests.

## Notes on data and privacy

- The only credentials needed are your own Google OAuth client. Weather comes
  from Open-Meteo, markets from Yahoo Finance, news from public RSS, crypto from
  CoinGecko — all keyless.
- `secrets.json` and `token.json` are git-ignored. Never commit them.
- Everything runs on your machine; data is fetched directly from the sources and
  is not sent anywhere else.
- **There is no login.** That is exactly why the server binds to loopback only.
  If you ever want to reach it from your phone or another machine, add
  authentication first — these endpoints hand your inbox and calendar to anyone
  who can open them.
