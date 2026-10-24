import fs from 'fs';
import nodemailer from 'nodemailer';

// Outgoing email (password resets, address verification, notifications)
// through SMTP. With no SMTP_HOST nothing is sent: features that need email
// say so (see mailEnabled), and outside production the message is printed so
// a developer can still follow its links.
//
//   SMTP_HOST, SMTP_PORT (default 587), SMTP_SECURE ("true" for port 465),
//   SMTP_USER, SMTP_PASS, MAIL_FROM (default SMTP_USER)
//   MAIL_OUTBOX: outside production, also append every message to this file
//   as one JSON line (the tests read it)

export const mailEnabled = () => Boolean(process.env.SMTP_HOST);

// The frontend's address, for links in emails: APP_URL, otherwise the first
// CLIENT_URL, otherwise the local Vite dev server
export const appUrl = (path = '') => {
  const base = process.env.APP_URL || (process.env.CLIENT_URL || '').split(',')[0].trim() || 'http://localhost:5173';
  return `${base.replace(/\/$/, '')}${path}`;
};

let transport = null;
const getTransport = () => {
  if (!transport) {
    const port = Number(process.env.SMTP_PORT) || 587;
    transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port,
      secure: process.env.SMTP_SECURE === 'true' || port === 465,
      auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined,
    });
  }
  return transport;
};

const record = (message) => {
  if (process.env.NODE_ENV === 'production') return;
  if (process.env.MAIL_OUTBOX) {
    fs.appendFileSync(process.env.MAIL_OUTBOX, `${JSON.stringify({ ...message, at: new Date().toISOString() })}\n`);
  } else if (!mailEnabled()) {
    console.log(`[mail not sent: SMTP_HOST is not set] to ${message.to}: ${message.subject}\n${message.text}`);
  }
};

// Sends one email. `to` is one address; it goes to nodemailer as an object,
// so the address is never parsed as a header. Never throws: returns
// { sent: true } or { sent: false, error? }, because a failed email must not
// fail the request that caused it.
export const sendMail = async ({ to, name, subject, text }) => {
  record({ to, subject, text });
  if (!mailEnabled()) return { sent: false };
  try {
    await getTransport().sendMail({
      from: process.env.MAIL_FROM || process.env.SMTP_USER,
      to: { name: name || '', address: to },
      subject,
      text,
    });
    return { sent: true };
  } catch (error) {
    console.error('Email failed:', error.message);
    return { sent: false, error: error.message };
  }
};
