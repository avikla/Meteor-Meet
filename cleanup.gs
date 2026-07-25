// ── Config ────────────────────────────────────────────────────────────────────
const CLEANUP_CONFIG = {
  projectId:   'meteor-meet',
  apiKey:      PropertiesService.getScriptProperties().getProperty('API_KEY'),
  adminToken:  PropertiesService.getScriptProperties().getProperty('ADMIN_TOKEN'),
  collection:  'events',
  tz:          'Asia/Jerusalem',
  siteUrl:     'https://whenfree.org',
  staleDaysModeThresholdDays: 90, // recurring (lastDate == null) events with no activity this long are flagged for review
};

// ── Firestore value decoding (REST "Value" wire format → plain JS) ───────────
function fsValue_(v) {
  if (!v) return null;
  if ('nullValue' in v)      return null;
  if ('stringValue' in v)    return v.stringValue;
  if ('integerValue' in v)   return parseInt(v.integerValue, 10);
  if ('doubleValue' in v)    return v.doubleValue;
  if ('booleanValue' in v)   return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('mapValue' in v) {
    var out = {};
    var fields = v.mapValue.fields || {};
    Object.keys(fields).forEach(function(k) { out[k] = fsValue_(fields[k]); });
    return out;
  }
  if ('arrayValue' in v) {
    return (v.arrayValue.values || []).map(fsValue_);
  }
  return null;
}

function fsDocToCandidate_(doc, bucket) {
  var fields = doc.fields || {};
  var decoded = {};
  Object.keys(fields).forEach(function(k) { decoded[k] = fsValue_(fields[k]); });
  var id = doc.name.split('/').pop();
  var participants = decoded.participants || {};
  var participantNames = Object.keys(participants).map(function(k) {
    return (participants[k] && participants[k].name) || k;
  });
  return {
    id:               id,
    bucket:           bucket,
    name:             decoded.name || '(untitled)',
    mode:             decoded.mode || null,
    lastDate:         decoded.lastDate || null,
    createdAt:        decoded.createdAt || null,
    selectedDates:    decoded.selectedDates || [],
    selectedDays:     decoded.selectedDays || [],
    participantCount: participantNames.length,
    participantNames: participantNames,
    link:             CLEANUP_CONFIG.siteUrl + '/#' + id,
  };
}

// ── Firestore: run a structured query, return decoded documents ─────────────
function runFirestoreQuery_(structuredQuery) {
  var url = 'https://firestore.googleapis.com/v1/projects/' + CLEANUP_CONFIG.projectId +
            '/databases/(default)/documents:runQuery?key=' + CLEANUP_CONFIG.apiKey;
  var res = UrlFetchApp.fetch(url, {
    method:             'post',
    contentType:        'application/json',
    payload:            JSON.stringify({ structuredQuery: structuredQuery }),
    muteHttpExceptions: true,
  });
  var json = JSON.parse(res.getContentText());
  if (json.error) {
    throw new Error('Firestore query failed: ' + JSON.stringify(json.error));
  }
  return json.filter(function(row) { return row.document; }).map(function(row) { return row.document; });
}

function getTodayDateStr_() {
  return Utilities.formatDate(new Date(), CLEANUP_CONFIG.tz, 'yyyy-MM-dd');
}

function getStaleThresholdIso_() {
  var cutoff = new Date(Date.now() - CLEANUP_CONFIG.staleDaysModeThresholdDays * 86400000);
  return cutoff.toISOString();
}

// ── Candidate discovery ───────────────────────────────────────────────────────
function getExpiryCandidates_() {
  var todayStr = getTodayDateStr_();
  var staleIso = getStaleThresholdIso_();
  var collection = CLEANUP_CONFIG.collection;

  var datedDocs = runFirestoreQuery_({
    from:    [{ collectionId: collection }],
    where: {
      fieldFilter: {
        field: { fieldPath: 'lastDate' },
        op:    'LESS_THAN',
        value: { stringValue: todayStr },
      },
    },
    orderBy: [{ field: { fieldPath: 'lastDate' }, direction: 'ASCENDING' }],
    limit:   1000,
  });

  // Note: events created before June 2026 predate the `createdAt` field entirely, so
  // Firestore's range filter below silently excludes them (missing field != matching the range).
  // Those older recurring events won't surface here even if long abandoned; only lastDate-based
  // "dated" candidates cover pre-June-2026 documents reliably.
  var staleRecurringDocs = runFirestoreQuery_({
    from:    [{ collectionId: collection }],
    where: {
      compositeFilter: {
        op: 'AND',
        filters: [
          { unaryFilter: { field: { fieldPath: 'lastDate' },  op: 'IS_NULL' } },
          { fieldFilter:  { field: { fieldPath: 'createdAt' }, op: 'LESS_THAN', value: { timestampValue: staleIso } } },
        ],
      },
    },
    limit: 1000,
  });

  var dated     = datedDocs.map(function(d) { return fsDocToCandidate_(d, 'dated'); });
  var recurring = staleRecurringDocs.map(function(d) { return fsDocToCandidate_(d, 'recurring-stale'); });

  return dated.concat(recurring);
}

// ── Deletion (requires datastore-scoped OAuth token; bypasses security rules) ─
function chunk_(arr, size) {
  var out = [];
  for (var i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function deleteEvents(ids, confirmToken) {
  if (confirmToken !== 'DELETE-CONFIRMED') {
    throw new Error('Deletion not confirmed.');
  }
  if (!ids || !ids.length) {
    return { deletedCount: 0, deletedIds: [] };
  }

  var token = ScriptApp.getOAuthToken();
  var basePath = 'projects/' + CLEANUP_CONFIG.projectId + '/databases/(default)/documents/' +
                 CLEANUP_CONFIG.collection + '/';
  var commitUrl = 'https://firestore.googleapis.com/v1/projects/' + CLEANUP_CONFIG.projectId +
                   '/databases/(default)/documents:commit';

  chunk_(ids, 500).forEach(function(batch) {
    var writes = batch.map(function(id) { return { delete: basePath + id }; });
    var res = UrlFetchApp.fetch(commitUrl, {
      method:             'post',
      contentType:        'application/json',
      headers:            { Authorization: 'Bearer ' + token },
      payload:            JSON.stringify({ writes: writes }),
      muteHttpExceptions: true,
    });
    var code = res.getResponseCode();
    if (code !== 200) {
      throw new Error('Firestore delete commit failed (' + code + '): ' + res.getContentText());
    }
  });

  console.log('Deleted ' + ids.length + ' event(s): ' + ids.join(', '));
  return { deletedCount: ids.length, deletedIds: ids };
}

// ── Web app entry point (private admin page; doPost/mailer.gs untouched) ─────
function doGet(e) {
  var token = e && e.parameter && e.parameter.token;
  if (!CLEANUP_CONFIG.adminToken || token !== CLEANUP_CONFIG.adminToken) {
    return HtmlService.createHtmlOutput('Forbidden').setTitle('403');
  }

  var candidates = getExpiryCandidates_();
  return HtmlService.createHtmlOutput(buildCleanupPageHtml_(candidates))
    .setTitle('WhenFree · Expired Meeting Cleanup')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function escHtml_(s) {
  return String(s).replace(/[&<>"']/g, function(c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function candidateCardHtml_(c) {
  var dateInfo = c.bucket === 'dated'
    ? 'Last date: ' + escHtml_(c.lastDate)
    : 'Recurring (days-of-week) · created ' + escHtml_((c.createdAt || '').slice(0, 10));
  var participants = c.participantNames.length
    ? c.participantNames.map(escHtml_).join(', ')
    : '(no participants)';

  return '' +
    '<label class="card">' +
      '<input type="checkbox" class="pick" value="' + escHtml_(c.id) + '">' +
      '<div class="card-body">' +
        '<div class="card-title">' + escHtml_(c.name) + '</div>' +
        '<div class="card-meta">' + dateInfo + ' &middot; ' + c.participantCount + ' participant(s)</div>' +
        '<div class="card-meta">' + participants + '</div>' +
        '<a class="card-link" href="' + c.link + '" target="_blank" rel="noopener">Open live event &#8594;</a>' +
      '</div>' +
    '</label>';
}

function buildCleanupPageHtml_(candidates) {
  var dated     = candidates.filter(function(c) { return c.bucket === 'dated'; });
  var recurring = candidates.filter(function(c) { return c.bucket === 'recurring-stale'; });

  var datedHtml     = dated.length     ? dated.map(candidateCardHtml_).join('')     : '<div class="empty">None.</div>';
  var recurringHtml = recurring.length ? recurring.map(candidateCardHtml_).join('') : '<div class="empty">None.</div>';

  return '<!DOCTYPE html><html><head><meta charset="UTF-8">' +
  '<style>' +
    'body{font-family:"DM Sans",system-ui,sans-serif;background:#D6EDE4;color:#0B2018;margin:0;padding:24px;}' +
    'h1{font-family:"Figtree",system-ui,sans-serif;font-size:20px;margin:0 0 4px;}' +
    'h2{font-size:14px;text-transform:uppercase;letter-spacing:1px;color:#3E5750;margin:28px 0 12px;}' +
    '.sub{color:#3E5750;font-size:13px;margin-bottom:20px;}' +
    '.card{display:flex;gap:12px;background:#E9F6F0;border:1px solid rgba(10,70,52,0.15);border-radius:14px;padding:14px 16px;margin-bottom:10px;cursor:pointer;align-items:flex-start;}' +
    '.card input{margin-top:4px;}' +
    '.card-title{font-weight:700;}' +
    '.card-meta{font-size:12px;color:#3E5750;margin-top:2px;}' +
    '.card-link{font-size:12px;color:#00382A;font-weight:600;text-decoration:none;display:inline-block;margin-top:6px;}' +
    '.empty{color:#7E988F;font-size:13px;}' +
    '.bar{position:sticky;top:0;background:#D6EDE4;padding:12px 0;display:flex;gap:10px;align-items:center;flex-wrap:wrap;}' +
    'input[type=text]{padding:8px 10px;border-radius:8px;border:1px solid rgba(10,70,52,0.2);font-size:13px;}' +
    'button{padding:9px 18px;border-radius:100px;border:none;font-weight:700;font-size:13px;cursor:pointer;}' +
    'button.danger{background:#E5534B;color:#fff;}' +
    'button.danger:disabled{background:#B7C7C0;color:#fff;cursor:not-allowed;}' +
    '#status{font-size:13px;margin-left:8px;}' +
  '</style></head><body>' +
    '<h1>WhenFree &middot; Expired Meeting Cleanup</h1>' +
    '<div class="sub">Review each meeting below, then select the ones to permanently delete from Firestore.</div>' +
    '<div class="bar">' +
      '<input type="text" id="confirmPhrase" placeholder="Type DELETE to enable">' +
      '<button class="danger" id="deleteBtn" disabled>Delete selected</button>' +
      '<span id="status"></span>' +
    '</div>' +
    '<h2>Dated events past their last date (' + dated.length + ')</h2>' +
    datedHtml +
    '<h2>Recurring events, no activity for ' + CLEANUP_CONFIG.staleDaysModeThresholdDays + '+ days (' + recurring.length + ')</h2>' +
    recurringHtml +
    '<script>' +
      'var confirmInput = document.getElementById("confirmPhrase");' +
      'var deleteBtn = document.getElementById("deleteBtn");' +
      'var statusEl = document.getElementById("status");' +
      'confirmInput.addEventListener("input", function() {' +
        'deleteBtn.disabled = confirmInput.value !== "DELETE" || !document.querySelectorAll(".pick:checked").length;' +
      '});' +
      'document.addEventListener("change", function(e) {' +
        'if (e.target.classList.contains("pick")) {' +
          'deleteBtn.disabled = confirmInput.value !== "DELETE" || !document.querySelectorAll(".pick:checked").length;' +
        '}' +
      '});' +
      'deleteBtn.addEventListener("click", function() {' +
        'var ids = Array.prototype.map.call(document.querySelectorAll(".pick:checked"), function(el) { return el.value; });' +
        'if (!ids.length) return;' +
        'if (!confirm("Permanently delete " + ids.length + " event(s)? This cannot be undone.")) return;' +
        'deleteBtn.disabled = true;' +
        'statusEl.textContent = "Deleting...";' +
        'google.script.run' +
          '.withSuccessHandler(function(result) {' +
            'statusEl.textContent = "Deleted " + result.deletedCount + " event(s). Reloading...";' +
            'setTimeout(function() { location.reload(); }, 1200);' +
          '})' +
          '.withFailureHandler(function(err) {' +
            'statusEl.textContent = "Error: " + err.message;' +
            'deleteBtn.disabled = false;' +
          '})' +
          '.deleteEvents(ids, "DELETE-CONFIRMED");' +
      '});' +
    '</script>' +
  '</body></html>';
}
