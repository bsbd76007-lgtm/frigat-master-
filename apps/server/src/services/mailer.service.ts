/**
 * FRIGAT — Outbound email
 *
 * One transport, decided once at boot from the SMTP_* environment. With no host
 * configured the transport becomes a logger: local development gets the code on
 * stdout instead of a delivery failure, which is the difference between a
 * feature you can try and one you cannot.
 *
 * The fallback is deliberately loud and deliberately refuses to run in
 * production. A login code printed to the server log is a credential in a place
 * credentials should never be — fine on a laptop, unacceptable anywhere real —
 * so `NODE_ENV=production` without SMTP is a startup-visible error rather than
 * a silent downgrade to "nobody can log in".
 */

import nodemailer, { type Transporter } from 'nodemailer';

import { config } from '../config';

export interface Mail {
  to: string;
  subject: string;
  text: string;
  html?: string;
}

export interface MailerResult {
  delivered: boolean;
  /** Set only by the development fallback, for tests and local sign-in. */
  preview?: string;
}

type Logger = { info: (obj: unknown, msg: string) => void; warn: (obj: unknown, msg: string) => void };

let transport: Transporter | null = null;
let resolved = false;

function smtpConfigured(): boolean {
  return config.smtp.host.length > 0;
}

function getTransport(): Transporter | null {
  if (resolved) return transport;
  resolved = true;

  if (!smtpConfigured()) {
    transport = null;
    return null;
  }

  transport = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    // Implicit TLS on 465; STARTTLS is negotiated on everything else.
    secure: config.smtp.port === 465,
    ...(config.smtp.user
      ? { auth: { user: config.smtp.user, pass: config.smtp.pass } }
      : {}),
  });

  return transport;
}

export class MailerNotConfiguredError extends Error {
  constructor() {
    super('SMTP is not configured and the development fallback is disabled');
    this.name = 'MailerNotConfiguredError';
  }
}

export async function sendMail(mail: Mail, log: Logger): Promise<MailerResult> {
  const smtp = getTransport();

  if (!smtp) {
    if (config.env === 'production') throw new MailerNotConfiguredError();

    // Development fallback. The body is logged in full, including the code.
    log.warn(
      { to: mail.to, subject: mail.subject, body: mail.text },
      'SMTP not configured — email logged instead of sent (development only)'
    );
    return { delivered: false, preview: mail.text };
  }

  await smtp.sendMail({
    from: config.smtp.from,
    to: mail.to,
    subject: mail.subject,
    text: mail.text,
    ...(mail.html ? { html: mail.html } : {}),
  });

  log.info({ to: mail.to, subject: mail.subject }, 'email sent');
  return { delivered: true };
}

/** True when a real transport exists — surfaced so routes can describe reality. */
export function isMailerLive(): boolean {
  return getTransport() !== null;
}
