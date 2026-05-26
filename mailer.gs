function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const { to_email, event_name, meeting_url } = data;

    GmailApp.sendEmail(
      to_email,
      `Your meeting link: ${event_name}`,
      `Hi,\n\nHere is your meeting link:\n${meeting_url}\n\nSee you there!`,
      {
        name: 'Meteor Meet',
        // Uncomment after adding no-reply@meet.meteor.co.il as a Gmail alias:
        // from: 'no-reply@meet.meteor.co.il',
      }
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
