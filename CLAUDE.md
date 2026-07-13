# WhenFree — Project Context

## Overview

Single-file meeting scheduler (when2meet alternative). Real-time availability sync via Firebase Firestore, ranked best-time finder, per-user colors, dark/light mode toggle, Hebrew/French/English i18n with RTL support. Hosted at `whenfree.org`.

## Repository & Deployment

- GitHub: https://github.com/avikla/whenfree
- Deployment: GitHub Pages (automatic on push to `main`)
- Remote was renamed from `Meteor-Meet` → `whenfree`

Push from inside the project folder:

```powershell
cd "projects/whenfree"
git add .
git commit -m "..."
git push
```

## Files & Architecture

| File | Role |
|------|------|
| `index.html` | Single-page app (HTML, CSS, JS inline) with Firebase Firestore integration |
| `mailer.gs` | Google Apps Script — sends all emails via ZeptoMail API from `no-reply@whenfree.org` (display name "WhenFree"). Token stored in GAS Script Properties as `ZEPTO_API_KEY`. |
| `daily-report.gs` | GAS — daily DB usage report to `avi@whenfree.org` at midnight IST |
| `appsscript.json` | GAS manifest — OAuth scopes, timezone (Asia/Jerusalem), runtime |
| `icons/favicon.svg` | App favicon (calendar + checkmark icon) |
| `icons/` | Icon set: `icon-16/32/64/128/256/512.svg`, `logo-wordmark.svg`, `logo-wordmark-light.svg` |
| `CNAME` | Domain record — `whenfree.org` |
| `help.html` | Help page |
| `terms.html` | Terms & Privacy page |
| `accessibility-statement.html` | Accessibility statement |
| `404.html` | GitHub Pages custom 404 |
| `pad.xml` | ASP PAD 4.0 descriptor for software directory submissions (Softpedia, etc.) — self-hosted at `whenfree.org/pad.xml` |
| `Screenshots/` | Listing screenshots: `0.png` (creation form), `1.png` (grid + best times — used as PAD hero image), `2.png` (mobile crop) |

## Domain & Redirects

- **Live site:** `whenfree.org` → GitHub Pages (Cloudflare DNS)
- **Legacy redirect:** `meet.meteor.co.il` → `whenfree.org` via Cloudflare Redirect Rule (Dynamic, preserves query string)
- **Email forwarding (incoming):** Cloudflare Email Routing catch-all → `avi.klayman@gmail.com`
- **Email sending (outgoing):** ZeptoMail transactional API from `no-reply@whenfree.org` (via GAS `mailer.gs`)
- **Contact:** `avi@whenfree.org`

## Software Directory Listings (PAD)

- `pad.xml` — ASP PAD 4.0 descriptor for submitting WhenFree to Softpedia and similar software directories. Self-hosted at `https://whenfree.org/pad.xml` (its own `Application_XML_File_URL` points back to itself, per PAD convention). Submit by pasting that URL into a directory's PAD/submit-software form.
- **Legal/company info used:** `Company_Name`=`Klayman Meteor Ltd.`, address `5 Snir St., Ramat-Hasharon, Israel 4704071`, contact `avi@whenfree.org` — reuse this if other directories need company info.
- **Web-app caveat:** PAD was designed for downloadable installers; WhenFree has none, so `File_Info` sizes are `0` and `Primary_Download_URL` points at the homepage itself rather than an installer file. `Program_OS_Support` lists broad desktop/mobile OSes as an approximation since the spec has no literal "Web" value.
- **Hero screenshot:** `Screenshots/1.png` (grid + ranked best times) is used as `Application_Screenshot_URL` — most representative of the product's value prop.
- To update: edit `pad.xml`, commit, push — live within ~a minute via GitHub Pages.

## Features

- **Real-time sync:** Firestore backend syncs availability across all participants
- **Ranked best times:** Algorithm ranks time slots by number of "available" votes
- **Add to Calendar:** Google Calendar deep-link or `.ics` download (Apple/Outlook). Handles `specific` and `days` modes.
- **Per-user colors:** Each participant gets a color for easy identification
- **Dark/light toggle:** Theme switcher with localStorage persistence
- **i18n:** English, Hebrew (RTL), French — toggled via buttons or `?lang=` URL param
- **Language URL params:** `?lang=fr`, `?lang=he`, `?lang=en` — detected on load, updated in URL on change. Works with event hashes: `whenfree.org/?lang=fr#eventSlug`
- **No login required:** Share a link, participants add their name and availability
- **Daily DB report:** Automated midnight email with Firestore event count, reads/writes/deletes vs. free-tier limits, storage usage
- **Smart disabled states:** `syncActionStates()` disables "Send best times" when no slots exist; re-enables reactively
- **Floating email panels:** Email input panels use `position:fixed` (no layout shift when opened)
- **Onboarding lang picker:** First-time visitors see EN/FR/HE buttons at the top of the help modal — clicking one calls `setLang()` and re-renders the modal content instantly in the chosen language before the user reads it

## Email System

- **Sender:** ZeptoMail transactional API via `UrlFetchApp.fetch()` in GAS, from `no-reply@whenfree.org`, display name "WhenFree"
- **Endpoint:** `https://api.zeptomail.com/v1.1/email` (US region)
- **Auth:** `Authorization: <ZEPTO_API_KEY>` — token stored in GAS Script Properties as `ZEPTO_API_KEY`, value includes the full `Zoho-enczapikey <base64>` prefix. Used directly (`.trim()` applied). Never in source code.
- **Template:** `buildEmailTemplate(bodyHtml, dir)` — dark forest header with calendar-check icon + "WhenFree" wordmark, verde palette card, sage background
- **Email types:** creator confirmation, invite to mark availability, best times, organizer notification (all localized EN/HE/FR with RTL support)
- **Organizer notification:** `scheduleNotifyOrganizer(name)` — debounced 120s after last cell mark (not on join). Sends branded HTML with participant avatar initial chip.
- **ICS UID format:** `${eventSlug}-${Date.now()}@whenfree.org`

## Key Functions

| Function | Purpose |
|----------|---------|
| `renderBestTimes()` | Scores and ranks time slots; populates `S.bestSlots` |
| `syncActionStates()` | Disables/enables sidebar buttons based on data state |
| `openCalModal(i)` | Opens "Add to Calendar" modal for `S.bestSlots[i]` |
| `buildCalDate(slot)` | Converts slot data to `YYYYMMDD`/`HHMMSS` strings for calendar URLs |
| `downloadIcs(slot, ...)` | Generates RFC 5545 `.ics` blob and triggers download |
| `buildEmailTemplate(bodyHtml, dir)` | Wraps email content in branded HTML template |
| `buildBestTimesEmailHtml()` | Builds localized best-times email (uses `currentLang`) |
| `scheduleNotifyOrganizer(name)` | Debounced (120s) notification to creator when a participant marks cells — only fires on cell marks, not on join |
| `toggleEmailPanel(panelId, btnId, otherPanelId)` | Opens/closes floating email input panels via `position:fixed` |
| `setLang(code)` | Sets language, updates localStorage and URL (`?lang=`) |

## SVG Icon Constants

Button icons declared before `const LANGS`:

```js
const _AR = `<svg ...right arrow...>`;  // LTR forward
const _AL = `<svg ...left arrow...>`;   // LTR back / RTL forward
const _X  = `<svg ...× close...>`;      // dismiss / clear
const _LINK = `<svg ...link icon...>`;  // copy link
```

Use in i18n strings (template literals) rather than Unicode entities.

## Key Details

- **Framework:** Vanilla JS (no build step)
- **Database:** Firebase Firestore (project: `meteor-meet`)
- **Styling:** CSS custom properties (variables), Verde design system
- **Time format:** 24-hour everywhere (`ampm:false` in all `LANGS` entries)
- **No backend** — all logic in `index.html` (Firebase rules handle authorization)
- **Firebase plan:** Blaze (pay-as-you-go) — needed for Cloud Monitoring API. Actual cost: ~$0.
- **Firebase project ID:** `meteor-meet` — **permanent, cannot be renamed.** The ID is hardcoded in the SDK config (`projectId:"meteor-meet"`), all Firestore URLs, and the `daily-report.gs` console links. Only the display name in Firebase Console can be changed cosmetically. Creating a new project would require full data migration — do not suggest it.
- **`.gitignore`:** `.claude/` is ignored — never commit it

## Firestore Event Fields

Each event document stores:
- `createdAt` — Firestore server timestamp (added June 2026; older events lack this field)
- `lastDate` — ISO date string of the latest date in `selectedDates` (e.g. `"2026-07-15"`); `null` for `days` mode events (recurring days of week have no end date)

**Manual cleanup:** To delete expired events, filter Firestore Console → `events` → `lastDate` < today. `null` entries are days-of-week events — review separately. Do not suggest automating this unless the user asks.

## RTL / Layout Architecture

- **`.top-controls`** (desktop lang+theme bar): `position:fixed; left:16px; direction:ltr; transform:translateX(calc(100vw - 100% - 32px)); transition:transform 0.35s ease` — appears at top-right in LTR. `[dir="rtl"] .top-controls{transform:none}` slides it to top-left on Hebrew.
- **`.mobile-top-bar`** and **`.top-controls`**: both have `direction:ltr` to prevent internal flex reorder in RTL.
- **Mobile controls visibility**: `#top-controls` shows on Screen A (mobile). Hidden via JS in both `transitionToB()` and `showScreenB()` when `window.innerWidth <= 640`. Never use CSS `display:none` to hide it globally.
- **Name overlay (join dialog)**: `position:fixed` inside `@media(max-width:640px)` — needed because `#screen-event` has `height:auto` on mobile, making `position:absolute;inset:0` center off-screen.
- **Touch detection**: `navigator.maxTouchPoints > 0` in `applyLang()` swaps `markSub`→`markSubMobile` and `gridHint`→`gridHintMobile` (tap vs drag/click wording).
- **Onboarding modal header**: `.onboard-header` is a `display:flex; justify-content:space-between` row containing `.onboard-lang` (the EN/FR/HE pill) and `.onboard-close` (the ✕ button). The close button is **not** `position:absolute` — it's in normal flow inside the header. Do not make it absolute again; that causes overlap with the lang pill.

## Firestore Security Rules

Rules deployed **2026-06-21** — no longer in Test Mode.

**Security model (no Firebase Auth):**
- `allow read: if true` — events are share-by-link; public reads are intentional
- `allow create` — validates required fields, `participants == {}`, `creatorToken.size() >= 48`, `name.size() <= 200`
- `allow update` — protects immutable fields (`creatorToken`, `createdAt`, `mode`, `selectedDates`, `selectedDays`, `earlierThan`, `laterThan`, `timezone`, `creatorEmail`); only `participants` and `name` can change
- `allow delete: if false` — no client-side event deletion
- Creator-only ops (remove participant, edit title) remain **client-gated only** — server enforcement requires Firebase Auth, which this app doesn't use

**To update rules:** Firebase Console → Firestore → Rules → Publish. No Firebase CLI is configured in this project.

**To verify deployed rules via CLI:**
```powershell
$TOKEN = gcloud auth print-access-token
curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: meteor-meet" `
  "https://firebaserules.googleapis.com/v1/projects/meteor-meet/releases/cloud.firestore"
# Then fetch the rulesetName returned above:
curl -s -H "Authorization: Bearer $TOKEN" -H "x-goog-user-project: meteor-meet" `
  "https://firebaserules.googleapis.com/v1/{rulesetName}"
```

## Security Patterns

- **`escHtml()` is mandatory for all `innerHTML` injection** — any user-supplied string (participant name, event name, etc.) must go through `escHtml()` before being interpolated into an HTML template string. Using `textContent` is always safe and preferred; switch to `innerHTML` only when you need to embed tags (e.g. `<br>` between name parts). The `escHtml` helper is defined near the bottom of the script block.
- **Crypto tokens use `crypto.getRandomValues()`** — never `Math.random()` for anything used as a security identifier. Event slugs: `Uint8Array(5)` → base-36. Creator tokens: `Uint8Array(24)` → hex (192 bits).
- **Firebase scripts are in `<body>`** — the two Firebase CDN `<script>` tags live just before the inline app `<script>` (near line 1546), not in `<head>`. This prevents them from blocking initial HTML render. Do not move them back to `<head>`.
- **GAS mailer is an open relay** — `mailer.gs` `doPost()` accepts any `to_email` with no auth check. The endpoint URL is visible in client JS. If email abuse becomes a concern, add a shared secret in GAS Script Properties and validate it in `doPost`.

## Event Listener Patterns

- **Click-outside handlers**: always use `el.contains(e.target)` not `e.target !== el` — SVG children inside a button will be the `e.target`, not the button itself.
- **mousedown + click double-fire**: on desktop, both `mousedown` and `click` fire for a single tap. To avoid double-toggling, `onCalDown` sets `calMousedownFired = true`; the `click` handler checks that flag and returns early if set. Mobile tap fires only `click` (no `mousedown`), so the click handler handles toggling directly. Pattern: `calDragMode` must always be set (based on current `S.selectedDates.has(dt)`) before calling `applyCalCell`.
- **Calendar drag**: `onCalDown` / `onCalEnter` are attached to each `.cal-cell` via `mousedown` / `mouseenter` in `renderMonthBlock`. Do not remove these — they enable desktop drag-select across multiple dates.

## GAS Deployment

**GAS project:** `https://script.google.com/d/1MCoKYf2EVaueAzpjWAmHdvzubUcj3NqLAXzrBic6oRZgxacpnf44uYBD/edit`

Push + deploy in one command (no GAS editor needed):

```powershell
clasp push --force && clasp deploy --deploymentId AKfycbz7hknVlxm_K7RdFBV1gd7MbBz3KYsq7PQ2UgqHHByTxM2PI2W21T8p3sZ6qIenPMPDNg
```

- `@HEAD` deployment ID: `AKfycbwVGimKBjWg3PRYpkRLPFcW1vbdQV7KxpJepNOwcSzg` (dev/test only)
- Production deployment ID: `AKfycbz7hknVlxm_K7RdFBV1gd7MbBz3KYsq7PQ2UgqHHByTxM2PI2W21T8p3sZ6qIenPMPDNg`

## GAS Daily Report

One-time trigger: select `createTrigger` → Run in GAS editor after deploy.

## Design System — Verde (Material 3-aligned)

### Color Palette

**Light Mode**
- `--bg: #D6EDE4` — page background (saturated mint)
- `--surface: #E9F6F0` — cards, panels
- `--surface2: #D6EDE4` — secondary surface
- `--text: #0B2018` — primary text
- `--muted: #3E5750` — secondary text
- `--muted2: #7E988F` — tertiary text
- `--accent: #00C281` — primary green
- `--primary-ctr: #C7F4E2` — tonal container
- `--on-primary-ctr: #00382A` — text on tonal container
- `--on-primary: #04261B` — text on accent buttons
- `--border: rgba(10, 70, 52, 0.15)` / `--border2: rgba(10, 70, 52, 0.20)`
- `--cell-empty: #ECF8F2` — empty grid cell fill (lighter than bg for clear affordance)

**Dark Mode**
- `--bg: #081C13` — page background
- `--surface: #0F2A1E` / `--surface2: #163526`
- `--text: #D6F0E6` / `--muted: #81B09A` / `--muted2: #5A7D6E`
- `--accent: #00D68F`
- `--primary-ctr: #1A4D38` / `--on-primary-ctr: #7FDBBA`
- `--cell-empty: #1C3D2C` — empty grid cell fill; cells also get `border: 1.5px solid rgba(100,210,160,0.14)` override for shape definition

**Heatmap:** `--heat-1` through `--heat-5` (light → dark variants per mode)

### Typography
- **Display:** `'Figtree', system-ui` — headings, 600–700 weight
- **Body:** `'DM Sans', system-ui` — content, 400–500 weight

### Border Radius
- `--r: 22px` / `--r-sm: 14px` / `--r-xs: 6px` / `--r-pill: 100px`

### i18n
- All strings in `LANGS` object (`en`, `he`, `fr`)
- Language detection: `?lang=` query param → URL path `/en|fr|he` → localStorage → default `en`
- `setLang(code)` updates URL via `history.replaceState`
- Hebrew RTL: `direction:rtl` + `text-align:right` on email content cells (email clients ignore `<html dir>`)
