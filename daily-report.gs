// ── Config ────────────────────────────────────────────────────────────────────
const REPORT_CONFIG = {
  projectId:  'meteor-meet',
  apiKey:     PropertiesService.getScriptProperties().getProperty('API_KEY'),
  collection: 'events',
  recipient:  'avi.klayman@gmail.com',
  tz:         'Asia/Jerusalem',
  cleanupUrl: 'https://cleanup.whenfree.org/',
  healthcheckPingUrl: PropertiesService.getScriptProperties().getProperty('HEALTHCHECK_PING_URL'),
  mailerUrl: 'https://us-central1-meteor-meet.cloudfunctions.net/sendMail',
  mailerKey: PropertiesService.getScriptProperties().getProperty('MAILER_KEY'),
  limits: {
    reads:   50000,
    writes:  20000,
    deletes: 20000,
    storage: 1 * 1024 * 1024 * 1024,  // 1 GiB
  },
};

// ── Time window ───────────────────────────────────────────────────────────────
function getYesterdayWindow_() {
  const { tz } = REPORT_CONFIG;
  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);

  const yDateStr = Utilities.formatDate(yesterday, tz, 'yyyy-MM-dd');
  const tDateStr = Utilities.formatDate(now,       tz, 'yyyy-MM-dd');

  function midnightISTtoUTC(dateStr) {
    const testDate = new Date(dateStr + 'T12:00:00Z');
    const istHour  = parseInt(Utilities.formatDate(testDate, tz, 'H'), 10);
    const [y, m, d] = dateStr.split('-').map(Number);
    return new Date(Date.UTC(y, m - 1, d) - (istHour - 12) * 3600000);
  }

  return {
    start:     midnightISTtoUTC(yDateStr).toISOString(),
    end:       midnightISTtoUTC(tDateStr).toISOString(),
    dateLabel: Utilities.formatDate(yesterday, tz, 'EEE, d MMM yyyy'),
  };
}

// ── Firestore: count all documents ───────────────────────────────────────────
function fetchEventCount_() {
  const { projectId, apiKey, collection } = REPORT_CONFIG;
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
              '/databases/(default)/documents:runAggregationQuery?key=' + apiKey;
  const payload = {
    structuredAggregationQuery: {
      structuredQuery: { from: [{ collectionId: collection }] },
      aggregations: [{ count: {}, alias: 'count' }],
    },
  };
  const res = UrlFetchApp.fetch(url, {
    method:             'post',
    contentType:        'application/json',
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const json = JSON.parse(res.getContentText());
  const val  = json[0] && json[0].result &&
               json[0].result.aggregateFields &&
               json[0].result.aggregateFields.count &&
               json[0].result.aggregateFields.count.integerValue;
  return val ? parseInt(val, 10) : null;
}

// ── Firestore: count events created in a time window ─────────────────────────
function fetchNewEventsCount_(startIso, endIso) {
  const { projectId, apiKey, collection } = REPORT_CONFIG;
  const url = 'https://firestore.googleapis.com/v1/projects/' + projectId +
              '/databases/(default)/documents:runAggregationQuery?key=' + apiKey;
  const payload = {
    structuredAggregationQuery: {
      structuredQuery: {
        from: [{ collectionId: collection }],
        where: {
          compositeFilter: {
            op: 'AND',
            filters: [
              { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'GREATER_THAN_OR_EQUAL', value: { timestampValue: startIso } } },
              { fieldFilter: { field: { fieldPath: 'createdAt' }, op: 'LESS_THAN',             value: { timestampValue: endIso   } } },
            ],
          },
        },
      },
      aggregations: [{ count: {}, alias: 'count' }],
    },
  };
  const res = UrlFetchApp.fetch(url, {
    method:             'post',
    contentType:        'application/json',
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true,
  });
  const json = JSON.parse(res.getContentText());
  const val  = json[0] && json[0].result &&
               json[0].result.aggregateFields &&
               json[0].result.aggregateFields.count &&
               json[0].result.aggregateFields.count.integerValue;
  return val ? parseInt(val, 10) : 0;
}

// ── Cloud Monitoring: sum a DELTA metric (reads/writes/deletes/bandwidth) ────
function fetchMonitoringMetric_(metricType, startIso, endIso) {
  const { projectId } = REPORT_CONFIG;
  const token = ScriptApp.getOAuthToken();
  const base  = 'https://monitoring.googleapis.com/v3/projects/' + projectId + '/timeSeries';
  const qs = [
    'filter='                         + encodeURIComponent('metric.type="' + metricType + '"'),
    'interval.startTime='             + encodeURIComponent(startIso),
    'interval.endTime='               + encodeURIComponent(endIso),
    'aggregation.alignmentPeriod=86400s',
    'aggregation.perSeriesAligner=ALIGN_SUM',
    'aggregation.crossSeriesReducer=REDUCE_SUM',
  ].join('&');
  const res = UrlFetchApp.fetch(base + '?' + qs, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    console.error('Monitoring API error ' + code + ': ' + res.getContentText());
    return null;
  }
  const json = JSON.parse(res.getContentText());
  if (!json.timeSeries || !json.timeSeries.length) return 0;
  return json.timeSeries[0].points.reduce(function(sum, p) {
    return sum + parseInt(p.value.int64Value || p.value.doubleValue || 0, 10);
  }, 0);
}

// ── Cloud Monitoring: latest value of a GAUGE metric (storage bytes) ─────────
function fetchStorageBytes_() {
  const { projectId } = REPORT_CONFIG;
  const token = ScriptApp.getOAuthToken();
  const now   = new Date();
  const start = new Date(now.getTime() - 86400000).toISOString(); // last 24h window
  const base  = 'https://monitoring.googleapis.com/v3/projects/' + projectId + '/timeSeries';
  const qs = [
    'filter='                         + encodeURIComponent('metric.type="firestore.googleapis.com/storage/data_and_index_storage_bytes"'),
    'interval.startTime='             + encodeURIComponent(start),
    'interval.endTime='               + encodeURIComponent(now.toISOString()),
    'aggregation.alignmentPeriod=86400s',
    'aggregation.perSeriesAligner=ALIGN_MEAN',
    'aggregation.crossSeriesReducer=REDUCE_SUM',
  ].join('&');
  const res = UrlFetchApp.fetch(base + '?' + qs, {
    headers: { Authorization: 'Bearer ' + token },
    muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    console.error('Storage API error ' + code + ': ' + res.getContentText());
    return null;
  }
  const json = JSON.parse(res.getContentText());
  if (!json.timeSeries || !json.timeSeries.length) return 0;
  const points = json.timeSeries[0].points;
  if (!points || !points.length) return 0;
  return parseInt(points[0].value.int64Value || points[0].value.doubleValue || 0, 10);
}

// ── Formatting helpers ────────────────────────────────────────────────────────
function fmtNum_(n) {
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function fmtBytes_(bytes) {
  if (bytes >= 1024 * 1024 * 1024) return (bytes / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  if (bytes >= 1024 * 1024)        return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
  if (bytes >= 1024)               return (bytes / 1024).toFixed(0) + ' KB';
  return bytes + ' B';
}

function statusColor_(pct) {
  if (pct >= 0.9) return '#E5534B';
  if (pct >= 0.7) return '#F5A623';
  return '#00C281';
}

function statCard_(label, displayValue, limitLabel, pct) {
  var color  = statusColor_(pct);
  var barPct = Math.min(pct * 100, 100).toFixed(1);
  return '<td style="width:50%;padding:6px;" valign="top">' +
    '<div style="background:#F4FAF7;border:1px solid #D6EDE4;border-radius:12px;padding:16px 18px;">' +
      '<div style="font-size:12px;color:#3E5750;font-weight:500;margin-bottom:6px;">' +
        '<span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:' + color + ';margin-right:5px;vertical-align:middle;"></span>' +
        label +
      '</div>' +
      '<div style="font-size:26px;font-weight:700;color:#0B2018;line-height:1;">' +
        displayValue +
        '<span style="font-size:13px;color:#7E988F;font-weight:400;margin-left:2px;">/ ' + limitLabel + '</span>' +
      '</div>' +
      '<div style="margin-top:10px;">' +
        '<div style="background:#D6EDE4;border-radius:100px;height:6px;overflow:hidden;">' +
          '<div style="width:' + barPct + '%;background:' + color + ';height:100%;border-radius:100px;"></div>' +
        '</div>' +
        '<div style="margin-top:5px;">' +
          '<span style="font-size:11px;color:#3E5750;font-weight:600;">' + barPct + '%</span>' +
          '<span style="font-size:11px;color:#7E988F;float:right;">limit: ' + limitLabel + '</span>' +
        '</div>' +
      '</div>' +
    '</div>' +
  '</td>';
}

// ── HTML email builder ────────────────────────────────────────────────────────
function buildEmailHtml_(data) {
  var eventCount = data.eventCount;
  var reads      = data.reads     !== null && data.reads     !== undefined ? data.reads     : 0;
  var writes     = data.writes    !== null && data.writes    !== undefined ? data.writes    : 0;
  var deletes    = data.deletes   !== null && data.deletes   !== undefined ? data.deletes   : 0;
  var storage    = data.storage   !== null && data.storage   !== undefined ? data.storage   : 0;
  var dateLabel  = data.dateLabel;
  var limits     = REPORT_CONFIG.limits;

  var readsPct   = reads   / limits.reads;
  var writesPct  = writes  / limits.writes;
  var delPct     = deletes / limits.deletes;
  var storagePct = storage / limits.storage;
  var countStr    = eventCount !== null ? fmtNum_(eventCount) : 'N/A';
  var newEventsStr = data.newEvents !== null && data.newEvents !== undefined ? fmtNum_(data.newEvents) : '—';

  return '<!DOCTYPE html><html lang="en"><head>' +
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
    '</head><body style="margin:0;background:#e8f0eb;font-family:\'Segoe UI\',system-ui,sans-serif;padding:32px 16px;">' +
    '<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">' +
    '<table width="580" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);">' +

    // Header
    '<tr><td style="background:#0B2018;padding:28px 36px 24px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="color:#00C281;font-size:22px;font-weight:700;letter-spacing:-0.5px;"><span style="color:#fff;">When</span>Free</td>' +
        '<td align="right"><span style="background:rgba(0,194,129,.15);color:#00C281;font-size:12px;font-weight:600;padding:4px 12px;border-radius:100px;">' + dateLabel + '</span></td>' +
      '</tr></table>' +
      '<div style="color:#5A7D6E;font-size:13px;margin-top:6px;">Daily DB Report &mdash; midnight to midnight (IST)</div>' +
    '</td></tr>' +

    // Body
    '<tr><td style="padding:28px 36px 32px;">' +

      // Total events
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#7E988F;margin-bottom:14px;">Database</div>' +
      '<div style="background:#0B2018;border-radius:12px;padding:20px 22px;margin-bottom:24px;">' +
        '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
          '<td>' +
            '<div style="font-size:12px;color:#5A7D6E;font-weight:500;margin-bottom:4px;">Total events stored</div>' +
            '<div style="font-size:42px;font-weight:700;color:#fff;line-height:1;">' + countStr + '</div>' +
            '<div style="margin-top:8px;font-size:12px;color:#5A7D6E;font-weight:500;">New today</div>' +
            '<div style="font-size:28px;font-weight:700;color:#00C281;line-height:1;">' + newEventsStr + '</div>' +
          '</td>' +
          '<td align="right"><a href="https://console.firebase.google.com/project/meteor-meet/firestore" ' +
            'style="background:#00C281;color:#04261B;font-size:12px;font-weight:700;padding:8px 16px;border-radius:100px;text-decoration:none;">Console &#8594;</a></td>' +
        '</tr></table>' +
      '</div>' +

      // Operations + Storage grid
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#7E988F;margin-bottom:14px;">Daily Operations &amp; Storage</div>' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:12px;"><tr>' +
        statCard_('Reads',   fmtNum_(reads),   '50,000', readsPct) +
        statCard_('Writes',  fmtNum_(writes),  '20,000', writesPct) +
      '</tr><tr>' +
        statCard_('Deletes', fmtNum_(deletes), '20,000', delPct) +
        statCard_('Storage', fmtBytes_(storage), '1 GB', storagePct) +
      '</tr></table>' +

      // Full-width console link
      '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr>' +
        '<td style="padding:6px;">' +
          '<div style="background:#F4FAF7;border:1px solid #D6EDE4;border-radius:12px;padding:14px 18px;">' +
            '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
              '<td><div style="font-size:12px;color:#3E5750;font-weight:500;">Full usage details</div>' +
                  '<div style="font-size:12px;color:#7E988F;margin-top:2px;">Reads, writes, and storage over time in Cloud Console</div></td>' +
              '<td align="right"><a href="https://console.cloud.google.com/firestore/databases/-default-/usage?project=meteor-meet" ' +
                'style="background:#00C281;color:#04261B;font-size:12px;font-weight:700;padding:8px 16px;border-radius:100px;text-decoration:none;white-space:nowrap;">View &#8594;</a></td>' +
            '</tr></table>' +
          '</div>' +
        '</td>' +
      '</tr></table>' +

      // Cleanup section
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#7E988F;margin-bottom:14px;margin-top:8px;">Maintenance</div>' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr>' +
        '<td style="padding:6px;">' +
          '<div style="background:#F4FAF7;border:1px solid #D6EDE4;border-radius:12px;padding:14px 18px;">' +
            '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
              '<td>' +
                '<div style="font-size:12px;color:#3E5750;font-weight:500;">Expired meeting cleanup</div>' +
                '<div style="font-size:12px;color:#7E988F;margin-top:2px;">Review and delete expired events from Firestore</div>' +
              '</td>' +
              '<td align="right"><a href="' + REPORT_CONFIG.cleanupUrl + '" ' +
                'style="background:#00C281;color:#04261B;font-size:12px;font-weight:700;padding:8px 16px;border-radius:100px;text-decoration:none;white-space:nowrap;">Open &#8594;</a></td>' +
            '</tr></table>' +
          '</div>' +
        '</td>' +
      '</tr></table>' +

      // Email section
      '<div style="font-size:11px;font-weight:700;text-transform:uppercase;letter-spacing:1px;color:#7E988F;margin-bottom:14px;margin-top:8px;">Email</div>' +
      '<table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom:8px;"><tr>' +
        '<td style="padding:6px;">' +
          '<div style="background:#F4FAF7;border:1px solid #D6EDE4;border-radius:12px;padding:14px 18px;">' +
            '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
              '<td>' +
                '<div style="font-size:12px;color:#3E5750;font-weight:500;">Transactional emails</div>' +
                '<div style="font-size:12px;color:#7E988F;margin-top:2px;">Sent via ZeptoMail — view delivery stats, bounces, and logs</div>' +
              '</td>' +
              '<td align="right"><a href="https://zeptomail.zoho.com/zem/927167870#agents/4db6f9fa7dd3976f/processed-emails" ' +
                'style="background:#00C281;color:#04261B;font-size:12px;font-weight:700;padding:8px 16px;border-radius:100px;text-decoration:none;white-space:nowrap;">View &#8594;</a></td>' +
            '</tr></table>' +
          '</div>' +
        '</td>' +
      '</tr></table>' +

    '</td></tr>' +

    // Footer
    '<tr><td style="background:#F4FAF7;border-top:1px solid #D6EDE4;padding:18px 36px;">' +
      '<table width="100%" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="font-size:12px;color:#7E988F;">WhenFree &middot; no-reply@meteor.co.il</td>' +
        '<td align="right"><a href="https://console.firebase.google.com/project/meteor-meet/firestore" ' +
          'style="font-size:12px;color:#00C281;text-decoration:none;font-weight:600;">Firebase Console &#8594;</a></td>' +
      '</tr></table>' +
    '</td></tr>' +

    '</table></td></tr></table></body></html>';
}

// ── Healthchecks.io dead-man's-switch ────────────────────────────────────────
function pingHealthcheck_(suffix) {
  var url = REPORT_CONFIG.healthcheckPingUrl;
  if (!url) return;
  try {
    UrlFetchApp.fetch(url + (suffix || ''), { muteHttpExceptions: true });
  } catch (e) {
    console.error('Healthcheck ping failed: ' + e.message);
  }
}

// ── Mail via ZeptoMail Cloud Function (replaces GmailApp) ────────────────────
function sendEmailViaFunction_(toEmail, subject, body, htmlBody) {
  var payload = { to_email: toEmail, subject: subject, body: body };
  if (htmlBody) payload.html_body = htmlBody;
  try {
    var res = UrlFetchApp.fetch(REPORT_CONFIG.mailerUrl, {
      method:             'post',
      contentType:        'text/plain',
      headers:            { 'X-WhenFree-Key': REPORT_CONFIG.mailerKey },
      payload:            JSON.stringify(payload),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    if (code < 200 || code >= 300) {
      console.error('sendEmailViaFunction_ HTTP ' + code + ': ' + res.getContentText());
      return false;
    }
    return true;
  } catch (e) {
    console.error('sendEmailViaFunction_ threw: ' + e.message);
    return false;
  }
}

// ── Main entry point ──────────────────────────────────────────────────────────
function sendDailyReport() {
  try {
    var win        = getYesterdayWindow_();
    var eventCount = fetchEventCount_();
    var newEvents  = fetchNewEventsCount_(win.start, win.end);
    var reads   = fetchMonitoringMetric_('firestore.googleapis.com/document/read_count',   win.start, win.end);
    var writes  = fetchMonitoringMetric_('firestore.googleapis.com/document/write_count',  win.start, win.end);
    var deletes = fetchMonitoringMetric_('firestore.googleapis.com/document/delete_count', win.start, win.end);
    var storage = fetchStorageBytes_();

    var html = buildEmailHtml_({
      eventCount: eventCount,
      newEvents:  newEvents,
      reads:      reads,
      writes:     writes,
      deletes:    deletes,
      storage:    storage,
      dateLabel:  win.dateLabel,
    });

    sendEmailViaFunction_(
      REPORT_CONFIG.recipient,
      'WhenFree · Daily DB Report — ' + win.dateLabel,
      'WhenFree Daily DB Report for ' + win.dateLabel + ' — open in an HTML-capable mail client to view the full report.',
      html
    );

    console.log('Report sent for ' + win.dateLabel + ': events=' + eventCount +
      ', reads=' + reads + ', writes=' + writes + ', deletes=' + deletes + ', storage=' + storage);
    pingHealthcheck_();
  } catch (err) {
    console.error('sendDailyReport failed: ' + err.message);
    var failMsg = 'The daily report script failed with error: ' + err.message;
    sendEmailViaFunction_(
      REPORT_CONFIG.recipient,
      'WhenFree · Daily DB Report FAILED',
      failMsg,
      '<p>' + failMsg.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') + '</p>'
    );
    pingHealthcheck_('/fail');
  }
}

// ── One-time trigger installer ────────────────────────────────────────────────
function createTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(function(t) { return t.getHandlerFunction() === 'sendDailyReport'; })
    .forEach(function(t) { ScriptApp.deleteTrigger(t); });

  ScriptApp.newTrigger('sendDailyReport')
    .timeBased()
    .atHour(0)
    .everyDays(1)
    .create();

  console.log('Trigger created: sendDailyReport fires daily at midnight (Asia/Jerusalem).');
}
