/**
 * FRIGAT — operator identity.
 *
 * Every legal page reads its operator details from here, so the details exist
 * in exactly one place rather than being retyped into three documents that
 * then drift apart.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * THESE VALUES ARE PLACEHOLDERS AND MUST BE REPLACED BEFORE LAUNCH.
 * ─────────────────────────────────────────────────────────────────────────
 *
 * They are deliberately written as obvious placeholders rather than as
 * plausible-looking details. A privacy policy naming an invented company, or a
 * footer citing a licence number that was never issued, is worse than a
 * missing one: in most jurisdictions publishing a fabricated gambling licence
 * is itself an offence, and an invented controller name makes the GDPR
 * contact obligations unsatisfiable. Nothing here can be guessed from the
 * codebase, so nothing here has been guessed.
 *
 * `LEGAL_DETAILS_INCOMPLETE` below is derived from the values, not maintained
 * by hand: fill them in and the launch banner disappears on its own.
 */

export interface OperatorDetails {
  /** Registered company name, exactly as it appears on the incorporation record. */
  legalName: string;
  /** Trading name shown to players. */
  tradingName: string;
  /** Company registration number. */
  registrationNumber: string;
  /** Registered address, one line per element. */
  address: readonly string[];
  /** Country/state whose law governs the terms and whose courts have jurisdiction. */
  jurisdiction: string;
  /** Gambling licence: issuing authority and number. Both empty until licensed. */
  licenceAuthority: string;
  licenceNumber: string;
  /** General support mailbox. */
  supportEmail: string;
  /** Mailbox that reaches whoever answers data-protection requests. */
  privacyEmail: string;
  /**
   * Data Protection Officer. The GDPR only requires one for large-scale
   * systematic monitoring or large-scale special-category processing; a
   * gambling operator profiling players for risk and AML usually qualifies.
   * Leave empty if counsel confirms one is not required.
   */
  dpoName: string;
  /** Canonical public origin, no trailing slash. Used for canonical URLs and the sitemap. */
  siteUrl: string;
  /** Minimum age to hold an account, in years. */
  minimumAge: number;
}

const PLACEHOLDER = '[TO BE COMPLETED]';

export const OPERATOR: OperatorDetails = {
  legalName: PLACEHOLDER,
  tradingName: 'FRIGAT',
  registrationNumber: PLACEHOLDER,
  address: [PLACEHOLDER],
  jurisdiction: PLACEHOLDER,
  licenceAuthority: '',
  licenceNumber: '',
  supportEmail: PLACEHOLDER,
  privacyEmail: PLACEHOLDER,
  dpoName: '',
  
  siteUrl: (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    'https://frigat.example'
  ).replace(/\/$/, ''),
  minimumAge: 18,
};

/** Fields that must be real before the site takes money from the public. */
const REQUIRED_FIELDS: readonly (keyof OperatorDetails)[] = [
  'legalName',
  'registrationNumber',
  'jurisdiction',
  'supportEmail',
  'privacyEmail',
];

/**
 * True while any required detail is still a placeholder. Drives the visible
 * pre-launch banner on the legal pages — a build-time constant, so the banner
 * costs nothing at runtime and cannot be forgotten in review.
 */
export const LEGAL_DETAILS_INCOMPLETE: boolean =
  REQUIRED_FIELDS.some((field) => {
    const value = OPERATOR[field];
    return typeof value === 'string' && (value === PLACEHOLDER || value.trim() === '');
  }) || OPERATOR.address.some((line) => line === PLACEHOLDER);

/** True once a real gambling licence has been recorded above. */
export const IS_LICENSED: boolean =
  OPERATOR.licenceAuthority.trim() !== '' && OPERATOR.licenceNumber.trim() !== '';

/** Date the legal documents were last substantively revised (ISO, UTC). */
export const LEGAL_LAST_UPDATED = '2026-08-29';
