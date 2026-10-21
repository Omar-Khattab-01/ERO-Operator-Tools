'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const crypto = require('node:crypto');
const { createSupportRouter, createSupportService, supporterStatus } = require('../lib/supporters');
const DAY = 86400000;

test('shared records prioritize active monthly support and expire one-time support after 30 days', () => {
  const now = Date.now();
  const payments = [{ amount: 500, paid_at: new Date(now - DAY).toISOString() }];
  assert.equal(supporterStatus([], payments, now).kind, 'one-time');
  assert.equal(supporterStatus([], payments, now + 29 * DAY).kind, 'none');
  assert.equal(supporterStatus([], [{ ...payments[0], refunded: true }], now).kind, 'none');
  const sub = { status: 'active', current_period_end: new Date(now + DAY).toISOString(),
    first_paid_at: new Date(now - 60 * DAY).toISOString() };
  assert.equal(supporterStatus([sub], payments, now).kind, 'monthly');
  assert.equal(supporterStatus([{ ...sub, status: 'canceled' }], [], now).kind, 'none');
});

function fakeDb() {
  const rows = { support_devices: [], support_device_customers: [], support_customers: [],
    support_subscriptions: [], support_payments: [] };
  return { rows, auth: { getUser: async (token) => token === 'verified'
    ? { data: { user: { email: 'Supporter@example.com', email_confirmed_at: '2026-01-01' } } }
    : { error: true, data: {} } },
  from(table) {
    let filters = [];
    let single = false;
    const query = { select() { return query; }, eq(key, value) { filters.push((r) => r[key] === value); return query; },
      in(key, values) { filters.push((r) => values.includes(r[key])); return query; },
      maybeSingle() { single = true; return query; },
      upsert(row) { rows[table] = [row]; return query; },
      then(resolve, reject) { const result = rows[table].filter((r) => filters.every((f) => f(r)));
        return Promise.resolve({ data: single ? result[0] || null : result }).then(resolve, reject); } };
    return query;
  } };
}

test('shared OC webhook device references are recognized by ERO without a Stripe key', async () => {
  const db = fakeDb();
  db.rows.support_device_customers.push({ device_hash: 'ero-device', customer_id: 'cus_shared' });
  db.rows.support_subscriptions.push({ customer_id: 'cus_shared', status: 'active',
    current_period_end: new Date(Date.now() + DAY).toISOString() });
  assert.equal((await createSupportService({ db }).status('ero-device')).kind, 'monthly');
});

test('checkout uses an HttpOnly cookie and hashed reference; email recovery requires verified auth', async (t) => {
  const db = fakeDb();
  db.rows.support_payments.push({ email: 'supporter@example.com', amount: 500, paid_at: new Date().toISOString() });
  const app = express();
  app.use('/api/support', createSupportRouter({ db, env: {} }));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const base = 'http://127.0.0.1:' + server.address().port + '/api/support';
  let response = await fetch(base + '/checkout?option=monthly', { redirect: 'manual' });
  assert.equal(response.status, 303);
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly; SameSite=Lax/);
  const token = cookie.match(/ero_supporter=([a-f0-9]+)/)[1];
  assert.equal(new URL(response.headers.get('location')).searchParams.get('client_reference_id'),
    crypto.createHash('sha256').update(token).digest('hex'));
  response = await fetch(base + '/checkout?option=https://evil.example', { redirect: 'manual' });
  assert.equal(response.status, 400);
  response = await fetch(base + '/status', { headers: { Authorization: 'Bearer forged' } });
  assert.equal(response.status, 401);
  response = await fetch(base + '/status', { headers: { Authorization: 'Bearer verified', Cookie: cookie.split(';')[0] } });
  const status = await response.json();
  assert.equal(status.enabled, true);
  assert.equal(status.kind, 'one-time');
  assert.equal(JSON.stringify(status).includes('supporter@example.com'), false);
  response = await fetch(base + '/status', { headers: { Cookie: cookie.split(';')[0] } });
  assert.equal((await response.json()).kind, 'one-time');
});
