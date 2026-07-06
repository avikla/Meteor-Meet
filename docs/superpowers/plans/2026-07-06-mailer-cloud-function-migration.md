# Mailer Cloud Function Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the broken GAS mailer web app with a Cloud Functions 2nd gen HTTP function so WhenFree's transactional email (creator confirmation, invite/link, best-times, organizer notification) works again, with identical app behavior.

**Architecture:** A single `functions/index.js` Cloud Function (`sendMail`), deployed via `gcloud functions deploy` into the existing `meteor-meet` GCP project, relays requests to ZeptoMail exactly as `mailer.gs` did. `index.html` swaps its endpoint constant and adds one auth header; no other client logic changes.

**Tech Stack:** Node.js 20 (Cloud Functions 2nd gen runtime), `@google-cloud/functions-framework` (local dev only), Node's built-in `node:test` runner, `gcloud` CLI, Google Secret Manager, ZeptoMail HTTP API.

## Global Constraints

- Runtime: Node.js 20 (`--runtime=nodejs20`).
- Region: `us-central1`.
- CORS: `Access-Control-Allow-Origin: https://whenfree.org` only.
- Cost cap: `--max-instances=5` on every deploy.
- Client keeps `Content-Type: text/plain` on the fetch call (avoids CORS preflight — do not change to `application/json`).
- Secrets: `zepto-api-key` and `whenfree-mail-key`, both in Secret Manager, bound via `--set-secrets` (never via `firebase-functions`/`defineSecret`).
- No `firebase-functions` or `firebase-tools` dependency anywhere in this migration.
- Sender identity unchanged: `no-reply@whenfree.org` / display name `WhenFree`.
- Alert recipient unchanged: `avi.klayman@gmail.com`.
- `daily-report.gs` is out of scope — do not touch it.

---

### Task 1: Pure helper functions with unit tests

**Files:**
- Create: `functions/package.json`
- Create: `functions/index.js`
- Test: `functions/index.test.js`
- Modify: `.gitignore`

**Interfaces:**
- Produces: `checkAuth(req)` → `boolean`. `req` is any object with a `.get(headerName)` method.
- Produces: `buildZeptoPayload({ to_email, event_name, meeting_url, subject, body, html_body })` → `{ from, to, subject, htmlbody, textbody }`.
- Both exported via `module.exports` from `functions/index.js`.

- [ ] **Step 1: Add `functions/node_modules/` to `.gitignore`**

Append to `c:\Users\Avi\Desktop\Backup to cloud\Follow-up Actual\Claude Code\projects\whenfree\.gitignore`:

```
functions/node_modules/
```

- [ ] **Step 2: Create `functions/package.json`**

```json
{
  "name": "whenfree-mailer",
  "version": "1.0.0",
  "private": true,
  "main": "index.js",
  "engines": { "node": "20" },
  "scripts": {
    "test": "node --test",
    "start": "npx @google-cloud/functions-framework --target=sendMail"
  },
  "devDependencies": {
    "@google-cloud/functions-framework": "^3.4.0"
  }
}
```

- [ ] **Step 3: Write the failing test**

Create `functions/index.test.js`:

```js
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAuth, buildZeptoPayload } = require('./index.js');

test('checkAuth accepts matching header', () => {
  process.env.WHENFREE_MAIL_KEY = 'test-key-123';
  const req = { get: (name) => (name === 'X-WhenFree-Key' ? 'test-key-123' : undefined) };
  assert.equal(checkAuth(req), true);
});

test('checkAuth rejects missing header', () => {
  process.env.WHENFREE_MAIL_KEY = 'test-key-123';
  const req = { get: () => undefined };
  assert.equal(checkAuth(req), false);
});

test('checkAuth rejects wrong header value', () => {
  process.env.WHENFREE_MAIL_KEY = 'test-key-123';
  const req = { get: () => 'wrong-value' };
  assert.equal(checkAuth(req), false);
});

test('buildZeptoPayload uses provided subject/body/html_body when present', () => {
  const payload = buildZeptoPayload({
    to_email: 'a@example.com',
    event_name: 'Test Event',
    meeting_url: 'https://whenfree.org/e/abc',
    subject: 'Custom subject',
    body: 'Custom text',
    html_body: '<p>Custom html</p>',
  });
  assert.equal(payload.to[0].email_address.address, 'a@example.com');
  assert.equal(payload.subject, 'Custom subject');
  assert.equal(payload.textbody, 'Custom text');
  assert.equal(payload.htmlbody, '<p>Custom html</p>');
  assert.equal(payload.from.address, 'no-reply@whenfree.org');
});

test('buildZeptoPayload falls back to default subject/body/html_body when absent', () => {
  const payload = buildZeptoPayload({
    to_email: 'b@example.com',
    event_name: 'Fallback Event',
    meeting_url: 'https://whenfree.org/e/xyz',
  });
  assert.equal(payload.subject, 'Your meeting link: Fallback Event');
  assert.match(payload.textbody, /https:\/\/whenfree\.org\/e\/xyz/);
  assert.match(payload.htmlbody, /https:\/\/whenfree\.org\/e\/xyz/);
});
```

- [ ] **Step 4: Run the test to verify it fails**

Run (from `functions/`): `node --test`
Expected: FAIL — `Cannot find module './index.js'` (file doesn't exist yet).

- [ ] **Step 5: Write minimal implementation**

Create `functions/index.js`:

```js
'use strict';

const FROM = { address: 'no-reply@whenfree.org', name: 'WhenFree' };

function checkAuth(req) {
  return req.get('X-WhenFree-Key') === process.env.WHENFREE_MAIL_KEY;
}

function buildZeptoPayload({ to_email, event_name, meeting_url, subject, body, html_body }) {
  return {
    from: FROM,
    to: [{ email_address: { address: to_email } }],
    subject: subject || `Your meeting link: ${event_name}`,
    htmlbody: html_body || `<p>Hi,</p><p>Here is your meeting link: <a href="${meeting_url}">${meeting_url}</a></p>`,
    textbody: body || `Hi,\n\nHere is your meeting link:\n${meeting_url}`,
  };
}

module.exports = { checkAuth, buildZeptoPayload, FROM };
```

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test`
Expected: PASS — 5 tests, 0 failures.

- [ ] **Step 7: Commit**

```bash
git add functions/package.json functions/index.js functions/index.test.js .gitignore
git commit -m "Add pure helper functions for mailer Cloud Function with unit tests"
```

---

### Task 2: `sendMail` HTTP handler and failure-alert path

**Files:**
- Modify: `functions/index.js`

**Interfaces:**
- Consumes: `checkAuth(req)`, `buildZeptoPayload(fields)`, `FROM` from Task 1.
- Produces: `sendMail(req, res)` — async, functions-framework-compatible handler (exported as `exports.sendMail`). `req.body` is a plain object with `{ to_email, event_name, meeting_url, subject, body, html_body }`; `res` has `.set(header, value)`, `.status(code)`, `.json(obj)`.
- Produces: `sendAlert(toEmail, subject, detail)` — async, no return value, best-effort (never throws).

- [ ] **Step 1: Add `sendAlert` and `sendMail` to `functions/index.js`**

Append to `functions/index.js` (before the `module.exports` line, then update that line):

```js
const ZEPTO_ENDPOINT = 'https://api.zeptomail.com/v1.1/email';
const ALERT_EMAIL = 'avi.klayman@gmail.com';
const ALLOWED_ORIGIN = 'https://whenfree.org';

async function sendAlert(toEmail, subject, detail) {
  await fetch(ZEPTO_ENDPOINT, {
    method: 'POST',
    headers: {
      'Authorization': process.env.ZEPTO_API_KEY,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: FROM,
      to: [{ email_address: { address: ALERT_EMAIL } }],
      subject: 'WhenFree · Mail send failed',
      textbody: `To: ${toEmail}\nSubject: ${subject}\n\nDetail:\n${detail}`,
    }),
  }).catch(() => {});
}

async function sendMail(req, res) {
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);

  if (!checkAuth(req)) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return;
  }

  const { to_email, subject } = req.body;
  const payload = buildZeptoPayload(req.body);

  try {
    const response = await fetch(ZEPTO_ENDPOINT, {
      method: 'POST',
      headers: {
        'Authorization': process.env.ZEPTO_API_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    const bodyText = await response.text();
    if (response.status < 200 || response.status >= 300) {
      await sendAlert(to_email, subject, bodyText);
      res.status(200).json({ ok: false, error: `ZeptoMail HTTP ${response.status}`, detail: bodyText });
      return;
    }

    const result = JSON.parse(bodyText);
    res.status(200).json({ ok: true, messageId: result.request_id });
  } catch (err) {
    await sendAlert(to_email, subject, err.message);
    res.status(200).json({ ok: false, error: err.message });
  }
}

module.exports = { checkAuth, buildZeptoPayload, sendMail, FROM };
```

- [ ] **Step 2: Run unit tests to confirm no regression**

Run (from `functions/`): `node --test`
Expected: PASS — same 5 tests as Task 1, still 0 failures (this step adds no new automated tests, since `sendMail` does real network I/O — it's verified locally in Step 3-5 below and live in Task 3).

- [ ] **Step 3: Install local dev dependency**

Run (from `functions/`): `npm install`
Expected: installs `@google-cloud/functions-framework` into `functions/node_modules/`.

- [ ] **Step 4: Start the function locally and verify the auth check**

Run (from `functions/`, in one terminal): `WHENFREE_MAIL_KEY=localtest npm start`
Expected: prints `Serving function...` and listens on port 8080.

In a second terminal:

```bash
curl -s -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -d '{"to_email":"a@example.com","event_name":"Test","meeting_url":"https://whenfree.org/e/abc"}'
```

Expected: `{"ok":false,"error":"forbidden"}` (no `X-WhenFree-Key` header sent).

- [ ] **Step 5: Verify the ZeptoMail relay path reaches the network**

With the local server from Step 4 still running:

```bash
curl -s -X POST http://localhost:8080 \
  -H "Content-Type: application/json" \
  -H "X-WhenFree-Key: localtest" \
  -d '{"to_email":"a@example.com","event_name":"Test","meeting_url":"https://whenfree.org/e/abc","subject":"Test"}'
```

Expected: `{"ok":false,"error":"ZeptoMail HTTP 401",...}` — the auth check passed (no `"forbidden"`), and the request reached ZeptoMail, which rejected it because `ZEPTO_API_KEY` isn't set locally. This confirms the handler's request/response wiring without needing the real secret or sending real mail. Stop the local server (Ctrl+C) once confirmed.

- [ ] **Step 6: Commit**

```bash
git add functions/index.js
git commit -m "Implement sendMail Cloud Function handler with ZeptoMail relay and failure alerts"
```

---

### Task 3: Provision secrets and deploy to Cloud Functions

**Files:** none (infrastructure only — no repo changes)

**Interfaces:**
- Consumes: `functions/` directory from Tasks 1-2 as deploy source, entry point `sendMail`.
- Produces: a live HTTPS URL of the form `https://us-central1-meteor-meet.cloudfunctions.net/sendMail`, and a `whenfree-mail-key` secret value that Task 4 will paste into `index.html`.

- [ ] **Step 1: Create the `zepto-api-key` secret**

The real ZeptoMail token is already stored as the GAS Script Property `ZEPTO_API_KEY` (Apps Script editor → Project Settings → Script Properties) — retrieve it there. Do not paste it into chat or any committed file.

```bash
printf '%s' "<PASTE_THE_REAL_ZEPTOMAIL_TOKEN_HERE>" | gcloud secrets create zepto-api-key \
  --data-file=- --project=meteor-meet --replication-policy=automatic
```

Expected: `Created secret [zepto-api-key].`

- [ ] **Step 2: Generate and create the `whenfree-mail-key` secret**

```bash
openssl rand -hex 24
```

Expected: a 48-character hex string printed to stdout. Copy it — it's needed again in Task 4.

```bash
printf '%s' "<PASTE_THE_HEX_STRING_FROM_ABOVE>" | gcloud secrets create whenfree-mail-key \
  --data-file=- --project=meteor-meet --replication-policy=automatic
```

Expected: `Created secret [whenfree-mail-key].`

- [ ] **Step 3: Deploy the function**

Run from the repo root (`c:\Users\Avi\Desktop\Backup to cloud\Follow-up Actual\Claude Code\projects\whenfree`):

```bash
gcloud functions deploy sendMail \
  --gen2 --runtime=nodejs20 --region=us-central1 \
  --trigger-http --allow-unauthenticated \
  --source=functions/ --entry-point=sendMail \
  --set-secrets='ZEPTO_API_KEY=zepto-api-key:latest,WHENFREE_MAIL_KEY=whenfree-mail-key:latest' \
  --max-instances=5 --project=meteor-meet
```

Expected: deployment succeeds and prints a `url:` field, e.g. `https://us-central1-meteor-meet.cloudfunctions.net/sendMail`. Record this URL — it's needed in Task 4.

- [ ] **Step 4: Verify the auth check against the live URL**

```bash
curl -s -X POST "<THE_DEPLOYED_URL_FROM_STEP_3>" \
  -H "Content-Type: application/json" \
  -d '{"to_email":"avi.klayman@gmail.com","event_name":"Deploy Test","meeting_url":"https://whenfree.org"}'
```

Expected: `{"ok":false,"error":"forbidden"}`.

- [ ] **Step 5: Verify a real send against the live URL**

```bash
curl -s -X POST "<THE_DEPLOYED_URL_FROM_STEP_3>" \
  -H "Content-Type: application/json" \
  -H "X-WhenFree-Key: <THE_HEX_STRING_FROM_STEP_2>" \
  -d '{"to_email":"avi.klayman@gmail.com","event_name":"Deploy Test","meeting_url":"https://whenfree.org","subject":"WhenFree Cloud Function deploy test"}'
```

Expected: `{"ok":true,"messageId":"..."}`, and an email titled "WhenFree Cloud Function deploy test" arrives at avi.klayman@gmail.com within a minute.

---

### Task 4: Point the client at the new endpoint

**Files:**
- Modify: `index.html:1619` (constant definition)
- Modify: `index.html:2848-2863` (`sendEmailViaGAS`)

**Interfaces:**
- Consumes: the deployed URL and `whenfree-mail-key` value from Task 3.
- No change to `sendEmailViaGAS`'s own signature or callers (`sendCreatorConfirmationEmail`, `scheduleNotifyOrganizer`, `sendToAllChips` are untouched).

- [ ] **Step 1: Replace the endpoint constant**

In `index.html`, replace:

```js
const GAS_MAILER_URL = 'https://script.google.com/macros/s/AKfycbz7hknVlxm_K7RdFBV1gd7MbBz3KYsq7PQ2UgqHHByTxM2PI2W21T8p3sZ6qIenPMPDNg/exec';
```

with:

```js
const MAILER_FUNCTION_URL = '<THE_DEPLOYED_URL_FROM_TASK_3>';
const WHENFREE_MAIL_KEY = '<THE_HEX_STRING_FROM_TASK_3>';
```

- [ ] **Step 2: Add the header and switch the URL in `sendEmailViaGAS`**

Replace:

```js
async function sendEmailViaGAS(toEmail, subject, body, htmlBody, eventName, meetingUrl) {
  const res = await fetch(GAS_MAILER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      to_email: toEmail,
      event_name: eventName,
      meeting_url: meetingUrl,
      subject,
      ...(body && { body }),
      ...(htmlBody && { html_body: htmlBody }),
    }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'send failed');
}
```

with:

```js
async function sendEmailViaGAS(toEmail, subject, body, htmlBody, eventName, meetingUrl) {
  const res = await fetch(MAILER_FUNCTION_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'X-WhenFree-Key': WHENFREE_MAIL_KEY },
    body: JSON.stringify({
      to_email: toEmail,
      event_name: eventName,
      meeting_url: meetingUrl,
      subject,
      ...(body && { body }),
      ...(htmlBody && { html_body: htmlBody }),
    }),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(json.error || 'send failed');
}
```

(Function name `sendEmailViaGAS` is left as-is — renaming it would touch every call site for no functional benefit; YAGNI.)

- [ ] **Step 3: Confirm no leftover references to the old endpoint**

Run: `grep -n "GAS_MAILER_URL\|script.google.com/macros" index.html`
Expected: no matches.

- [ ] **Step 4: Commit and push**

```bash
git add index.html
git commit -m "Point mailer calls at the new Cloud Function instead of the broken GAS web app"
git push
```

GitHub Pages redeploys `whenfree.org` automatically on push to `main`.

---

### Task 5: Live end-to-end verification

**Files:** none (manual verification only)

**Interfaces:** none — this task validates Tasks 3-4's deliverables against the real production site.

- [ ] **Step 1: Verify creator confirmation email**

Wait for the GitHub Pages deploy to finish (check the Actions tab or just wait ~1 minute), then open `https://whenfree.org`, create a test event using `avi.klayman@gmail.com` as the creator email.
Expected: a creator-confirmation email arrives within a minute.

- [ ] **Step 2: Verify organizer notification**

In a different browser/incognito window, open the event link and mark some availability as a second participant.
Expected: ~120 seconds after marking cells (per `scheduleNotifyOrganizer`'s debounce), a notification email arrives at `avi.klayman@gmail.com`.

- [ ] **Step 3: Verify invite-link and best-times emails**

As the creator, use the sidebar "Email meeting link" panel to send to `avi.klayman@gmail.com`, then the "Send best times" panel to send to the same address.
Expected: both emails arrive.

- [ ] **Step 4: Verify the failure-alert path**

```bash
openssl rand -hex 4 | gcloud secrets versions add zepto-api-key --data-file=- --project=meteor-meet
```

This overwrites the live secret with garbage. Then repeat Step 3 (send an invite-link email).
Expected: the UI shows the send-failed state, AND an email titled "WhenFree · Mail send failed" arrives at `avi.klayman@gmail.com`.

- [ ] **Step 5: Restore the real secret**

Retrieve the real ZeptoMail token again from the GAS Script Properties (same source as Task 3 Step 1):

```bash
printf '%s' "<PASTE_THE_REAL_ZEPTOMAIL_TOKEN_HERE>" | gcloud secrets versions add zepto-api-key --data-file=- --project=meteor-meet
```

Then repeat Step 3 once more to confirm real sends work again.
Expected: emails arrive normally, no failure alert.

---

### Task 6: Retire the GAS mailer

**Files:**
- Delete: `mailer.gs`

**Interfaces:** none — cleanup only, no code depends on `mailer.gs` after Task 4.

- [ ] **Step 1: Undeploy the old GAS web app**

Run from the repo root (where `.clasp.json` already points at the mailer GAS project):

```bash
clasp undeploy AKfycbz7hknVlxm_K7RdFBV1gd7MbBz3KYsq7PQ2UgqHHByTxM2PI2W21T8p3sZ6qIenPMPDNg
```

Expected: `Undeployed AKfycbz7hknVlxm_K7RdFBV1gd7MbBz3KYsq7PQ2UgqHHByTxM2PI2W21T8p3sZ6qIenPMPDNg.` This removes the public GAS URL entirely, permanently closing the open-relay risk described in the design spec.

- [ ] **Step 2: Remove `mailer.gs` from the repo**

```bash
git rm mailer.gs
```

- [ ] **Step 3: Commit and push**

```bash
git commit -m "Retire GAS mailer web app now that mail runs through the Cloud Function"
git push
```
