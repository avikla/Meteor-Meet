function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const { to_email, event_name, meeting_url, subject, body, html_body } = data;

    const options = { name: 'Meteor Meet', from: 'no-reply@meteor.co.il' };
    if (html_body) options.htmlBody = html_body;

    GmailApp.sendEmail(
      to_email,
      subject || `Your meeting link: ${event_name}`,
      body    || `Hi,\n\nHere is your meeting link:\n${meeting_url}\n\nSee you there!`,
      options
    );

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
