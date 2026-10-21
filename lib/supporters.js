'use strict';

const crypto = require('node:crypto');
const express = require('express');

const DAY = 86400000;
const COOKIE = 'ero_supporter';
const DEFAULT_PORTAL_URL = 'https://billing.stripe.com/p/login/6oU28r6xFavE7Fp3wg0VO00';
const emailKey = (value) => String(value || '').trim().toLowerCase();
const SUPPORT_LINKS = {
  oneTime3: 'https://buy.stripe.com/3cIeVd4px8nw5xh5Eo0VO02',
  oneTime5: 'https://buy.stripe.com/7sYbJ109h33c1h15Eo0VO01',
  oneTime10: 'https://buy.stripe.com/6oU28r7BJ8nwcZJd6Q0VO03',
  oneTime20: 'https://buy.stripe.com/4gM5kDaNVgU26Blgj20VO04',
  customAmount: 'https://buy.stripe.com/4gM00j09h33cf7RaYI0VO05',
  monthly: 'https://buy.stripe.com/6oU28r6xFavE7Fp3wg0VO00',
};

function supporterStatus(subscriptions, payments, now = Date.now()) {
  const monthly = subscriptions.filter((sub) => sub.status === 'active'
    && Date.parse(sub.current_period_end) > now);
  if (monthly.length) {
    const firstPayments = subscriptions.map((sub) => Date.parse(sub.first_paid_at)).filter((date) => Number.isFinite(date) && date <= now);
    return { kind: 'monthly', expiresAt: new Date(Math.max(...monthly.map((sub) => Date.parse(sub.current_period_end)))).toISOString(),
      supportingSince: firstPayments.length ? new Date(Math.min(...firstPayments)).toISOString() : null,
      cancelAtPeriodEnd: monthly.every((sub) => sub.cancel_at_period_end), suppressPrompts: true };
  }
  const expires = payments.filter((payment) => !payment.refunded && payment.amount > 0)
    .map((payment) => Date.parse(payment.paid_at) + 30 * DAY).filter(Number.isFinite);
  const until = Math.max(0, ...expires);
  return { kind: until > now ? 'one-time' : 'none', expiresAt: until > now ? new Date(until).toISOString() : null,
    cancelAtPeriodEnd: false, suppressPrompts: until > now };
}

async function dbResult(query) {
  const { data, error } = await query;
  if (error) throw error;
  return data;
}

function createSupportService({ db }) {
  async function status(deviceHash, verifiedEmail) {
    if (verifiedEmail) {
      await dbResult(db.from('support_devices').upsert({ device_hash: deviceHash, verified_email: verifiedEmail,
        updated_at: new Date().toISOString() }));
    }
    const device = await dbResult(db.from('support_devices').select('verified_email').eq('device_hash', deviceHash).maybeSingle());
    const email = verifiedEmail || device?.verified_email;
    const links = await dbResult(db.from('support_device_customers').select('customer_id').eq('device_hash', deviceHash));
    const customers = email ? await dbResult(db.from('support_customers').select('id').eq('email', email)) : [];
    const ids = [...new Set([...links.map((link) => link.customer_id), ...customers.map((customer) => customer.id)])];
    const subscriptions = ids.length
      ? await dbResult(db.from('support_subscriptions').select('*').in('customer_id', ids)) : [];
    const devicePayments = await dbResult(db.from('support_payments').select('amount,paid_at,refunded').eq('device_hash', deviceHash));
    const emailPayments = email ? await dbResult(db.from('support_payments').select('amount,paid_at,refunded').eq('email', email)) : [];
    return supporterStatus(subscriptions, [...devicePayments, ...emailPayments]);
  }

  return { status };
}

function createSupportRouter({ db, env = process.env } = {}) {
  const router = express.Router();
  // Stripe updates arrive through the OC site's webhook into the shared database.
  const service = db ? createSupportService({ db }) : null;
  const enabled = Boolean(service);
  const configuredPortal = env.STRIPE_CUSTOMER_PORTAL_URL || DEFAULT_PORTAL_URL;
  const portalUrl = /^https:\/\/billing\.stripe\.com\/p\/login\/(?:test_)?[a-zA-Z0-9]+$/.test(configuredPortal)
    ? configuredPortal : null;

  router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  function deviceHash(req, res) {
    const cookie = String(req.headers.cookie || '').split(';').map((part) => part.trim()).find((part) => part.startsWith(`${COOKIE}=`));
    let token = cookie?.slice(COOKIE.length + 1);
    if (!/^[a-f0-9]{64}$/.test(token || '')) {
      token = crypto.randomBytes(32).toString('hex');
      res.append('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${req.secure || env.VERCEL ? '; Secure' : ''}`);
    }
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  router.get('/checkout', (req, res) => {
    const link = Object.hasOwn(SUPPORT_LINKS, req.query.option) ? SUPPORT_LINKS[req.query.option] : null;
    if (!link) return res.status(400).json({ error: 'Choose a valid support amount.' });
    const url = new URL(link);
    url.searchParams.set('client_reference_id', deviceHash(req, res));
    res.redirect(303, url.href);
  });

  router.get('/status', async (req, res) => {
    if (!enabled) return res.json({ enabled: false, kind: 'none', suppressPrompts: false, portalUrl });
    try {
      let email = null;
      const bearer = String(req.get('authorization') || '').match(/^Bearer (.+)$/i);
      if (bearer) {
        const { data, error } = await db.auth.getUser(bearer[1]);
        if (error || !data.user?.email_confirmed_at) return res.status(401).json({ error: 'Please verify your email again.' });
        email = emailKey(data.user.email);
      }
      const hash = deviceHash(req, res);
      const status = await service.status(hash, email);
      res.json({ enabled: true, ...status, checkoutReference: hash, portalUrl, canSync: false });
    } catch (_) {
      res.status(503).json({ error: 'Supporter recognition is temporarily unavailable.' });
    }
  });

  router.use((_req, res) => res.status(404).json({ error: 'Support endpoint not found.' }));
  return router;
}

module.exports = { createSupportRouter, createSupportService, supporterStatus };

