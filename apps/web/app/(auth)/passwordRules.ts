'use client';

/**
 * FRIGAT — Password rules checklist
 *
 * Shared by registration and password reset. Both forms promise the same thing
 * to the player, and both are checked by the same `passwordProblems()` on the
 * server — a checklist that drifted from the other would tell someone their
 * password is fine right before the API refuses it.
 */

import { PASSWORD_POLICY, passwordProblems } from '@frigat/shared';

export const PASSWORD_RULES = [
  { code: 'too_short', label: `At least ${PASSWORD_POLICY.minLength} characters` },
  { code: 'missing_uppercase', label: 'An uppercase letter' },
  { code: 'missing_lowercase', label: 'A lowercase letter' },
  { code: 'missing_digit', label: 'A number' },
] as const;

export interface PasswordState {
  /** Rule codes the current value fails. */
  failing: Set<string>;
  /** True once the value is non-empty and breaks no rule. */
  ready: boolean;
}

export function evaluatePassword(password: string): PasswordState {
  const failing = new Set(passwordProblems(password).map((problem) => problem.code));
  return { failing, ready: password.length > 0 && failing.size === 0 };
}
