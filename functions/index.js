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
