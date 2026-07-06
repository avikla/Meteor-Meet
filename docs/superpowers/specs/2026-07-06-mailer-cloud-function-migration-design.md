# Design: Migrate Transactional Mailer from GAS to Cloud Functions

**Date:** 2026-07-06
**Status:** Approved

## Problem

WhenFree's transactional email (creator confirmation, invite/link emails, best-times emails, organizer notifications) is sent via a Google Apps Script web app (`mailer.gs`), called from `sendEmailViaGAS()` in `index.html`. The GAS web app deployment is currently returning HTTP 403 "Access Denied" on every POST — the request never reaches `doPost()`, so no alert email is even generated. This breaks all outbound mail from the app. GAS web app deployments are prone to this failure mode (access-level settings reverting, needing re-authorization) with no reliable way to prevent it from recurring.

## Goal

Replace the GAS web app with a Cloud Function in the existing Firebase project (`meteor-meet`, already on the Blaze plan for Firestore), eliminating the GAS access-control failure mode, while preserving identical app behavior: same emails, same triggers, same recipients, same content.

## Non-goals

- No new email types or templates.
- No changes to `daily-report.gs` (separate script, separate concern — stays on GAS).
- No login/auth system is being introduced to the app.

## Approach

A single Cloud Functions (2nd gen) HTTP function, `sendMail`, deployed into the `meteor-meet` GCP project via `gcloud functions deploy` (not `firebase-tools`, which isn't set up in this repo). `index.html` swaps the `GAS_MAILER_URL` constant for the new function URL and adds one request header; the request/response JSON shape is unchanged, so `sendEmailViaGAS()`, `sendCreatorConfirmationEmail()`, `scheduleNotifyOrganizer()`, and `sendToAllChips()` need no logic changes.

## Design

### Function implementation (`functions/index.js`)

Plain Node function using the `@google-cloud/functions-framework` convention (no `firebase-functions` SDK dependency):

```js
exports.sendMail = async (req, res) => {
  res.set('Access-Control-Allow-Origin', 'https://whenfree.org');

  if (req.get('X-WhenFree-Key') !== process.env.WHENFREE_MAIL_KEY) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return;
  }

  const { to_email, event_name, meeting_url, subject, body, html_body } = req.body;

  try {
    const response = await fetch('https://api.zeptomail.com/v1.1/email', {
      method: 'POST',
      headers: {
        'Authorization': process.env.ZEPTO_API_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        from: { address: 'no-reply@whenfree.org', name: 'WhenFree' },
        to: [{ email_address: { address: to_email } }],
        subject: subject || `Your meeting link: ${event_name}`,
        htmlbody: html_body || `<p>Hi,</p><p>Here is your meeting link: <a href="${meeting_url}">${meeting_url}</a></p>`,
        textbody: body || `Hi,\n\nHere is your meeting link:\n${meeting_url}`,
      }),
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
};

async function sendAlert(toEmail, subject, detail) {
  await fetch('https://api.zeptomail.com/v1.1/email', {
    method: 'POST',
    headers: {
      'Authorization': process.env.ZEPTO_API_KEY,
      'Accept': 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: { address: 'no-reply@whenfree.org', name: 'WhenFree' },
      to: [{ email_address: { address: 'avi.klayman@gmail.com' } }],
      subject: `WhenFree · Mail send failed`,
      textbody: `To: ${toEmail}\nSubject: ${subject}\n\nDetail:\n${detail}`,
    }),
  }).catch(() => {}); // best-effort — don't let the alert itself throw
}
```

Key points:
- **Auth-adjacent guard, not real auth**: `X-WhenFree-Key` is a fixed value visible in client JS (same trust model as the URL itself today). It filters out casual scanners/bots probing for open endpoints; it is not a substitute for real authentication. This app has no login system, so no stronger option is in scope.
- **Secrets**: `ZEPTO_API_KEY` and `WHENFREE_MAIL_KEY` both live in Google Secret Manager, injected as env vars via `--set-secrets` at deploy time (see below) — not `defineSecret`/`firebase-functions`, which is a `firebase-tools`-specific mechanism this repo doesn't use.
- **CORS**: manual `Access-Control-Allow-Origin: https://whenfree.org` header only. No `OPTIONS`/preflight handling needed as long as the client keeps sending `Content-Type: text/plain` (simple request, no preflight) — same trick the current GAS fetch call uses.
- **Failure alerting**: on ZeptoMail failure or a thrown error, a second ZeptoMail call notifies `avi.klayman@gmail.com`, replacing `GmailApp.sendEmail` (Apps-Script-only API, unavailable in Cloud Functions). Errors are also logged via `console.error` → Cloud Logging.
- **Cost/abuse circuit-breaker**: `--max-instances=5` at deploy time caps blast radius independent of the header check.

### Client changes (`index.html`)

- `GAS_MAILER_URL` (line ~1619) → new Cloud Function URL.
- Add `const WHENFREE_MAIL_KEY = '<value>';` near `GAS_MAILER_URL`.
- `sendEmailViaGAS()` (line ~2848) adds one header: `'X-WhenFree-Key': WHENFREE_MAIL_KEY`. `Content-Type: text/plain` is kept as-is to avoid CORS preflight.
- No other function in `index.html` changes — `sendCreatorConfirmationEmail()`, `scheduleNotifyOrganizer()`, `sendToAllChips()`, `showCreatorEmailError()` all consume `sendEmailViaGAS()`'s existing `{ok, ...}` contract unchanged.

### Deployment

```
gcloud secrets create zepto-api-key --project=meteor-meet
gcloud secrets create whenfree-mail-key --project=meteor-meet
# (set values via `echo -n "<value>" | gcloud secrets versions add <name> --data-file=-`)

gcloud functions deploy sendMail \
  --gen2 --runtime=nodejs20 --region=us-central1 \
  --trigger-http --allow-unauthenticated \
  --source=functions/ --entry-point=sendMail \
  --set-secrets='ZEPTO_API_KEY=zepto-api-key:latest,WHENFREE_MAIL_KEY=whenfree-mail-key:latest' \
  --max-instances=5 --project=meteor-meet
```

`--allow-unauthenticated` is required for a public HTTP endpoint (equivalent to GAS's "Anyone" access) — the `X-WhenFree-Key` header check inside the function is the actual gate, not IAM.

### Migration & cutover

1. Deploy the function; verify directly with `curl` (including the header) before touching `index.html`.
2. Update `index.html`, test against a real event: confirm creator-confirmation, invite/link, and best-times emails all arrive.
3. Verify the alert-email path by temporarily using an invalid ZeptoMail key and confirming `avi.klayman@gmail.com` receives the failure notice.
4. Delete the old GAS web app deployment entirely (not just stop referencing it) — a dangling, later-reauthorized deployment would silently reintroduce the open-relay risk `mailer.gs` already carried.
5. Remove `mailer.gs` from the repo. Leave `daily-report.gs`, `.clasp.json`, and `appsscript.json` in place if they're still needed for the daily report script; otherwise scope their removal separately (out of scope for this migration).

## Risks considered

- **Open-relay risk**: the current GAS mailer accepts any `to_email` with no auth check (documented in this repo's CLAUDE.md). Moving to Cloud Functions alone doesn't fix this — CORS only blocks browser-based cross-origin reads, not direct server-to-server calls. Mitigated here with the `X-WhenFree-Key` header check.
- **Cost exposure**: unlike GAS (bundled/free), Cloud Functions bills per invocation. Mitigated with `--max-instances=5`.
- **Cold starts**: acceptable for this app's low traffic; not paying for `min-instances`.
- **Tooling mismatch**: initially scoped secrets via `defineSecret` (a `firebase-functions`/`firebase-tools` concept) while choosing `gcloud` as the deploy tool — reconciled by using `gcloud`-native Secret Manager binding (`--set-secrets`) and a dependency-free function instead.

## Testing

- Direct `curl` test of the deployed function (with and without the correct header) before wiring up the client.
- End-to-end test via the live app: create an event, confirm creator email; join as a participant, confirm organizer notification; send invite link and best-times emails via the sidebar panels, confirm delivery.
- Deliberately break the ZeptoMail secret value temporarily to confirm the alert-email path fires, then restore it.
