import { JOB_INTENT_TEMPLATES } from './intents';

/**
 * Posting-quality gate for the create/edit job forms. Template chips seed the
 * form with bracketed placeholders ("Internship — [team / function]") and hint
 * text; real postings on the board were shipping with both intact, so every
 * client and the API refuse to publish copy that is still template boilerplate.
 */

const PLACEHOLDER_PATTERN = /\[[^\[\]\n]{1,80}\]/;

/** First unresolved "[placeholder]" token in the text, or null. */
export function findJobTemplatePlaceholder(
  text: string | null | undefined,
): string | null {
  if (!text) return null;
  const match = PLACEHOLDER_PATTERN.exec(text);
  return match ? match[0] : null;
}

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}

const TEMPLATE_HINTS = new Set(
  JOB_INTENT_TEMPLATES.map((t) => normalize(t.descriptionHint)),
);

/** True when the description is still a template's verbatim hint line. */
export function jobDescriptionIsTemplateHint(
  description: string | null | undefined,
): boolean {
  if (!description) return false;
  return TEMPLATE_HINTS.has(normalize(description));
}

/**
 * Human-readable reason a posting's copy is still template boilerplate, or
 * null when it is publishable. Shared by web, mobile, and the API so the rule
 * cannot drift.
 */
export function describeJobTemplateLeftovers(
  title: string | null | undefined,
  description: string | null | undefined,
): string | null {
  const titlePlaceholder = findJobTemplatePlaceholder(title);
  if (titlePlaceholder) {
    return `Replace “${titlePlaceholder}” in the title with the actual details before posting.`;
  }
  const descriptionPlaceholder = findJobTemplatePlaceholder(description);
  if (descriptionPlaceholder) {
    return `Replace “${descriptionPlaceholder}” in the description with the actual details before posting.`;
  }
  if (jobDescriptionIsTemplateHint(description)) {
    return 'The description is still the template’s hint text — describe the actual role, duties, and pay instead.';
  }
  return null;
}
