'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { checkAuth, buildZeptoPayload, parseRequestBody, EMAIL_RE } = require('./index.js');

test('parseRequestBody parses a raw JSON string body (text/plain content-type)', () => {
  const req = { body: '{"to_email":"a@example.com","event_name":"Test"}' };
  const data = parseRequestBody(req);
  assert.equal(data.to_email, 'a@example.com');
  assert.equal(data.event_name, 'Test');
});

test('parseRequestBody passes through an already-parsed object body', () => {
  const req = { body: { to_email: 'b@example.com', event_name: 'Test2' } };
  const data = parseRequestBody(req);
  assert.equal(data.to_email, 'b@example.com');
  assert.equal(data.event_name, 'Test2');
});

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

test('EMAIL_RE accepts a plain valid address', () => {
  assert.equal(EMAIL_RE.test('susansjostrom@gmail.com'), true);
});

test('EMAIL_RE rejects a pasted "Name <email>" blob', () => {
  assert.equal(EMAIL_RE.test('susan sjostrom <susansjostrom@gmail.com>'), false);
  assert.equal(EMAIL_RE.test('susan sjostrom <susansjostrom@gmail.com'), false);
});

test('EMAIL_RE rejects strings with no valid email shape', () => {
  assert.equal(EMAIL_RE.test('not an email'), false);
  assert.equal(EMAIL_RE.test(''), false);
});
