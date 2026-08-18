'use client';

import { API_URL, writeStoredToken } from '@/lib/token';

export const DEFAULT_DESTINATION = '/games/crash';

export const ADMIN_DESTINATION = '/admin/dashboard';

export interface AuthedUser {
  id: string;
  email: string;
  role: 'USER' | 'ADMIN';
  balance?: string;
  frozen?: boolean;
}

interface AuthResponse {
  token?: string;
  user?: AuthedUser;
  error?: string;
  message?: string;
}

export class AuthError extends Error {}

const FALLBACK_COPY: Record<string, string> = {
  invalid_credentials: 'That email and password combination was not recognised.',
  invalid_credentials_format:
    'Enter a valid email address and a password of at least 8 characters.',
  email_taken: 'An account with that email already exists. Sign in instead.',
  too_many_requests: 'Too many attempts. Wait a few minutes and try again.',
  invalid_code: 'That code is not valid or has expired. Request a new one.',
  invalid_code_format: 'Enter the 6-digit code from your email.',
  invalid_email: 'Enter a valid email address.',
  email_unavailable:
    'Email sign-in is temporarily unavailable. Please use your password.',
  otp_cooldown: 'A code was just sent. Wait a moment before asking for another.',
  turnstile_failed: 'Human verification failed. Please try again.',
  weak_password: 'Choose a stronger password.',
  registration_expired: 'That registration has expired. Please start again.',
};

/** Shared by both sign-in paths: persist the token and mirror it to the cookie. */
async function establishSession(token: string): Promise<void> {
  writeStoredToken(token);
  try {
    await fetch('/api/session', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
  } catch {
    /* no-op — a cookie failure must not block an otherwise valid sign-in */
  }
}

/**
 * Display copy for a rejection. The server's own `message` wins when present —
 * it is the only party that knows which rule was broken — with the local table
 * as a fallback for bare error codes.
 */
function messageFor(body: Record<string, unknown>, status: number): string {
  const message = typeof body.message === 'string' ? body.message : undefined;
  const error = typeof body.error === 'string' ? body.error : undefined;

  return message ?? (error && FALLBACK_COPY[error]) ?? `Request failed (${status}).`;
}

export interface OtpSendResult {
  /** Seconds before another code may be requested. */
  resendAfterSeconds: number;
  expiresInSeconds: number;
  /**
   * Present only when the API has no SMTP transport configured, which it
   * refuses to do in production. Lets local development complete a sign-in
   * without an inbox.
   */
  devCode?: string;
}

/*
 * sendLoginCode was removed alongside POST /api/auth/otp/send.
 *
 * That pair let a caller name any address, receive a code, and exchange it for
 * a session without ever presenting a password. Sign-in now goes through
 * submitPassword() below, which verifies the password first and only then
 * triggers the code that verifyLoginCode() completes.
 */

/**
 * Step two: exchange the code for a session.
 *
 * The second step of password sign-in. Formerly shared with a passwordless
 * path; that path is gone, so a LOGIN code now only exists once a password has
 * been accepted.
 */
export async function verifyLoginCode(
  email: string,
  code: string,
  ref?: string | null
): Promise<AuthedUser> {
  const { response, body } = await postJson('/api/auth/otp/verify', { email, code }, ref);

  const parsed = body as AuthResponse;
  if (!response.ok || !parsed.token || !parsed.user) {
    throw new AuthError(messageFor(body, response.status));
  }

  await establishSession(parsed.token);
  return parsed.user;
}

/**
 * The answer to a password submission, now that neither sign-in nor sign-up
 * hands back a session on its own: both end with a code on its way to the
 * player's inbox.
 */
export interface CodeChallenge {
  /** Echoed by the server, so the code step never trusts the input field. */
  email: string;
  resendAfterSeconds: number;
  expiresInSeconds: number;
  /** Present only when the API has no SMTP transport (development). */
  devCode?: string;
}

async function postJson(
  path: string,
  payload: unknown,
  ref?: string | null
): Promise<{ response: Response; body: Record<string, unknown> }> {
  const query = ref ? `?ref=${encodeURIComponent(ref)}` : '';

  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}${query}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(payload),
    });
  } catch {
    throw new AuthError('Could not reach the FRIGAT server. Is it running?');
  }

  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  return { response, body };
}

function challengeFrom(
  body: Record<string, unknown>,
  fallbackEmail: string
): CodeChallenge {
  return {
    email: typeof body.email === 'string' ? body.email : fallbackEmail,
    resendAfterSeconds:
      typeof body.resendAfterSeconds === 'number' ? body.resendAfterSeconds : 60,
    expiresInSeconds:
      typeof body.expiresInSeconds === 'number' ? body.expiresInSeconds : 300,
    devCode: typeof body.devCode === 'string' ? body.devCode : undefined,
  };
}

/**
 * What a correct password earns.
 *
 * Two outcomes, because admins and designated accounts skip the email step:
 * either a code is on its way, or the session is already open.
 */
export type PasswordResult =
  | { requiresOtp: true; challenge: CodeChallenge }
  | { requiresOtp: false; user: AuthedUser };

/**
 * Sign-in step one: submit the password.
 *
 * For a standard player this produces a code in their inbox, which
 * `verifyLoginCode` then exchanges for a session. For an account the server
 * bypasses, the token comes back here and the session is established before
 * this resolves.
 */
export async function submitPassword(
  credentials: { email: string; password: string; turnstileToken?: string },
  ref?: string | null
): Promise<PasswordResult> {
  const { response, body } = await postJson('/api/auth/login', credentials, ref);

  if (!response.ok) throw new AuthError(messageFor(body, response.status));

  // The server decides which path this is. The client reads the token's
  // presence rather than trusting `requiresOtp` alone, so a malformed bypass
  // response cannot leave the form believing it is signed in with nothing to
  // sign in with.
  const parsed = body as AuthResponse;
  if (parsed.token && parsed.user) {
    await establishSession(parsed.token);
    return { requiresOtp: false, user: parsed.user };
  }

  return { requiresOtp: true, challenge: challengeFrom(body, credentials.email) };
}

/**
 * Sign-up step one: validate the address and password, and ask for a code.
 * No account exists until `confirmRegistration` succeeds.
 */
export async function requestRegistrationCode(
  credentials: { email: string; password: string; turnstileToken?: string },
  ref?: string | null
): Promise<CodeChallenge> {
  const { response, body } = await postJson(
    '/api/auth/register/request-code',
    credentials,
    ref
  );

  if (!response.ok) throw new AuthError(messageFor(body, response.status));

  return challengeFrom(body, credentials.email);
}

/**
 * Password reset step one: ask for a code.
 *
 * Succeeds whether or not the address has an account — the server answers
 * identically either way, so nothing here can report "no such user".
 */
export async function requestPasswordReset(
  email: string,
  turnstileToken?: string
): Promise<CodeChallenge> {
  const { response, body } = await postJson('/api/auth/forgot-password/request', {
    email,
    turnstileToken,
  });

  if (!response.ok) throw new AuthError(messageFor(body, response.status));

  return challengeFrom(body, email);
}

/**
 * Password reset step two: spend the code and set the new password.
 *
 * Returns the server's confirmation copy. No session comes back — the player
 * signs in with the password they just chose.
 */
export async function resetPassword(input: {
  email: string;
  code: string;
  newPassword: string;
}): Promise<string> {
  const { response, body } = await postJson('/api/auth/forgot-password/reset', input);

  if (!response.ok) throw new AuthError(messageFor(body, response.status));

  return typeof body.message === 'string'
    ? body.message
    : 'Password reset successfully. You can now sign in.';
}

/** Sign-up step two: the code creates the account and opens the session. */
export async function confirmRegistration(
  email: string,
  code: string,
  ref?: string | null
): Promise<AuthedUser> {
  const { response, body } = await postJson(
    '/api/auth/register/confirm',
    { email, code },
    ref
  );

  const parsed = body as AuthResponse;
  if (!response.ok || !parsed.token || !parsed.user) {
    throw new AuthError(messageFor(body, response.status));
  }

  await establishSession(parsed.token);
  return parsed.user;
}

export function safeDestination(next: string | null): string {
  if (!next || !next.startsWith('/') || next.startsWith('//')) {
    return DEFAULT_DESTINATION;
  }
  return next;
}
