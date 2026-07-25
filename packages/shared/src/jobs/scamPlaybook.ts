/**
 * Scam playbook for job posts and first-touch messages.
 * Used for create-time heuristics and admin triage.
 */

export const JOBS_BANNED_PHRASE_PATTERNS: RegExp[] = [
  /\bpay\s*(to\s*)?start\b/i,
  /\btraining\s*fee\b/i,
  /\bregistration\s*fee\b/i,
  /\bgift\s*card\b/i,
  /\bwestern\s*union\b/i,
  /\bmoneygram\b/i,
  /\bcrypto\b/i,
  /\bbitcoin\b/i,
  /\busdt\b/i,
  /\bbvn\b/i,
  /\bnin\b/i,
  /\bbank\s*(details|account|otp)\b/i,
  /\botp\b/i,
  /\bsend\s*(me\s*)?(your\s*)?(password|pin)\b/i,
  /\bmule\b/i,
  /\bmoney\s*transfer\s*agent\b/i,
  /\bwork\s*from\s*home\s*guaranteed\b/i,
  /\bearn\s*\$?\d{3,}\s*(a|per)\s*day\b/i,
];

export type JobScamFlagSeverity = 'block' | 'flag';

export interface JobScamMatch {
  pattern: string;
  severity: JobScamFlagSeverity;
}

/** Returns matches that should block create/apply messaging. */
export function findJobScamMatches(text: string | null | undefined): JobScamMatch[] {
  if (!text || !text.trim()) return [];
  const matches: JobScamMatch[] = [];
  for (const pattern of JOBS_BANNED_PHRASE_PATTERNS) {
    if (pattern.test(text)) {
      matches.push({
        pattern: pattern.source,
        severity: 'block',
      });
    }
  }
  return matches;
}

export function textFailsJobScamCheck(text: string | null | undefined): boolean {
  return findJobScamMatches(text).some((m) => m.severity === 'block');
}

export const JOBS_SCAM_PLAYBOOK_SUMMARY = [
  'Never ask applicants for BVN, NIN, bank OTP, or passwords.',
  'Never require a fee, gift card, or crypto deposit to start work.',
  'Never hire for money-mule / “receive and forward funds” roles.',
  'State compensation clearly: paid range, unpaid (flagged), or discuss.',
  'Prefer verified companies, known orgs, or safe public meetups; report suspicious posts.',
] as const;
