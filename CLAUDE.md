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
| ~~`mailer.gs`~~ | **Removed** (commit `54482a5`, "Retire GAS mailer web app now that mail runs through the Cloud Function"). Superseded by `functions/index.js`. See Email System section. |
| `functions/index.js` | Three Firebase Cloud Functions, each its own deployment sharing this one source file: `sendMail` (sends all app + `daily-report.gs` emails via ZeptoMail API from `no-reply@whenfree.org`), `storeCreatorEmail` (writes the organizer's email server-side into `eventSecrets/{slug}`), `notifyOrganizer` (looks up that email server-side and sends the "participant responded" notification — the client never sees the address). Auth via `X-WhenFree-Key` header check on all three. Uses `firebase-admin` (lazily initialized — see Security Patterns). URLs: `https://us-central1-meteor-meet.cloudfunctions.net/{sendMail,storeCreatorEmail,notifyOrganizer}`. |
| `daily-report.gs` | GAS — daily DB usage report to `avi.klayman@gmail.com` at midnight IST |
| `cleanup.gs` | GAS — private web-app admin page (`doGet`) to review and delete expired events. Separate deployment from other GAS entry points; see GAS Deployment section. |
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
- **Cleanup admin shortcut:** `cleanup.whenfree.org` → private expired-meeting cleanup page (GAS `cleanup.gs` deployment URL, with `ADMIN_TOKEN` baked into the rule's target). Cloudflare Redirect Rule (Wildcard, 302) on a dedicated proxied DNS record (`A` → `192.0.2.1`, a reserved placeholder IP — the redirect fires before that IP is ever reached). Kept on its own subdomain rather than a path on the apex domain specifically to avoid switching the main `whenfree.org` record to proxied, which would route all live site traffic through Cloudflare and risk breaking GitHub Pages' TLS handling. If `ADMIN_TOKEN` is ever rotated in GAS Script Properties, this rule's target URL must be updated to match.
- **Email forwarding (incoming):** Cloudflare Email Routing catch-all → `avi.klayman@gmail.com`
- **Email sending (outgoing):** ZeptoMail transactional API from `no-reply@whenfree.org` (via the `sendMail` Cloud Function, `functions/index.js`)
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
- **Add to Calendar:** Google Calendar deep-link, Outlook web deep-link (`outlook.live.com/.../compose?rru=addevent`), or `.ics` download (Apple + other apps). Handles `specific` and `days` modes. All three paths use UTC times computed by `wallTimeToUtc()` — the `.ics` emits `DTSTART:...Z` (no `TZID`; Outlook desktop rejects/shifts undefined TZIDs), and the Google URL uses `dates=...Z/...Z` (no `ctz`). Do not reintroduce `TZID` lines or local-time Google dates — the wall-clock path had a midnight bug (slot ending 24:00 produced end-before-start).
- **Per-user colors:** Each participant gets a color for easy identification
- **Dark/light toggle:** Theme switcher with localStorage persistence
- **i18n:** English, Hebrew (RTL), French — toggled via buttons or `?lang=` URL param
- **Language URL params:** `?lang=fr`, `?lang=he`, `?lang=en` — detected on load, updated in URL on change. Works with event hashes: `whenfree.org/?lang=fr#eventSlug`
- **No login required:** Share a link, participants add their name and availability
- **Daily DB report:** Automated midnight email with Firestore event count, reads/writes/deletes vs. free-tier limits, storage usage, and a link (`https://cleanup.whenfree.org/`) to the expired-meeting cleanup page — the short URL means `ADMIN_TOKEN` no longer needs to appear in the email body at all (Cloudflare's redirect rule carries it server-side)
- **Smart disabled states:** `syncActionStates()` disables "Send best times" when no slots exist; re-enables reactively
- **Floating email panels:** Email input panels use `position:fixed` (no layout shift when opened)
- **Onboarding lang picker:** First-time visitors see EN/FR/HE buttons at the top of the help modal — clicking one calls `setLang()` and re-renders the modal content instantly in the chosen language before the user reads it
- **Viewer-local timezone annotation:** The grid is always rendered in the single event-level `S.timezone` (set once by the creator — cell identity is `col:row` grid-position indices, not absolute timestamps, so there's no per-viewer grid reflow). To reduce cross-timezone confusion without touching that data model, `buildGrid()` detects the viewer's browser timezone (`getViewerTz()`) and, only when it differs from `S.timezone`: shows a two-line header above the grid (line 1 "Times shown in X.", line 2 "Your local time zone is Y." — localized EN/FR/HE, `tzShownIn`/`tzYourLocal` i18n keys) and adds a second time-label column to the grid itself. Each timezone's column is headed by its `GMT±H` offset (`.grid-tz-col-head`/`.grid-tz-col-head-viewer`, from `tzAbbrev()`'s `'shortOffset'` mode — not `'short'`, which only returns letter codes like `EDT` for a handful of US zones and falls back to `GMT±H` for everything else, so forcing offset mode keeps the format uniform across all timezones) and holds only that timezone's single time value per row (`.grid-time-label` / `.grid-time-label-viewer`) — no concatenated strings, so the two-columns-not-one-string design also sidesteps the bidi-reordering class of bug entirely (see RTL gotcha below). Purely a display-layer addition — no Firestore/storage changes. Known limitation: in recurring "days of week" mode there's no calendar date, so a slot near midnight can shift to a different weekday for the viewer without the column label reflecting that.

## Email System

- **Sender:** ZeptoMail transactional API, called via three Firebase Cloud Functions (`functions/index.js`: `sendMail`, `storeCreatorEmail`, `notifyOrganizer`) — not GAS. `index.html` calls `sendMail` via `fetch()` (`sendEmailViaGAS()`, despite the name); `daily-report.gs` calls `sendMail` via `UrlFetchApp.fetch()` through its own `sendEmailViaFunction_()` helper. All three functions pass/check an `X-WhenFree-Key` header for a light abuse-deterrent check (`checkAuth()`) — not a real secret, the key is a public constant shipped in `index.html` (`WHENFREE_MAIL_KEY`) and in `daily-report.gs`'s Script Properties (`MAILER_KEY`).
- **Endpoint:** `https://api.zeptomail.com/v1.1/email` (US region) — called server-side by the Cloud Functions, not directly by GAS or the browser.
- **Auth:** `Authorization: <ZEPTO_API_KEY>` — read via `process.env.ZEPTO_API_KEY` in the Cloud Functions (Secret Manager, bound via `--set-secrets` at deploy time — see GAS Deployment / deploy commands below). Never in source code.
- **Per-event send cap:** `checkAndIncrementMailCount_()` in `functions/index.js` caps sends to 100/day per `event_slug` (tracked in `mailCounts/{slug}`, a Firestore collection closed to client reads) — mitigates using the mail relay for bulk spam without restricting recipients, since the invite/best-times panels intentionally let users email arbitrary addresses (a real feature, not a bug). Fails open on any Firestore error so a rate-limiter hiccup can never block real mail delivery. Requests with no `event_slug` (e.g. `daily-report.gs`) share a bucket keyed `unknown` — **not** `__unknown__`; see the reserved-document-ID gotcha below.
- **daily-report.gs:** sends its nightly report and failure-alert emails through `sendMail` via `sendEmailViaFunction_()` — previously used `GmailApp.sendEmail()`, which required the restricted `https://mail.google.com/` OAuth scope and caused the trigger's authorization to silently expire roughly every 7 days on this unverified GAS project (see the trigger-reliability gotcha below). Removing that scope by moving to the Cloud Function eliminates that failure mode.
- **Organizer email storage (added 2026-08-19):** the organizer's email is **not** stored on the public `events/{slug}` document (Firestore has `allow read: if true` there, so anything on it is world-readable). `createEvent()` in `index.html` calls `storeCreatorEmail` right after creating the event, which verifies the request's `creatorToken` matches the event doc, then writes the email into `eventSecrets/{slug}` — a collection with `allow read, write: if false` in Firestore rules, reachable only via the Cloud Functions' Admin SDK (which bypasses rules). See the Security Patterns entry below for why this changed and the full gotcha writeup.
- **Template:** `buildEmailTemplate(bodyHtml, dir)` — dark forest header with calendar-check icon + "WhenFree" wordmark, verde palette card, sage background
- **Email types:** creator confirmation, invite to mark availability, best times, organizer notification (all localized EN/HE/FR with RTL support)
- **Organizer notification:** `scheduleNotifyOrganizer(name)` — debounced 120s after last cell mark (not on join) — calls `fireNotifyOrganizer()`, which posts to the `notifyOrganizer` Cloud Function (`eventSlug` + pre-built subject/body only, no email address) rather than sending client-side. Sends branded HTML with participant avatar initial chip.
- **ICS UID format:** `${eventSlug}-${Date.now()}@whenfree.org`

## Key Functions

| Function | Purpose |
|----------|---------|
| `renderBestTimes()` | Scores and ranks time slots; populates `S.bestSlots` |
| `syncActionStates()` | Disables/enables sidebar buttons based on data state |
| `openCalModal(i)` | Opens "Add to Calendar" modal for `S.bestSlots[i]` |
| `wallTimeToUtc(y, m, d, mins, tz)` | Converts wall-clock time in an IANA timezone to a UTC `Date` via `Intl.DateTimeFormat` (2-pass correction for DST edges; `hourCycle:'h23'` — `hour12:false` can render midnight as "24"). `mins >= 1440` rolls to next day. |
| `buildCalDate(slot)` | Converts slot data to local `YYYYMMDD`/`HHMMSS` strings plus UTC forms: `startUtc`/`endUtc` (ICS `YYYYMMDDTHHMMSSZ`) and `startIso`/`endIso` (for the Outlook URL) |
| `downloadIcs(slot, startUtc, endUtc)` | Generates RFC 5545 `.ics` blob (UTC `DTSTART`/`DTEND`) and triggers download |
| `buildEmailTemplate(bodyHtml, dir)` | Wraps email content in branded HTML template |
| `buildBestTimesEmailHtml()` | Builds localized best-times email (uses `currentLang`) |
| `scheduleNotifyOrganizer(name)` | Debounced (120s) notification to creator when a participant marks cells — only fires on cell marks, not on join |
| `storeCreatorEmail(eventSlug, creatorEmail, creatorToken)` | Posts the organizer's email to the `storeCreatorEmail` Cloud Function right after event creation, so it lands in `eventSecrets/{slug}` instead of the public event doc |
| `toggleEmailPanel(panelId, btnId, otherPanelId)` | Opens/closes floating email input panels via `position:fixed` |
| `setLang(code)` | Sets language, updates localStorage and URL (`?lang=`) |
| `getViewerTz()` | Returns the browser's IANA timezone (`Intl.DateTimeFormat().resolvedOptions().timeZone`) |
| `refDateForWeekday(dayLabel)` | Resolves a "days" mode weekday label to the next upcoming calendar date — shared by `buildCalDate()` and the grid's viewer-tz row-label conversion |
| `tzFullName(tz, refDate)` | Long localized timezone name (e.g. "Central European Summer Time") via `Intl.DateTimeFormat(..., {timeZoneName:'long'})`, used in the grid's tz header |
| `minsToViewerLabel(refDate, mins, viewerTz)` | Converts an event-tz wall-clock minutes value to the viewer's local-time label string, via `wallTimeToUtc()` |

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

**Does not store `creatorEmail`** (since 2026-08-19) — it lives in the separate `eventSecrets/{slug}` collection instead (`{creatorEmail}`, one doc per event, `allow read, write: if false`), written by the `storeCreatorEmail` Cloud Function. All 71 pre-existing events that had `creatorEmail` on the public doc were migrated (copy-verify-delete, one-time script) the same day; `events` docs created before then should have no residual field either. See the Security Patterns entry below for why.

**`mailCounts/{slug}`** — one doc per event, `{date, count}`, used only by the Cloud Functions' per-event send-rate cap (see Email System). Also `allow read, write: if false`.

**Cleanup tool:** `cleanup.gs` provides a private admin web page to review candidates and delete them after typing a confirm phrase. It flags two buckets: (1) dated events where `lastDate` < today, (2) recurring (`days` mode, `lastDate == null`) events with no `createdAt` for 90+ days. Caveat: events created before June 2026 predate `createdAt` entirely, so old abandoned recurring events from before then won't surface automatically — review those manually in Firestore Console. Manual fallback (still valid): Firestore Console → `events` → filter `lastDate` < today.

## RTL / Layout Architecture

- **`.top-controls`** (desktop lang+theme bar): `position:fixed; left:16px; direction:ltr; transform:translateX(calc(100vw - 100% - 32px)); transition:transform 0.35s ease` — appears at top-right in LTR. `[dir="rtl"] .top-controls{transform:none}` slides it to top-left on Hebrew.
- **`.mobile-top-bar`** and **`.top-controls`**: both have `direction:ltr` to prevent internal flex reorder in RTL.
- **Mobile controls visibility**: `#top-controls` shows on Screen A (mobile). Hidden via JS in both `transitionToB()` and `showScreenB()` when `window.innerWidth <= 640`. Never use CSS `display:none` to hide it globally.
- **Name overlay (join dialog)**: `position:fixed` inside `@media(max-width:640px)` — needed because `#screen-event` has `height:auto` on mobile, making `position:absolute;inset:0` center off-screen.
- **Touch detection**: `navigator.maxTouchPoints > 0` in `applyLang()` swaps `markSub`→`markSubMobile` and `gridHint`→`gridHintMobile` (tap vs drag/click wording).
- **Onboarding modal header**: `.onboard-header` is a `display:flex; justify-content:space-between` row containing `.onboard-lang` (the EN/FR/HE pill) and `.onboard-close` (the ✕ button). The close button is **not** `position:absolute` — it's in normal flow inside the header. Do not make it absolute again; that causes overlap with the lang pill.
- **Multiple LTR fragments in one RTL text node get reordered**: an earlier version of the cross-timezone row label concatenated two separate time strings (event tz + viewer tz, e.g. `09:00 · 10:00`) into one text node. Under Hebrew's `dir="rtl"`, the bidi algorithm reordered the two fragments (`10:00 · 09:00`) even though each fragment alone renders fine. `.grid-time-label` keeps `direction:ltr` as a defensive baseline, but the real fix was redesigning the feature to use two separate single-value grid columns (`.grid-time-label` / `.grid-time-label-viewer`, one GMT-offset value each) instead of one concatenated string — sidestepping the bidi class of bug entirely rather than just patching around it. Watch for this pattern anywhere two+ LTR tokens are joined into one string inside an RTL-rendered element; prefer separate elements over concatenation when the content can render under Hebrew.

## Firestore Security Rules

Rules deployed **2026-06-21**, updated **2026-08-19** (removed `creatorEmail` from `events`; added `eventSecrets`/`mailCounts`) — no longer in Test Mode.

**Security model (no Firebase Auth):**
- `events/{slug}`:
  - `allow read: if true` — events are share-by-link; public reads are intentional
  - `allow create` — validates required fields, `participants == {}`, `creatorToken.size() >= 48`, `name.size() <= 200`. **Does not include `creatorEmail`** — do not add it back; that field no longer belongs on this doc (see Firestore Event Fields).
  - `allow update` — protects immutable fields (`creatorToken`, `createdAt`, `mode`, `selectedDates`, `selectedDays`, `earlierThan`, `laterThan`, `timezone`); only `participants` and `name` can change. If you ever add a field back to `events` that isn't meant to be updatable, add its immutability check here too — but never reference a field that a current-schema document might not have (`resource.data.foo` **throws** if `foo` doesn't exist on the doc, it does not evaluate to `null`; this is exactly what broke when `creatorEmail` was removed from `create` but the old equality check in `update` still referenced it unconditionally — every update to a newly-created event would have thrown until that line was also deleted).
  - `allow delete: if false` — no client-side event deletion
- `eventSecrets/{slug}` and `mailCounts/{slug}`: `allow read, write: if false` — fully closed to client SDKs, reachable only via the Cloud Functions' Admin SDK (which bypasses rules entirely). See Firestore Event Fields.
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
- **Mail Cloud Function has a shared-secret gate, not an open relay** — `functions/index.js`'s `sendMail`/`storeCreatorEmail`/`notifyOrganizer` all check an `X-WhenFree-Key` header (`checkAuth()`) and return 403 on mismatch. The key is a public constant in `index.html` (not a real secret — it's shipped to every browser), so this is a light abuse-deterrent, not strong auth. `to_email` on `sendMail` is still deliberately unrestricted once the header matches — the invite/best-times panels legitimately email arbitrary addresses, so a recipient allowlist isn't viable; the actual abuse mitigation is the per-event daily send cap (see Email System). (Historical note: the predecessor `mailer.gs` GAS webapp truly had no auth check at all — this was fixed as part of the Cloud Function migration.)
- **Organizer email is not public data (fixed 2026-08-19)** — `creatorEmail` used to be written straight into the public `events/{slug}` Firestore doc (`allow read: if true`), so on every page load `S.creatorEmail` was populated from Firestore for *every visitor*, not only the creator, and `fireNotifyOrganizer()` then emailed the organizer directly from any participant's browser session — meaning any participant, or anyone the link leaked to, could read the organizer's email straight out of loaded page state or a raw Firestore read. Fixed by moving storage into `eventSecrets/{slug}` (client-unreadable; see Firestore Security Rules) via the `storeCreatorEmail` Cloud Function, and having `notifyOrganizer` look the address up server-side instead of the client sending it. **Watch for:** any future field meant to be creator-only/private must go into `eventSecrets` (or a similar closed collection), never onto `events` — Firestore has no field-level read rules, so anything on a publicly-readable document is fully public, regardless of whether the UI happens to only display it to the creator.
- **Firestore reserves document IDs matching `/^__.*__\$/`** (starts *and* ends with double underscore) — writes/reads against an ID like `__unknown__` or `__curl_test__` fail with `INVALID_ARGUMENT: ... reserved`. Bit us twice in one session: once testing `storeCreatorEmail` with a throwaway ID (harmless, just a bad test-ID choice), and once for real — `checkAndIncrementMailCount_()`'s fallback bucket for requests with no `event_slug` (i.e. `daily-report.gs`'s calls to `sendMail`) was originally named `__unknown__`, and since that call sat outside `sendMail`'s try/catch, the resulting Firestore error was an *unhandled* rejection that the Functions Framework turned into a bare 500 with no JSON body — which is exactly what broke the daily report's mail send after this was first deployed. Fixed by renaming the bucket to `unknown` and wrapping the whole rate-limit check in try/catch that fails open (returns "under cap") on any Firestore error, so a rate-limiter problem can never take down real mail delivery again. **Pattern to watch for:** never let a secondary/best-effort check (rate limiting, logging, analytics) sit outside the primary try/catch of a request handler — an unrelated failure there shouldn't be able to fail the whole request.

## Event Listener Patterns

- **Click-outside handlers**: always use `el.contains(e.target)` not `e.target !== el` — SVG children inside a button will be the `e.target`, not the button itself.
- **mousedown + click double-fire**: on desktop, both `mousedown` and `click` fire for a single tap. To avoid double-toggling, `onCalDown` sets `calMousedownFired = true`; the `click` handler checks that flag and returns early if set. Mobile tap fires only `click` (no `mousedown`), so the click handler handles toggling directly. Pattern: `calDragMode` must always be set (based on current `S.selectedDates.has(dt)`) before calling `applyCalCell`.
- **Calendar drag**: `onCalDown` / `onCalEnter` are attached to each `.cal-cell` via `mousedown` / `mouseenter` in `renderMonthBlock`. Do not remove these — they enable desktop drag-select across multiple dates.

## GAS Deployment

**GAS project:** `https://script.google.com/d/1MCoKYf2EVaueAzpjWAmHdvzubUcj3NqLAXzrBic6oRZgxacpnf44uYBD/edit`

For `daily-report.gs` (or any shared file) changes, a plain push is enough — `sendDailyReport`'s time-based trigger runs against `@HEAD`, confirmed 2026-08-06 (manual run + real trigger both picked up a same-day push with no redeploy step):

```powershell
clasp push --force
```

`cleanup.gs` is different: `cleanup.whenfree.org` serves a specific **pinned** deployment version (see Admin cleanup deployment ID below), not `@HEAD`. If you change `cleanup.gs`, push first, then redeploy that specific ID to bump what's actually live:

```powershell
clasp push --force && clasp deploy --deploymentId AKfycbwrdVpTaIvbtAH07eul9a6aJHQNSr59u5dTQIhoPy_boDLtYjTJhiTUxVuPfyErWQlHAg
```

Confirmed live deployments (via `clasp deployments`, 2026-08-06):
- `@HEAD` deployment ID: `AKfycbwVGimKBjWg3PRYpkRLPFcW1vbdQV7KxpJepNOwcSzg` (dev/test only)
- Admin cleanup deployment ID: `AKfycbwrdVpTaIvbtAH07eul9a6aJHQNSr59u5dTQIhoPy_boDLtYjTJhiTUxVuPfyErWQlHAg` @23 (bumped 2026-08-19 — added constant-time token compare + failed-attempt lockout) — serves `cleanup.gs`'s `doGet` privately (Execute as: Me, Access: Only myself). Raw URL: `https://script.google.com/macros/s/AKfycbwrdVpTaIvbtAH07eul9a6aJHQNSr59u5dTQIhoPy_boDLtYjTJhiTUxVuPfyErWQlHAg/exec?token=<ADMIN_TOKEN>` (token stored in Script Properties as `ADMIN_TOKEN`) — but use the short `https://cleanup.whenfree.org/` link day-to-day (see Domain & Redirects). If this deployment is ever recreated (new deployment ID), the Cloudflare redirect rule's target URL must be updated to match.
- `daily-report.gs`'s mail key (used to call `sendMail`) now reads from Script Properties as `MAILER_KEY` (added 2026-08-19) instead of being hardcoded in source — matches its sibling secrets (`API_KEY`, `HEALTHCHECK_PING_URL`) in the same config block. If this GAS project is ever re-provisioned, `MAILER_KEY` must be set to the same value as `WHENFREE_MAIL_KEY` in `index.html`, or `daily-report.gs`'s mail calls will fail `checkAuth()`.

The old "Production deployment ID" (`AKfycbz7hknVlxm...`, which served `mailer.gs`'s `doPost`) is **no longer among the project's live deployments** — confirmed via `clasp deployments` on 2026-08-06, it was already removed (likely as part of the `mailer.gs` retirement, commit `54482a5`). No action needed; noting this so nobody goes looking for a deployment ID that no longer exists.

## Cloud Functions Deployment

No Firebase CLI configured in this project — deploy via `gcloud`, one command per function (all three share `functions/` as source; only `--entry-point` differs). Each deploy triggers a Cloud Build that runs `npm install` from `functions/package.json` automatically — no manual install step needed before deploying. Redeploy **every** function that shares `functions/index.js` whenever that file changes, not just the one you're adding/fixing.

```powershell
gcloud functions deploy sendMail --gen2 --runtime=nodejs20 --region=us-central1 `
  --trigger-http --allow-unauthenticated --source=functions/ --entry-point=sendMail `
  --set-secrets='ZEPTO_API_KEY=zepto-api-key:latest,WHENFREE_MAIL_KEY=whenfree-mail-key:latest' `
  --max-instances=5 --project=meteor-meet

gcloud functions deploy storeCreatorEmail --gen2 --runtime=nodejs20 --region=us-central1 `
  --trigger-http --allow-unauthenticated --source=functions/ --entry-point=storeCreatorEmail `
  --set-secrets='ZEPTO_API_KEY=zepto-api-key:latest,WHENFREE_MAIL_KEY=whenfree-mail-key:latest' `
  --max-instances=5 --project=meteor-meet

gcloud functions deploy notifyOrganizer --gen2 --runtime=nodejs20 --region=us-central1 `
  --trigger-http --allow-unauthenticated --source=functions/ --entry-point=notifyOrganizer `
  --set-secrets='ZEPTO_API_KEY=zepto-api-key:latest,WHENFREE_MAIL_KEY=whenfree-mail-key:latest' `
  --max-instances=5 --project=meteor-meet
```

`--allow-unauthenticated` is required for a public HTTP endpoint — the `X-WhenFree-Key` header check inside each function is the actual gate, not IAM. All three run as `935791631512-compute@developer.gserviceaccount.com` (the default compute service account), which already has sufficient Firestore access — confirmed working 2026-08-19, no extra IAM binding was needed for `storeCreatorEmail`/`notifyOrganizer`'s Admin SDK reads/writes.

**Quick isolated verification** (before touching the client) — expect `403 forbidden`, proves auth + Firestore lookup work without touching real data:
```powershell
curl -i -X POST https://us-central1-meteor-meet.cloudfunctions.net/storeCreatorEmail `
  -H "Content-Type: text/plain" -H "X-WhenFree-Key: <WHENFREE_MAIL_KEY value>" `
  -d '{\"eventSlug\":\"sometestslug123\",\"creatorEmail\":\"test@example.com\",\"creatorToken\":\"bad-token\"}'
```
Avoid `__`-wrapped test IDs (e.g. `__curl_test__`) — see the reserved-document-ID gotcha in Security Patterns.

## GAS Daily Report

One-time trigger: select `createTrigger` → Run in GAS editor after deploy.

**Monitoring:** A healthchecks.io check ("WhenFree Daily Report") pings on every run — plain ping on success, `/fail` suffix on error — via `pingHealthcheck_()`. Its ping URL lives in Script Properties as `HEALTHCHECK_PING_URL`, never in source/docs. Because it alerts on a *missed* ping (not a reported failure), it also catches the case where the trigger silently doesn't execute at all — see the restricted-OAuth-scope gotcha below. Any time `oauthScopes` changes in `appsscript.json`, proactively re-run `createTrigger()` rather than waiting to notice a missing email or an inactive healthchecks.io alert.

**Gotcha — restricted OAuth scopes silently kill the trigger (root-caused and fixed 2026-08-06):** the daily trigger went dark for 5 consecutive nights (2026-08-01 through 2026-08-06) with zero trace — no execution log entry, no error, no `FAILED` email, no `/fail` ping, trigger still correctly installed and enabled the whole time. Initial hypothesis (2026-08-02, after seeing only one missed night) was a harmless one-off Google-side trigger skip, which is why the healthchecks.io **grace window was widened to 2 days** (Period=2 days, as of 2026-08-02) — that widening is still in place as a sane safety margin, but it was not the real fix. Checking Gmail directly (not just the Executions dashboard) revealed the outage was 5 nights long, not 1, which pointed to the actual cause: this GAS project uses **restricted/sensitive OAuth scopes** (`https://mail.google.com/` via `GmailApp`, `.../auth/datastore`) and has never completed Google's app-verification process, so granted authorization silently expires roughly every 7 days — Google's trigger service can't even invoke the script on an expired grant, which is why there's no execution record at all, not even a failed one. The `oauthScopes` change on 2026-07-25 (adding `datastore`) forced a fresh authorization that then expired ~7 days later, right when the trigger went dark. **Fix:** `daily-report.gs` no longer uses `GmailApp` — it sends mail via the ZeptoMail Cloud Function instead (see Email System section), and `https://mail.google.com/` was removed from `oauthScopes` entirely. The `datastore` scope is still present (needed by `cleanup.gs`) and may still be subject to this same periodic expiry, but that only affects a manually-opened admin tool, not a silent background trigger — a far more forgiving failure mode. **Watch for:** if the daily trigger goes silent again with the exact same signature (no execution record, healthchecks.io stays Down with no recovery), check whether `sendDailyReport`/`createTrigger` needs an interactive re-authorization via the Apps Script editor before assuming it's another Google-side flake.

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
