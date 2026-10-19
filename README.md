# Time Tracking for Trello

Log time on cards and run board reports. Static pages — free on GitHub Pages. No backend; data is stored in Trello.

UI preview without a board: [preview.html](preview.html).

## Features

- Log time on cards: `30m`, `1h`, `1h 40m`, `1d`, `1w`, `1:40` (Russian units also supported).
- Author, date, and comment per entry. New entries use today and the current member.
- Card badges and card back section.
- Board report with period presets (this week by default), label and author filters, Excel export.
- Epic time limit on a card with checklist child cards; remaining time from child logs.
- Configurable work day (`1d`) and work week (`1w`).

## GitHub Pages

1. Push to public branch `main`.
2. Settings → Pages → Deploy from branch → `main` → `/ (root)`.
3. Create a Power-Up at [Trello Power-Up admin](https://trello.com/power-ups/admin).
4. Iframe connector URL: `https://USER.github.io/REPO/index.html`.
5. Enable: Board buttons, Card back section, Card badges, Card detail badges, Card buttons, Show settings.
6. Add the Power-Up to a board.

## Usage

On the card back: enter **Time** and **Comment**, press Enter or the + button.

**Time report** on the board opens the summary. **Download Excel** exports the current filters.

For epics, link child cards via checklist (Convert to card or `trello.com/c/...` URL), then set a limit on the epic.

Settings (work day/week): Power-Up menu on the board → gear icon.

## API key (optional)

Without `appKey` in `js/config.js`, logging and reports work. The key helps load checklist links for epic remaining time when Trello omits check items in bulk reads.

## Limits

~4 KB of shared data per card. If full, same-day entries may merge or notes drop; minutes are kept.
