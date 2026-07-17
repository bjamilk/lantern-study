/** Base URL for hosted legal pages (web). Mobile may open these or use in-app Legal screen. */
export const LEGAL_BASE_URL =
  (typeof process !== 'undefined' && process.env?.EXPO_PUBLIC_LEGAL_BASE_URL) ||
  'https://lanternstudy.com';

export type LegalDocumentId = 'privacy' | 'terms' | 'cookies';

export const LEGAL_PATHS: Record<LegalDocumentId, string> = {
  privacy: '/privacy',
  terms: '/terms',
  cookies: '/cookies',
};

export function getLegalPageUrl(doc: LegalDocumentId): string {
  const base = LEGAL_BASE_URL.replace(/\/$/, '');
  return `${base}${LEGAL_PATHS[doc]}`;
}

export const LEGAL_DOCUMENT_TITLES: Record<LegalDocumentId, string> = {
  privacy: 'Privacy Policy',
  terms: 'Terms of Service',
  cookies: 'Cookie Policy',
};

export const PRIVACY_POLICY_MD = `# Privacy Policy

**Last updated:** July 17, 2026

Lantern Study ("Lantern Study," "Brand," "we," "our," or "us") provides collaborative exam preparation and study tools — including flashcards, tests, notes, study groups, campus marketplace listings, and AI-assisted learning features — through our website at [lanternstudy.com](https://lanternstudy.com) and our mobile applications.

This Privacy Notice ("Notice") describes the types of personal information we may collect about you, how we collect, use, process, and disclose that information, and the choices you can make. It applies to personal information collected through our website, mobile applications, the products and services we offer, from third parties, and anywhere else this Notice is posted.

Please read this Notice carefully. If you do not want your personal information processed in accordance with this Notice, you should not use our products and services or engage with us.

For questions about this Notice or related procedures, contact us at **privacy@lanternstudy.com**. General product support is available at **support@lanternstudy.com**.

**Important:** This Notice is maintained for operational transparency. Have qualified legal counsel review it before relying on it for regulated market launches.

## Personal information we collect and how we use it

We collect, use, process, and disclose information to operate Lantern Study — for example to create and maintain accounts, sync study content, run AI features you request, support collaboration, operate the campus marketplace, improve the product, provide customer support, protect security and integrity, detect fraud or abuse, and comply with law.

Information may be collected directly from you, automatically from your device or browser, or from third parties (such as OAuth providers).

| Information type | Purpose | Service providers / recipients |
|------------------|---------|--------------------------------|
| **Personal identifiers** — name, username, email, phone (optional), avatar, profile bio, social handles you choose to share, website login credentials, age indicators (e.g. 16+ eligibility) | Create and maintain your account; deliver the Service; contact you about your account or this Notice; provide support; security and fraud prevention; legal compliance | Supabase (auth/database); Google / Apple (OAuth); customer support tooling; professional advisors; law enforcement when required |
| **Study & education information** — decks, flashcards, notes, photo notes, test results, study activity, streaks/XP, group membership, campus affiliation for marketplace | Provide study features; sync across devices; personalize learning tools; operate groups and marketplace eligibility | Supabase storage/database; AI providers when you invoke AI on that content |
| **Social & communications** — group messages, direct messages, discussion content, contact-form submissions | Enable collaboration and support; enforce community rules; respond to privacy or support requests | Supabase realtime/database; email delivery (e.g. Resend) for contact/transactional mail |
| **Marketplace information** — listings, images, inquiries, campus/location context, wallet/coin balances where applicable | Operate peer-to-peer campus marketplace; show listings; abuse prevention | Supabase; optional image storage; **we do not process card payments for peer-to-peer marketplace sales** |
| **AI usage metadata** — feature used, provider, timestamps, rate-limit counters; prompt-related content only when you run an AI feature | Deliver AI features; rate limiting; auditability; improve reliability | Groq, Google Gemini, Cloudflare Workers AI, Hugging Face (selected by availability) |
| **Payment information** — only if we introduce paid subscriptions or in-app purchases that we process directly | Process those payments; fraud prevention; tax/accounting | Payment processors (when enabled); back-office/security providers |
| **Internet / device / geolocation-related** — IP address, device/app version, push tokens, cookies and similar storage, approximate location derived from IP or campus selection you provide, browsing/interaction on our site | Authentication and security; essential site function; analytics **only if you opt in**; abuse detection | Hosting/CDN; Supabase; Expo (push); optional analytics providers if consented; Sentry (optional error monitoring) |
| **Inferences** — study preferences or product usage patterns derived from activity | Improve product design and (with consent where required) personalize experience | Internal systems; analytics providers if consented |

We do not intentionally collect special-category data (for example health, biometric templates, or precise geolocation tracking) as part of core study features. Do not submit sensitive personal information unless we clearly ask for it and you consent.

### Social media

If you interact with Lantern Study content on third-party social platforms (for example liking or sharing a post), those platforms may share limited public profile information with us according to their settings. Posts that mention our brand may be reshared on our channels. Review each platform’s privacy notice and your privacy settings there.

### Employment / candidates

If you apply for a role with us, we and our service providers may process application materials (name, contact details, education, and employment history) to evaluate your candidacy and contact you about the role.

## How we share personal information

### Service providers

We use processors that act on our behalf — hosting and database (Supabase), AI inference providers when you use AI features, OAuth providers, email delivery, error monitoring (optional), and push notification delivery (Expo). They may receive identifiers, account data, content needed for the service, device tokens, IP addresses, and similar technical data, and may use that information only to provide their service to us.

### Campus / sponsor organizations

If your school, club, or another organization sponsors access or you join an organization-linked space, we may share limited account or participation information needed to administer that relationship.

### Professional advisors

We may share information with lawyers, auditors, insurers, or similar advisors where needed for the services they provide to us.

### Compliance, fraud prevention, and safety

We may share information to protect rights and safety, enforce our [Terms of Service](/terms), investigate abuse, or respond to lawful requests.

### Business transfers

If we are involved in a merger, acquisition, financing, reorganization, bankruptcy, or sale of assets, personal information may be transferred as part of that transaction. We will take reasonable steps to require the recipient to honor this Notice.

### Business partners

If you choose an offer that includes a partner product or service, we may share the information needed to fulfill that offer (typically name and email) with that partner, as disclosed at the time of the offer.

### Affiliates

We may share information among Lantern Study affiliates for purposes described in this Notice.

### Regulatory and law enforcement

We may disclose information when required by law, legal process, or to protect the security or integrity of our systems.

## Cookies and similar technologies

We use cookies, local storage, and similar technologies as described in our [Cookie Policy](/cookies). You can manage optional categories through the Cookie Preference Center on the website. Strictly necessary storage (including sign-in and remembering your cookie choices) cannot be disabled.

## Children

Lantern Study is intended for an adult and older-teen audience (16+). We do not knowingly collect personal information from children under 16. If you believe we have collected information from a child under 16 without appropriate consent, contact **privacy@lanternstudy.com** and we will delete it as soon as practicable.

## Security

We use administrative, technical, and organizational measures designed to protect personal information — including TLS in transit, authentication, database access controls (including row-level security), rate limiting, and least-privilege operational access. No security program is perfect. If you believe your account or data has been compromised, contact **privacy@lanternstudy.com** promptly.

## Retention

We keep personal information only as long as needed for the purposes described, including legal, accounting, and security needs:

| Data type | Typical retention |
|-----------|-------------------|
| Account and study content | Until you delete your account (subject to legal holds / backups) |
| AI inference metadata logs | About 90 days |
| Server / request logs | About 30–90 days |
| Admin audit logs | About 24 months (anonymized where practicable after deletion) |
| Cookie preference record | Until you clear site data or update preferences |

## Third-party websites

Links to third-party sites are provided for convenience. Their privacy practices are their own. Review those policies before providing personal information there.

## International transfers

We and our subprocessors may process information in the United States and other countries that may not provide the same level of protection as your home country. Where required, we use appropriate safeguards (such as Standard Contractual Clauses). By using the Service, you acknowledge that your information may be transferred internationally as described here.

## AI features and third-party AI providers

When you use AI features, relevant content (notes, questions, chat messages, audio for transcription, etc.) may be sent to third-party AI providers (including Groq, Google Gemini, Cloudflare Workers AI, and Hugging Face) to generate a response. AI output can be wrong — it is not medical, legal, or professional advice. See our [Terms of Service](/terms) and [AI System Card](https://lanternstudy.com/docs/ai-system-card).

We log AI metadata (feature, provider, timestamp) for rate limiting and auditability. We do not store full prompts in inference logs by default.

## Changes to this Notice

We may update this Notice periodically. For material changes we will endeavor to provide a prominent notice on the site or in-app, or contact you by email where appropriate. The "Last updated" date at the top reflects the latest revision. Review this page periodically.

## Contact

**privacy@lanternstudy.com** — privacy and data-subject requests  
**support@lanternstudy.com** — product support  

In-product tools: Settings → Export my data; Settings → Delete account.

---

## Supplemental notice for residents of California (CCPA / CPRA)

**Last updated:** July 17, 2026

This section supplements the Notice for California residents.

For categories of personal information, sources, purposes, and recipients, see **Personal information we collect and how we use it** above.

### Rights to know, delete, correct, and opt out

Subject to legal exceptions, California residents may request:

- Categories and specific pieces of personal information we collected about you
- Categories of sources, business/commercial purposes, and third parties with whom we disclosed information
- Deletion or correction of personal information
- Opt-out of "sale" or "sharing" of personal information for cross-context behavioral advertising, where applicable

You may make up to two "requests to know" in a 12-month period. To exercise rights, email **privacy@lanternstudy.com**. We will verify your identity before fulfilling requests. You may use an authorized agent with appropriate proof of authority.

We do not knowingly sell personal information of consumers under 16. We do not charge a different price or provide a different quality of service solely because you exercised CCPA rights, except as permitted for voluntary loyalty or similar programs.

### "Sale" / sharing via advertising technologies

If we disclose identifiers, internet activity, geolocation-related data, or inferences to advertising or ad-tech partners in a way that constitutes a "sale" or "sharing" under California law, you may opt out via the Cookie Preference Center (disable Advertising & Social) and by emailing **privacy@lanternstudy.com**. **As of the Last updated date, Lantern Study does not deploy advertising or social tracking cookies.**

### Shine the Light

California residents may request information about disclosures of certain information to third parties for their direct marketing purposes in the prior calendar year by contacting **privacy@lanternstudy.com** (once per calendar year).

---

## Supplemental notice for residents of Nevada

**Last updated:** July 17, 2026

Nevada residents may opt out of the sale of certain covered information by contacting **privacy@lanternstudy.com**. As of the Last updated date, we do not sell covered information as defined under Nevada law.

---

## Supplemental notice for the EEA, Switzerland, United Kingdom (GDPR / UK GDPR), and Brazil (LGPD)

**Last updated:** July 17, 2026

### Data controller

For personal information processed in connection with Lantern Study accounts and the public website/apps, the controller is Lantern Study (contact: **privacy@lanternstudy.com**). This Notice does not apply where we act solely as a processor on behalf of an institutional customer under a separate agreement.

### Legal bases

We process personal information where:

- **Contract** — needed to provide the Service you request (account, sync, features you use)
- **Legitimate interests** — security, fraud prevention, product improvement, limited direct communications about the Service, where not overridden by your rights
- **Consent** — optional cookies/analytics/advertising technologies; certain AI or marketing uses where required — you may withdraw consent at any time
- **Legal obligation** — tax, accounting, lawful requests

### International transfers

When we transfer personal information from the EEA, Switzerland, UK, or Brazil to countries without an adequacy decision, we use appropriate safeguards (such as EU Standard Contractual Clauses) or other lawful transfer mechanisms.

### Sensitive personal information

Do not submit sensitive personal information (for example racial or ethnic origin, health data, or biometric templates) unless we expressly request it and you consent. If you believe we hold such data in error, contact **privacy@lanternstudy.com**.

### Your rights

Depending on your location, you may have the right to access, rectify, erase, restrict, object to processing, and data portability. Submit requests to **privacy@lanternstudy.com** or use in-app export/delete tools. We may decline requests that are unfounded, excessive, or legally barred (for example where retention is required for fraud prevention or legal records).

You may lodge a complaint with your local data protection authority.
`;


export const TERMS_OF_SERVICE_MD = `# Terms of Service

**Last updated:** June 13, 2026

These Terms of Service ("Terms") govern your use of Lantern Study web and mobile applications ("Service"). By creating an account or using the Service, you agree to these Terms.

**Important:** This document is an engineering template. Have qualified legal counsel review it before production launch.

## 1. Eligibility

You must be at least 16 years old and able to form a binding contract. You are responsible for your account credentials.

## 2. Acceptable use

You agree not to:

- Violate laws or others' rights
- Upload malware, spam, or abusive content
- Attempt unauthorized access or scrape the Service at scale
- Use AI features to generate harmful, illegal, or deceptive content
- Misrepresent marketplace listings or engage in fraud

We may suspend or terminate accounts that violate these Terms.

## 3. Your content

You retain ownership of content you create (decks, notes, messages, listings). You grant us a limited license to host, process, and display your content solely to operate the Service, including AI features you invoke.

You are responsible for content you share in groups or the marketplace.

## 4. AI features

AI-generated flashcards, questions, explanations, and chat responses are provided **as-is** and may contain errors. AI output is **not professional advice**. You must review AI-generated study material before relying on it in academic or professional settings.

AI usage is subject to daily rate limits. We may change providers, models, or limits with reasonable notice where practicable.

## 5. Marketplace

Marketplace listings are user-generated and intended for **Nigerian campus communities** with **on-campus pickup**. Prices are shown in Nigerian Naira (₦). Payments are arranged directly between buyers and sellers unless we explicitly state otherwise.

You must be at least **16 years old** to buy or sell on the marketplace. You are responsible for meeting safely on campus, verifying items, and complying with your institution's rules.

We do not guarantee the quality, safety, or legality of items or services offered. Lantern Study is not a party to peer-to-peer transactions and does not provide payment processing for marketplace sales.

## 6. Privacy

Our [Privacy Policy](/privacy) describes how we handle personal data.

## 7. Account termination

You may delete your account at any time in Settings. We may terminate or suspend access for violations, legal requirements, or prolonged inactivity.

## 8. Disclaimers

THE SERVICE IS PROVIDED "AS IS" WITHOUT WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE, OR NON-INFRINGEMENT.

## 9. Limitation of liability

TO THE MAXIMUM EXTENT PERMITTED BY LAW, LANTERN STUDY SHALL NOT BE LIABLE FOR INDIRECT, INCIDENTAL, SPECIAL, CONSEQUENTIAL, OR PUNITIVE DAMAGES, OR ANY LOSS OF DATA, PROFITS, OR GOODWILL.

## 10. Governing law

These Terms are governed by the laws applicable in your jurisdiction of residence where mandatory consumer protections apply, otherwise as specified by counsel during legal review.

## 11. Changes

We may update these Terms. Continued use after changes constitutes acceptance of the updated Terms.

## 12. Contact

**support@lanternstudy.com**
`;

export const COOKIE_NOTICE_MD = `# Cookie Policy

**Last updated:** July 17, 2026

This Cookie Policy explains how Lantern Study ("we," "our," or "us") uses cookies and similar technologies on [lanternstudy.com](https://lanternstudy.com) and related web experiences, and how the **Cookie Preference Center** works. It supplements our [Privacy Policy](/privacy).

## Cookie Preference Center

When you visit Lantern Study, we store cookies and similar data on your browser to collect information. That information may relate to you, your preferences, or your device, and is mostly used to make the site work as you expect and to provide a more personalized experience when you allow it.

We may share information about your use of our site with analytics or advertising partners **only if those technologies are deployed and you have opted in** through the Preference Center. You can choose not to allow certain types of cookies, which may affect optional features.

Click category headings in the Preference Center (opened from the cookie banner or via **Manage cookie preferences** on this site) to learn more and change defaults. You **cannot** opt out of Strictly Necessary cookies — they are required for the site to function (including showing the banner, remembering your settings, keeping you signed in, and applying theme/UI preferences).

By clicking **Confirm my choices**, **Accept all**, or **Essential only**, you consent to our collection and use of cookies as indicated by your selections. For more detail, continue reading this Policy and our [Privacy Policy](/privacy).

### How to open preferences again

- Use **Manage cookie preferences** on the cookie banner or on legal pages, or  
- Clear site data for lanternstudy.com (you will be asked again), or  
- Contact **privacy@lanternstudy.com** if you need help.

## Cookie protocol (categories)

Lantern Study groups cookies and similar technologies into the following categories. Optional categories default to **off**. Technologies in a category are only loaded when (1) they are deployed in production and (2) your stored preference allows that category.

| Category | Can disable? | Currently deployed? | Purpose |
|----------|--------------|---------------------|---------|
| **Strictly Necessary** | No | Yes | Sign-in/session, security, cookie consent record, theme, core UI preferences |
| **Functional** | Yes | No | Optional convenience preferences beyond core operation |
| **Performance & Analytics** | Yes | No | Understand usage to improve reliability and product design |
| **Advertising & Social** | Yes | No | Campaign measurement or interest-based advertising / social pixels |

### Storage we use today (Strictly Necessary)

| Name / storage | Type | Purpose | Duration |
|----------------|------|---------|----------|
| Supabase auth session | Cookie / local storage | Keep you signed in | Session / refresh token lifetime |
| \`lantern_cookie_prefs_v2\` | Local storage | Remember Cookie Preference Center choices | Until cleared or updated |
| \`theme\` | Local storage | Dark / light mode | Until cleared |
| \`ui-storage\` | Local storage | Core UI preferences (e.g. low-data mode) | Until cleared |

Legacy note: older clients may still have \`lantern_cookie_notice_v1\` (dismissed). That is treated as an **Essential only** choice until you set new preferences.

### Similar technologies

- **Local storage / session storage** — used like cookies for preferences and sessions on the web app.  
- **Pixels / beacons** — not currently deployed; if introduced, they fall under Analytics or Advertising and require opt-in where required by law.  
- **SDKs (mobile)** — the mobile apps store session tokens and preferences in on-device storage (e.g. AsyncStorage), not browser cookies. The same category rules apply to optional SDKs if added later.

## Behavioral advertising and analytics

If we enable Google Analytics or similar tools in the future, we will gate them behind the **Performance & Analytics** preference and update this Policy. You will be able to opt out in the Preference Center. We do not currently modify experiences based on browser "Do Not Track" signals alone; use the Preference Center for control.

## Mobile apps

Mobile builds show an essential-storage notice aligned with this Policy. Optional SDK categories, if introduced, will respect the same consent categories stored on-device.

## Changes

We may update this Cookie Policy when our practices change. Material changes will be reflected in the **Last updated** date and, where appropriate, by resetting or re-prompting for consent.

## Contact

**privacy@lanternstudy.com**
`;

export const LEGAL_DOCUMENT_CONTENT: Record<LegalDocumentId, string> = {
  privacy: PRIVACY_POLICY_MD,
  terms: TERMS_OF_SERVICE_MD,
  cookies: COOKIE_NOTICE_MD,
};

export function getLegalDocumentContent(doc: LegalDocumentId): string {
  return LEGAL_DOCUMENT_CONTENT[doc];
}
