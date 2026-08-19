'use strict';

const admin = require('firebase-admin');
admin.initializeApp();
// Lazy: constructing the Firestore client resolves project credentials immediately,
// which throws outside a GCP environment — keep `node --test` (pure-function tests,
// no Firestore calls) working without ambient credentials.
let _db = null;
function getDb() {
  if (!_db) _db = admin.firestore();
  return _db;
}

const FROM = { address: 'no-reply@whenfree.org', name: 'WhenFree' };

function checkAuth(req) {
  return req.get('X-WhenFree-Key') === process.env.WHENFREE_MAIL_KEY;
}

function parseRequestBody(req) {
  return typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
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

const ZEPTO_ENDPOINT = 'https://api.zeptomail.com/v1.1/email';
const ALERT_EMAIL = 'avi.klayman@gmail.com';
const ALLOWED_ORIGIN = 'https://whenfree.org';
const DAILY_MAIL_CAP = 100;

function setCors(res) {
  res.set('Access-Control-Allow-Origin', ALLOWED_ORIGIN);
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-WhenFree-Key');
}

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

// Sends one message via ZeptoMail; used by both sendMail and notifyOrganizer.
async function sendViaZepto_(payload) {
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
  return { ok: response.status >= 200 && response.status < 300, status: response.status, bodyText };
}

// Caps sends per event per UTC day so the mail relay can't be used for bulk spam,
// while leaving the legitimate arbitrary-recipient invite feature untouched.
// Requests with no event_slug (e.g. daily-report.gs, which isn't tied to one event)
// share a single bucket so that path is capped too. "unknown", not "__unknown__" —
// Firestore reserves document IDs matching /^__.*__$/.
// Fails open (returns true) on any unexpected Firestore error so a rate-limiter
// hiccup can never take down actual mail delivery — this is defense-in-depth, not
// the primary abuse control.
async function checkAndIncrementMailCount_(eventSlug) {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const db = getDb();
    const ref = db.collection('mailCounts').doc(eventSlug || 'unknown');
    return await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const data = snap.exists ? snap.data() : null;
      const count = data && data.date === today ? data.count : 0;
      if (count >= DAILY_MAIL_CAP) return false;
      tx.set(ref, { date: today, count: count + 1 });
      return true;
    });
  } catch (err) {
    console.error('checkAndIncrementMailCount_ failed, failing open:', err.message);
    return true;
  }
}

async function sendMail(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (!checkAuth(req)) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return;
  }

  const data = parseRequestBody(req);
  const { to_email, subject, event_slug } = data;
  const payload = buildZeptoPayload(data);

  const underCap = await checkAndIncrementMailCount_(event_slug);
  if (!underCap) {
    res.status(200).json({ ok: false, error: 'rate_limited' });
    return;
  }

  try {
    const { ok, status, bodyText } = await sendViaZepto_(payload);
    if (!ok) {
      await sendAlert(to_email, subject, bodyText);
      res.status(200).json({ ok: false, error: `ZeptoMail HTTP ${status}`, detail: bodyText });
      return;
    }
    const result = JSON.parse(bodyText);
    res.status(200).json({ ok: true, messageId: result.request_id });
  } catch (err) {
    await sendAlert(to_email, subject, err.message);
    res.status(200).json({ ok: false, error: err.message });
  }
}

// Stores the creator's email server-side, out of the public `events/{slug}` document.
// Authorized by creatorToken matching the event doc — the same trust level the app
// already uses for creator-only actions (client-gated, no server-side Firebase Auth).
// Writes with .create() so a later call can't overwrite an already-stored email.
async function storeCreatorEmail(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (!checkAuth(req)) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return;
  }

  const { eventSlug, creatorEmail, creatorToken } = parseRequestBody(req);
  if (!eventSlug || !creatorEmail || !creatorToken) {
    res.status(400).json({ ok: false, error: 'missing_fields' });
    return;
  }

  try {
    const db = getDb();
    const eventSnap = await db.collection('events').doc(eventSlug).get();
    if (!eventSnap.exists || eventSnap.data().creatorToken !== creatorToken) {
      res.status(403).json({ ok: false, error: 'forbidden' });
      return;
    }
    await db.collection('eventSecrets').doc(eventSlug).create({ creatorEmail });
    res.status(200).json({ ok: true });
  } catch (err) {
    // ALREADY_EXISTS (gRPC code 6) means this event's email was already stored once.
    if (err.code === 6) {
      res.status(200).json({ ok: true });
      return;
    }
    res.status(200).json({ ok: false, error: err.message });
  }
}

// Notifies the organizer that a participant responded, without the client ever
// seeing the organizer's email — the address is looked up server-side from
// eventSecrets, which client SDKs cannot read.
async function notifyOrganizer(req, res) {
  setCors(res);

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

  if (!checkAuth(req)) {
    res.status(403).json({ ok: false, error: 'forbidden' });
    return;
  }

  const { eventSlug, subject, body, html_body, event_name, meeting_url } = parseRequestBody(req);
  if (!eventSlug) {
    res.status(400).json({ ok: false, error: 'missing_fields' });
    return;
  }

  try {
    const db = getDb();
    const [eventSnap, secretSnap] = await Promise.all([
      db.collection('events').doc(eventSlug).get(),
      db.collection('eventSecrets').doc(eventSlug).get(),
    ]);
    const notifyOnResponse = eventSnap.exists && eventSnap.data().notifyOnResponse;
    const creatorEmail = secretSnap.exists ? secretSnap.data().creatorEmail : null;
    if (!notifyOnResponse || !creatorEmail) {
      res.status(200).json({ ok: true, skipped: true });
      return;
    }

    const underCap = await checkAndIncrementMailCount_(eventSlug);
    if (!underCap) {
      res.status(200).json({ ok: false, error: 'rate_limited' });
      return;
    }

    const payload = buildZeptoPayload({ to_email: creatorEmail, event_name, meeting_url, subject, body, html_body });
    const { ok, status, bodyText } = await sendViaZepto_(payload);
    if (!ok) {
      await sendAlert(creatorEmail, subject, bodyText);
      res.status(200).json({ ok: false, error: `ZeptoMail HTTP ${status}`, detail: bodyText });
      return;
    }
    res.status(200).json({ ok: true });
  } catch (err) {
    res.status(200).json({ ok: false, error: err.message });
  }
}

module.exports = {
  checkAuth,
  buildZeptoPayload,
  parseRequestBody,
  sendMail,
  storeCreatorEmail,
  notifyOrganizer,
  FROM,
};
