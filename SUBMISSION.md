# Trello Power-Up submission — copy-paste values

Replace **`SUPPORT_EMAIL`** everywhere (including `privacy.html`) before deploy. Replace **`POWER_UP_ID`** after you create the app in [Apps Admin](https://trello.com/apps/admin). Confirm **`CONNECTOR_URL`** matches GitHub Pages → Settings → Pages.

---

## 1. Hosting URLs (after `npm run check` and deploy to `main`)

| Field | Value |
| --- | --- |
| **Iframe Connector URL** | `https://alexkarpovich.github.io/index.html` |
| **Privacy Policy URL** | `https://alexkarpovich.github.io/privacy.html` |
| **About / support page (optional)** | `https://alexkarpovich.github.io/about.html` |
| **API key Allowed Origins** (Trello Auth tab) | `https://alexkarpovich.github.io` (origin only — no path, no trailing slash) |
| **Directory link (after launch)** | `https://trello.com/power-ups/POWER_UP_ID` |

If you use a custom domain or project repo URL instead of user Pages, update connector, privacy, and Allowed Origins to match.

---

## 2. Apps Admin — create / edit Power-Up

| Admin field | Suggested value |
| --- | --- |
| **Name** (listing) | `Time Tracking` |
| **Iframe Connector URL** | `https://alexkarpovich.github.io/index.html` |
| **Author / developer name** | `Aliaksandr Karpovich` |
| **Support Email** | `SUPPORT_EMAIL` |
| **Privacy Policy URL** | `https://alexkarpovich.github.io/privacy.html` |
| **Website (optional)** | `https://alexkarpovich.github.io/about.html` |
| **Categories** | Productivity; Project management (pick closest available) |

Avoid names like “Trello Time Tracking” or “Official Trello …” (trademark).

---

## 3. Overview (short — directory teaser; **max 140 characters**)

```text
Log time on cards (30m, 1h, 1d), badge totals, filtered board reports, XLSX export, epic limits. Data stays in Trello—no extra account.
```

---

## 4. Description (long — directory listing)

```text
Time Tracking adds lightweight time logging directly on Trello cards.

• Log time with flexible formats: 30m, 1h 40m, 1:40, 1d, 1w (work-day/week settings are configurable per board).
• See logged time on card badges and open a full log from the card back.
• Open a board-wide Time report with date range, author, and label filters.
• Export filtered results as an Excel workbook (.xlsx) with Report, Entries, and Epics sheets.
• Set time limits on “epic” cards that track child cards linked in the Power-Up list; remaining time and an estimated finish date appear when child data is available (nested sub-tasks roll up; time on the epic card itself is excluded).
• Optional cached epic rollups in shared card data speed up badges and reopening; the cache is rebuilt from logs when needed and may be dropped if card storage is full.

All time entries and board settings are stored in Trello shared Power-Up data on your boards—there is no vendor backend or extra login.

Optional one-time read access: if you use epic remaining time and Trello cannot return child time logs through the SDK, click “Allow read access (once)” in settings. This uses Trello’s OAuth with read-only scope; you can disconnect anytime in Power-Up settings or Trello account → Applications.

Free to use. Works on boards in your Workspace after you enable the Power-Up from the board menu.
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
| **Allowed Origins** | `https://alexkarpovich.github.io` |

OAuth redirect page: `https://alexkarpovich.github.io/auth-complete.html` (must be deployed; included in `dist/`).

---

## 7. Developer support form ([go.trello.com/dev-support](https://go.trello.com/dev-support))

Use the same text as above where the form asks for overview, description, and testing notes. Suggested **testing instructions for reviewers**:

```text
Workspace: [NAME OF YOUR TEST WORKSPACE — same as registered on the Power-Up]

1. Enable “Time Tracking” on a test board (Power-Ups menu → Custom → enable → reload board).
2. On first enable, a setup modal may open if read access is not yet granted—this is optional for basic logging; click through or close it and use the card normally.
3. Open any card → click “Time” or the “Time tracking” card-back section → add 30m → Save. Badge should show 30m.
4. Board menu → “Time report” → confirm totals and try a date filter → Export (.xlsx); open in Excel and confirm three sheets.
5. Epic test (optional): add two child card URLs under Epic summary / Child cards; set limit 2h on the epic; log 30m on each child; epic section should show remaining time and “Est. finish”; use the arrow control in the epic header to show/hide the card’s own time log. Badge should update after optional “Allow read access (once)” in Power-Up settings (board menu → Power-Ups → Time Tracking → Settings).
6. Settings: Power-Ups → Time Tracking → Settings → adjust work day/week and excluded dates (affect epic estimates); “Forget saved read access” if token was connected.

No third-party account. No payment. Public API key in static JS is intentional (Trello-allowed); user tokens are never in source code.

Support: SUPPORT_EMAIL
Privacy: https://alexkarpovich.github.io/privacy.html
Connector: https://alexkarpovich.github.io/index.html
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
- [ ] Push to `main` and verify all URLs return 200
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

Listing often wants PNG/JPEG screenshots you capture from a live board—not from `preview.html` alone.
