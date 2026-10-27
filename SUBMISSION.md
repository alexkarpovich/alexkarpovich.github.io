# Trello Power-Up submission — copy-paste values

Replace **`SUPPORT_EMAIL`** everywhere (including `privacy.html`) before deploy. Replace **`POWER_UP_ID`** after you create the app in [Apps Admin](https://trello.com/apps/admin). Production hosting: Cloudflare Pages at `https://alexkarpovich-github-io.pages.dev`; publish `dist/` with `dist/_headers` (see README → Security / Cloudflare Pages). GitHub Pages cannot apply these custom response headers. Keep the existing Power-Up ID and API key when changing hosting.

---

## 1. Hosting URLs (after `npm run check` and deploy to `main`)

| Field | Value |
| --- | --- |
| **Iframe Connector URL** | `https://alexkarpovich-github-io.pages.dev/index.html` |
| **Privacy Policy URL** | `https://alexkarpovich-github-io.pages.dev/privacy.html` |
| **About / support page (optional)** | `https://alexkarpovich-github-io.pages.dev/about.html` |
| **API key Allowed Origins** (Trello Auth tab) | `https://alexkarpovich-github-io.pages.dev` (origin only — no path, no trailing slash) |
| **Directory link (after launch)** | `https://trello.com/power-ups/POWER_UP_ID` |

If the hosting origin changes, update connector, privacy, and Allowed Origins to match.

---

## 2. Apps Admin — create / edit Power-Up

| Admin field | Suggested value |
| --- | --- |
| **Name** (listing) | `Time Tracking` |
| **Iframe Connector URL** | `https://alexkarpovich-github-io.pages.dev/index.html` |
| **Author / developer name** | `Aliaksandr Karpovich` |
| **Support Email** | `SUPPORT_EMAIL` |
| **Privacy Policy URL** | `https://alexkarpovich-github-io.pages.dev/privacy.html` |
| **Website (optional)** | `https://alexkarpovich-github-io.pages.dev/about.html` |
| **Categories** | Productivity; Project management (pick closest available) |

Avoid names like “Trello Time Tracking” or “Official Trello …” (trademark).

---

## 3. Overview (short — directory teaser; **max 140 characters**)

```text
Log time on cards (30m, 1h, 1d), badge totals, filtered board reports, XLSX export, epic limits. Data stays in Trello—no extra account.
```

---

## 4. Description (long — directory listing)

The block below is Markdown for the Trello listing, with short feature sections and inline GIFs inspired by the [Hello Epics listing](https://trello.com/power-ups/58c85f41d7f012a1879c7b2e). The recordings use the actual Power-Up components with isolated English sample data. Publish the generated `img/demo/` assets with `dist/` before pasting the description into Apps Admin. This repository edit does not update the directory listing.

```text
Track time. Connect your tasks. Plan your next delivery.

Time Tracking brings time logs, epic budgets, team reports and a capacity-aware timeline to your Trello board. Follow the work from the first logged minute to the forecast finish date, without another account.

## Log time as you work

Add time directly on a card using formats such as 30m, 1h 30m, 1:30 or 1d. Include a comment, review the history and edit your own entries. Card badges keep logged totals visible on the board.

![Log time and add a comment on a card](https://alexkarpovich-github-io.pages.dev/img/demo/time.gif)

## Bring tasks together

Link existing cards by name or URL to build epics and nested task groups on your board. Set an estimate and see child time roll up into the epic’s spent and remaining budget. Reorder children to set planning priority.

![Add a child card and update an epic’s time budget](https://alexkarpovich-github-io.pages.dev/img/demo/epics.gif)

## Plan around real capacity

Open Timeline to see your project hierarchy, dependencies and forecast dates in one view. Set team availability in FTE and adjust it as capacity changes. The timeline accounts for weekends, excluded dates and explicit task or epic FTE limits.

Grey progress shows logged time; blue shows scheduled work. Red segments highlight time over an estimate, and a vertical Today line marks the current date. Click a bar for its dates, ETA, spent time and overrun.

Timeline schedules the full ETA plus any overrun. Spent time is shown as progress and does not reduce the scheduled estimate. Each explicit child or epic ETA adds work to the plan.

![Inspect dependencies and recalculate the timeline with more team capacity](https://alexkarpovich-github-io.pages.dev/img/demo/timeline.gif)

## Turn time into a clear report

Review board-wide time by date range, label or author. Narrow the report to the work you need, then download an Excel workbook with Report, Entries and Epics sheets.

![Filter a time report and download an Excel workbook](https://alexkarpovich-github-io.pages.dev/img/demo/reports.gif)

## Make it fit your team

Configure working hours per day, working days per week and month, week start and excluded dates. Your time formats and forecasts follow the board’s settings. The interface supports light and dark themes.

## Keep your data in Trello

Time entries and settings are stored in Trello shared Power-Up data. There is no separate vendor database or additional account. Shared entries are visible to people who can access the board.

If Trello cannot return child time logs through its Power-Up SDK, optional read-only Trello authorization can help load them. You can disconnect in the Power-Up settings or your Trello account’s Applications page.

Free to use. Enable Time Tracking on your board to get started.

The demos above use sample data in a local preview of the Power-Up interface.
```

---

## 5. Capabilities (enable exactly these)

| Display name | Capability key |
| --- | --- |
| Board buttons | `board-buttons` |
| Card back section | `card-back-section` |
| Card badges | `card-badges` |
| Card detail badges | `card-detail-badges` |
| Card buttons | `card-buttons` |
| Show settings | `show-settings` |
| On enable | `on-enable` |
| Authorization status | `authorization-status` |
| Show authorization | `show-authorization` |

---

## 6. Trello Auth tab

| Field | Value |
| --- | --- |
| **API key** | Generate in Apps Admin; must match `appKey` in `js/config.js` (currently `e7c6a3aac8963848b7706bf61469df27` — regenerate if this app is new) |
| **Allowed Origins** | `https://alexkarpovich-github-io.pages.dev` |

OAuth redirect page: `https://alexkarpovich-github-io.pages.dev/auth-complete.html` (must be deployed; included in `dist/`).

---

## 7. Developer support form ([go.trello.com/dev-support](https://go.trello.com/dev-support))

Use the same text as above where the form asks for overview, description, and testing notes. Suggested **testing instructions for reviewers**:

```text
Workspace: [NAME OF YOUR TEST WORKSPACE — same as registered on the Power-Up]

1. Enable “Time Tracking” on a test board (Power-Ups menu → Custom → enable → reload board).
2. On first enable, a setup modal may open if read access is not yet granted—this is optional for basic logging; click through or close it and use the card normally.
3. Open any card → click “Time” or the “Time tracking” card-back section → add 30m → Save. Badge should show 30m.
4. Board menu → “Time report” → confirm totals and try a date filter → Export (.xlsx); open in Excel and confirm three sheets.
5. Epic test (optional): add two child card URLs in the Epic tab using + add child card; set limit 2h on the epic; log 30m on each child; epic section should show remaining time and “Est. finish”; switch to Task to log time on the same card, then back to Epic to check child totals. Badge should update after optional “Connect” in Power-Up settings (board menu → Power-Ups → Time Tracking → Settings).
6. Settings: Power-Ups → Time Tracking → Settings → adjust work day/week/month and select multiple excluded dates in the calendar (affect epic estimates); “Disconnect” if token was connected.

No third-party account. No payment. Public API key in static JS is intentional (Trello-allowed); user tokens are never in source code.

Support: SUPPORT_EMAIL
Privacy: https://alexkarpovich-github-io.pages.dev/privacy.html
Connector: https://alexkarpovich-github-io.pages.dev/index.html
Power-Up ID: POWER_UP_ID
```

---

## 8. Privacy & compliance (admin / form checkboxes)

| Question | Answer |
| --- | --- |
| Stores personal data? | **Yes** — Trello member ID, display name, optional entry comments, and optional cached epic summaries (child card names/URLs) in shared pluginData |
| Separate database? | **No** |
| User tokens on your server? | **No** — SDK stores read token in Trello member data |
| GDPR / privacy policy published? | **Yes** — `privacy.html` URL above |
| Data on public boards? | **Yes** — shared data visible like the rest of the board |

---

## 9. Launch preferences (when review passes)

| Field | Suggested value |
| --- | --- |
| **Preferred launch date** | No strong preference / ASAP after approval |
| **Marketing planned?** | No (or describe newsletter/blog if you add one later) |
| **Paid tier?** | No |

---

## 10. Pre-submit checklist

- [ ] Replace `SUPPORT_EMAIL` in `privacy.html`, redeploy `dist/`
- [ ] Sign Joint Developer Agreement in Apps Admin
- [ ] Upload **icon** (use `img/icon.svg` exported as 512×512 PNG if admin requires PNG)
- [ ] Add **screenshots or GIF** (card log, badge, report modal, settings)
- [ ] Run `npm ci && npm run check`
- [ ] Deploy `dist/` to Cloudflare Pages (or configure equivalent HTTP headers on your host)
- [ ] Run `npm run check:security -- https://alexkarpovich-github-io.pages.dev/index.html` and scan the new connector URL on securityheaders.com
- [ ] Update the existing Power-Up connector URL, privacy/website links and Trello Auth Allowed Origins to the new host
- [ ] Verify Connect / Disconnect, themes, Timeline, and XLSX export on a real Trello board without CSP violations
- [ ] Complete board test matrix in README on a real board
- [ ] Submit form with **Power-Up ID** from Apps Admin URL

---

## 11. Icon & assets

| Asset | Path |
| --- | --- |
| Icon (SVG) | `img/icon.svg` |
| Logo | `img/logo.svg` |
| Add button icon | `img/add.svg` |
| Report button icons (light/dark) | `img/report-on-light.svg`, `img/report-on-dark.svg` |
| Time log demo | `img/demo/time.gif` (also `.mp4` and `.png`) |
| Epic / child cards demo | `img/demo/epics.gif` (also `.mp4` and `.png`) |
| Timeline / FTE demo | `img/demo/timeline.gif` (also `.mp4` and `.png`) |
| Filtered report / export demo | `img/demo/reports.gif` (also `.mp4` and `.png`) |
| Local media review | `img/demo/index.html` |
| Actual workbook downloaded during recording | `img/demo/sample-time-report.xlsx` |

To reproduce the recordings, install Playwright in a separate tooling directory and run `NODE_PATH=/path/to/tooling/node_modules node scripts/record-demo.cjs`. Chromium and `ffmpeg` must be installed. The script uses local files and sample data; it never connects to a Trello account. Runtime npm dependencies are unchanged. The GIFs can illustrate the listing; a reviewer may also request screenshots from an actual board.
