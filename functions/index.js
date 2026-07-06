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
  res.set('Access-Control-Allow-Methods', 'POST');
  res.set('Access-Control-Allow-Headers', 'Content-Type, X-WhenFree-Key');

  if (req.method === 'OPTIONS') {
    res.status(204).send('');
    return;
  }

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
