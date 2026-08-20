/**
 * Platform product feature registry for the Admin Console.
 * Keep entries detailed so superadmins can verify what shipped, where it lives, and ops notes.
 */

export type ProductFeatureArea =
  | 'notes'
  | 'groups'
  | 'jobs'
  | 'chat'
  | 'marketplace'
  | 'platform';

export type ProductFeatureStatus = 'shipped' | 'partial' | 'planned';

export type ProductFeatureSurface = 'web' | 'mobile' | 'api' | 'database';

export interface ProductFeatureEntry {
  id: string;
  title: string;
  area: ProductFeatureArea;
  status: ProductFeatureStatus;
  /** ISO date (YYYY-MM-DD) when the feature reached production. */
  shippedAt: string;
  summary: string;
  /** Detailed product/behavior description for operators. */
  details: string[];
  /** Where users reach the feature. */
  howToUse: string[];
  surfaces: ProductFeatureSurface[];
  /** Ops / support / moderation implications. */
  adminNotes: string[];
  /** Optional related commit SHAs or deploy tags. */
  commits?: string[];
}

export const PRODUCT_FEATURE_AREAS: { id: ProductFeatureArea | 'all'; label: string }[] = [
  { id: 'all', label: 'All areas' },
  { id: 'notes', label: 'Notes' },
  { id: 'groups', label: 'Groups' },
  { id: 'chat', label: 'Chat' },
  { id: 'jobs', label: 'Jobs' },
  { id: 'marketplace', label: 'Marketplace' },
  { id: 'platform', label: 'Platform' },
];

export const PRODUCT_FEATURES: ProductFeatureEntry[] = [
  {
    id: 'notes-folder-rename-delete',
    title: 'Notes — rename and delete folders',
    area: 'notes',
    status: 'shipped',
    shippedAt: '2026-07-25',
    summary:
      'Owners can rename or delete note folders from the Notes screen without losing the notes inside them.',
    details: [
      'Folder chips expose Rename and Delete actions (web: ⋯ menu; mobile: ⋯ button or long-press).',
      'Delete removes only the folder container. Notes in that folder are unfiled (folder_id cleared) and remain under All notes.',
      'If the deleted folder was selected, the UI returns to All notes.',
      'API already supported PATCH/DELETE on note folders; this release wired stores, handlers, and UI on web and mobile.',
    ],
    howToUse: [
      'Web desktop: Library → Notes → folder chip ⋯ → Rename or Delete folder.',
      'Web phone: same ⋯ control; menu is portaled so it is not clipped by the horizontal folder scroller.',
      'Mobile app: Notes → folder chip ⋯ (or long-press) → Rename / Delete folder.',
      'Delete confirmation explains that notes stay in All notes.',
    ],
    surfaces: ['web', 'mobile', 'api'],
    adminNotes: [
      'Hard delete of the folder row only — not soft-archive. There is no folder archive API.',
      'Support: if a user thinks notes vanished after folder delete, check All notes / search; notes should still exist unfiled.',
      'No new moderation surface required.',
    ],
    commits: ['8fa6d91', 'ae9ea1b'],
  },
  {
    id: 'notes-pin-archive',
    title: 'Notes — pin and archive',
    area: 'notes',
    status: 'shipped',
    shippedAt: '2026-07-25',
    summary:
      'Users can pin important notes to the top of the Active list and soft-archive notes out of the default list.',
    details: [
      'New DB columns on notes: is_archived, is_pinned, pinned_at (migration notes_pin_archive).',
      'Active / Archived filter on the Notes list (web and mobile).',
      'Pinned notes sort above unpinned notes within the Active list; archive clears pin.',
      'Note card ⋯ (web) or long-press (mobile) offers Pin/Unpin and Archive/Unarchive.',
      'Hard delete remains a separate permanent action in the note editor; archive is reversible soft-hide.',
      'PATCH note accepts isPinned and isArchived; GET notes supports archived=true|false filter.',
    ],
    howToUse: [
      'Notes → Active filter (default) shows non-archived notes with pinned ones first.',
      'Notes → Archived shows archived notes; Unarchive returns them to Active.',
      'Web: note card ⋯ → Pin / Archive. Mobile: long-press note → Pin / Archive.',
    ],
    surfaces: ['web', 'mobile', 'api', 'database'],
    adminNotes: [
      'Archive is not deletion. Support should distinguish “archived” vs “deleted”.',
      'Shared/collaborator notes: editors can pin/archive via the same PATCH path (same as other note edits).',
      'Migration already applied to production Supabase when this shipped.',
    ],
    commits: ['4ddf3ac'],
  },
  {
    id: 'notes-phone-folder-menu',
    title: 'Notes — phone folder options menu fix',
    area: 'notes',
    status: 'shipped',
    shippedAt: '2026-07-25',
    summary:
      'Rename/Delete folder actions are reachable on phone viewports; previously the dropdown was clipped inside the horizontal folder scroller.',
    details: [
      'Web mobile used an absolute dropdown inside overflow-x-auto, so Rename/Delete often never appeared or could not be tapped.',
      'Folder options now use the shared portaled Menu (document body), with a larger touch target on the ⋯ control.',
      'Native mobile adds a visible ellipsis on each folder chip in addition to long-press.',
    ],
    howToUse: [
      'On a phone-width browser: Notes → tap ⋯ on a folder → Rename / Delete should open above the page.',
      'In the mobile app: tap ⋯ on the folder chip.',
    ],
    surfaces: ['web', 'mobile'],
    adminNotes: [
      'Regression check after Notes UI changes: open folder ⋯ on a narrow viewport and confirm the menu is fully visible.',
    ],
    commits: ['ae9ea1b'],
  },
  {
    id: 'groups-leave',
    title: 'Groups — leave group',
    area: 'groups',
    status: 'shipped',
    shippedAt: '2026-07-25',
    summary:
      'Any member can leave a study group from Danger Zone. Sole admins must promote another admin first.',
    details: [
      'New API: POST /api/v1/groups/:groupId/leave (uses authenticated user; ignores client-supplied userId).',
      'Sole-admin leave is rejected with a clear error; demote/remove of the last admin is also blocked.',
      'Leaving deletes the membership row and strips the user from groups.admin_ids when applicable.',
      'Web and mobile Group Information → Danger Zone show Leave Group and Archive/Unarchive for all members; Delete remains admin/owner-only.',
      'After leave, the group is removed from the member’s list and the open chat closes.',
    ],
    howToUse: [
      'Open a group chat → Group info / settings → Danger Zone → Leave Group → confirm.',
      'If Leave is disabled: promote another member to admin, then leave.',
    ],
    surfaces: ['web', 'mobile', 'api'],
    adminNotes: [
      'Leave is self-service; platform admins do not need to remove ordinary members for this case.',
      'Support: “I can’t leave” almost always means sole admin — tell them to promote someone else or delete the group if they own it.',
      'Removing another member (admin kick) remains a separate control on the Members tab.',
    ],
    commits: ['6abcb2a'],
  },
  {
    id: 'chat-overflow-scroll',
    title: 'Chat — scrollable group overflow menu',
    area: 'chat',
    status: 'shipped',
    shippedAt: '2026-07-25',
    summary:
      'Long ⋮ menus in group chat stay within the viewport and scroll so every action remains reachable.',
    details: [
      'Web MenuContent caps height to available space (~70vh), scrolls internally, and flips upward when space below is tight.',
      'Mobile GroupChatHeader action sheet uses a ScrollView with a max height (~75% of screen).',
      'Affects group chat header overflow (study, test, question filters, mute, summarize, AI generate, etc.).',
    ],
    howToUse: [
      'Open a group chat → top-right ⋮ → scroll the menu if options extend past the screen.',
    ],
    surfaces: ['web', 'mobile'],
    adminNotes: [
      'Pure UX fix; no API or data model change.',
    ],
    commits: ['6137576'],
  },
  {
    id: 'jobs-seo',
    title: 'Jobs — SEO metadata, OG HTML, and sitemap',
    area: 'jobs',
    status: 'shipped',
    shippedAt: '2026-07-25',
    summary:
      'Public job and company pages expose shareable titles/descriptions, bot-friendly OG HTML, and a jobs sitemap.',
    details: [
      'Shared SEO helpers build document title and meta for public job/company routes.',
      'Server serves crawlable OG HTML for bots on shareable URLs.',
      'Jobs sitemap is included in search-engine notification flows alongside marketplace sitemap.',
    ],
    howToUse: [
      'Share a public job or company URL; preview cards should show Lantern job/company meta.',
      'Sitemap: /sitemap/jobs.xml (and root sitemap index references).',
    ],
    surfaces: ['web', 'api'],
    adminNotes: [
      'Jobs board moderation remains under Admin → Jobs; SEO does not change listing approval rules.',
      'If share previews look stale, re-request indexing for that URL in Search Console / use IndexNow.',
    ],
    commits: ['c6c0b80'],
  },
  {
    id: 'jobs-trust-signals',
    title: 'Jobs — candidate trust signals and scam soft-flags',
    area: 'jobs',
    status: 'shipped',
    shippedAt: '2026-07-25',
    summary:
      'Candidates see trust cues and can report jobs with structured reasons; soft scam flags help surface risk without hard-blocking every listing.',
    details: [
      'Report reasons and soft-flag signals are wired into the jobs experience for candidates.',
      'Complements Admin → Jobs moderation queues for human review.',
    ],
    howToUse: [
      'Candidate job detail → report / trust UI when viewing a posting.',
      'Admins continue to review jobs/reports under Admin → Jobs / Reports as applicable.',
    ],
    surfaces: ['web', 'mobile', 'api'],
    adminNotes: [
      'Soft-flags are advisory; escalate via Reports or Jobs moderation when needed.',
    ],
    commits: ['b8ab2ed'],
  },
  {
    id: 'jobs-company-profiles',
    title: 'Jobs — company profiles with logo, about, and invites',
    area: 'jobs',
    status: 'shipped',
    shippedAt: '2026-07-25',
    summary:
      'Employers maintain company profiles (logo, about) and can invite recruiters onto the company account.',
    details: [
      'Public/company-facing profile pages for hiring brands.',
      'Recruiter invite flow for multi-user employer teams.',
    ],
    howToUse: [
      'Employer jobs area → company profile settings (logo, about).',
      'Invite recruiters from company management UI.',
    ],
    surfaces: ['web', 'api'],
    adminNotes: [
      'Impersonation/abuse: review company branding and invites if spam reports spike.',
    ],
    commits: ['d4a9ea6'],
  },
  {
    id: 'jobs-bulk-tools',
    title: 'Jobs — bulk status moves, CSV export, message templates',
    area: 'jobs',
    status: 'shipped',
    shippedAt: '2026-07-25',
    summary:
      'Employers can bulk-update application statuses, export CSV, and reuse message templates in the hiring pipeline.',
    details: [
      'Bulk status moves across selected applicants.',
      'CSV export for offline tracking.',
      'Saved/reusable message templates for candidate outreach.',
    ],
    howToUse: [
      'Employer applications pipeline → select applicants → bulk status / export / templates.',
    ],
    surfaces: ['web', 'api'],
    adminNotes: [
      'High-volume messaging still subject to normal abuse reporting; no special admin kill-switch beyond existing tools.',
    ],
    commits: ['ef2cd39'],
  },
  {
    id: 'jobs-hiring-analytics',
    title: 'Jobs — employer hiring analytics',
    area: 'jobs',
    status: 'shipped',
    shippedAt: '2026-07-25',
    summary: 'Employers get hiring funnel/analytics views for their postings and pipeline.',
    details: [
      'Analytics surfaces help employers see pipeline throughput and posting performance.',
    ],
    howToUse: ['Employer jobs dashboard → analytics / insights views.'],
    surfaces: ['web', 'api'],
    adminNotes: [
      'Distinct from Admin → Analytics (platform-wide). This is employer-scoped product analytics.',
    ],
    commits: ['0c739b0'],
  },
  {
    id: 'jobs-reminders-calendar',
    title: 'Jobs — deadline reminders and calendar export',
    area: 'jobs',
    status: 'shipped',
    shippedAt: '2026-07-25',
    summary: 'Hiring deadlines support reminders and calendar export for candidates/employers.',
    details: [
      'Reminder workflows around application/interview deadlines.',
      'Calendar export for scheduling convenience.',
    ],
    howToUse: ['Job/application flows that expose deadline reminder or calendar download actions.'],
    surfaces: ['web', 'api'],
    adminNotes: ['Reminder delivery depends on email/notification infrastructure already configured.'],
    commits: ['83caa57'],
  },
  {
    id: 'jobs-offers-hire',
    title: 'Jobs — offers and hire close-out',
    area: 'jobs',
    status: 'shipped',
    shippedAt: '2026-07-25',
    summary: 'Pipeline supports offer stages and hire close-out so employers can finish hiring in-product.',
    details: [
      'Offer status and hire close-out steps added to the employer application pipeline.',
    ],
    howToUse: ['Employer pipeline → move candidate into offer / hired close-out states.'],
    surfaces: ['web', 'api'],
    adminNotes: ['No payment processing for offers in this feature set — status/workflow only.'],
    commits: ['341e88c'],
  },
  {
    id: 'jobs-interview-scheduling',
    title: 'Jobs — interview scheduling',
    area: 'jobs',
    status: 'shipped',
    shippedAt: '2026-07-25',
    summary: 'Employers and candidates can schedule interviews through the jobs pipeline.',
    details: [
      'Interview scheduling UX for both employer and candidate sides of an application.',
    ],
    howToUse: ['Application detail → schedule / view interview steps.'],
    surfaces: ['web', 'api'],
    adminNotes: ['Disputes about missed interviews are handled via normal messaging/reports, not a dedicated admin tool.'],
    commits: ['1bd5159'],
  },
  {
    id: 'marketplace-honest-payment-states',
    title: 'Marketplace — honest payment states (Paystack groundwork)',
    area: 'marketplace',
    status: 'shipped',
    shippedAt: '2026-08-20',
    summary:
      'Orders can no longer claim payment that never happened: every sale starts unpaid, only the seller (or a verified Paystack settlement) can mark it paid, and timelines show payment evidence rather than inferring it.',
    details: [
      'Orders are always created pending_payment. Previously they were born status "paid" unless the seller had opted into confirmation — clicking Pay recorded a payment with no money moving.',
      'mark_paid is seller-only (the receiving party attests; cash at pickup counts) and stamps paid_at after the status commits. The buyer can no longer flip their own order to paid.',
      'The seller\u2019s "Request payment" no longer flips the order to paid as a side effect of asking.',
      'Both clients\u2019 order timelines show "Paid" only on evidence (paid_at or current paid status), distinguishing "Paid via Paystack" from "Payment confirmed by seller". A Paystack session id alone is not evidence — it exists from checkout initialization.',
      'Paystack settlement hardening for go-live: currency validated with amount, settlement mismatches reported to Sentry and stamped on the payment row, checkout retries reuse the open session instead of leaking rows, webhook signature compared in constant time.',
    ],
    howToUse: [
      'Buyer: Pay now \u2192 order shows "Payment required" \u2192 pay by transfer (upload receipt) or cash at pickup.',
      'Seller: order detail \u2192 Confirm payment received (no receipt needed for cash) \u2192 Mark ready \u2192 buyer confirms.',
      'Go-live for real payments: set PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY, MARKETPLACE_PAYSTACK_CHECKOUT=true in Render and point the Paystack webhook at /webhooks/paystack.',
    ],
    surfaces: ['web', 'mobile', 'api', 'database'],
    adminNotes: [
      'Migration 20260820120000 (orders.paid_at + backfill from settled payments) is hand-applied; until it lands, seller confirmations log a warning and timelines fall back to current status.',
      'Legacy orders that reached paid/completed through the old no-evidence paths keep paid_at NULL on purpose — stamping them would fabricate the record this change removes.',
      'Mobile UI changes ride the next app release; shipped builds still gate seller actions behind a proof upload.',
      'The seller "require payment confirmation" preference is now inert (every order requires it); the toggle was replaced with a note.',
    ],
    commits: [],
  },
  {
    id: 'marketplace-question-banks',
    title: 'Marketplace — question banks (digital study bundles)',
    area: 'marketplace',
    status: 'shipped',
    shippedAt: '2026-08-16',
    summary:
      'Groups publish their question pools as purchasable bundles that land in the buyer\u2019s Offline Mode for permanent reuse.',
    details: [
      'Group admins publish a bank from a group\u2019s question pool; the listing is digital (no stock, no reserve, no delivery step).',
      'Payment marks the entitlement paid and delivery is instant: the buyer receives a deterministic offline bundle (qbank-<listingId>).',
      'Versioning: publishers can update content; buyers see an update badge and can re-download. Purchased banks are export-locked.',
      'Sample previews let buyers see a few questions before paying. Mobile reached buyer parity, then publishing parity.',
      'Per-bank leaderboards rank buyers by score; offline attempts sync through the pending-results path so scores survive being earned offline.',
    ],
    howToUse: [
      'Publish (web): group chat \u2192 More \u2192 publish question bank. Mobile: More \u2192 Offline mode \u2192 publish.',
      'Buy: Explore \u2192 Marketplace \u2192 the listing shows a digital treatment and sample preview.',
      'After payment the bundle appears under More \u2192 Offline mode, marked PURCHASED.',
      'Restore marketplace purchases (Offline mode) re-delivers entitlements if a device lost them.',
    ],
    surfaces: ['web', 'mobile', 'api', 'database'],
    adminNotes: [
      'Two migrations underpin this: 20260818120000 (banks) and 20260819120000 (leaderboards). Both are applied in production.',
      'The leaderboard degrades to an empty board if its table is missing rather than 500ing.',
      'Publish routes carry raised body-shape limits (question payloads are large); caps are 1000 questions / 2MB.',
      'Entitlements are self-healing via restore; a buyer reporting a missing bundle should try that first.',
    ],
    commits: ['2e0aee9', '63117df', '6dae772', '83dc0bd', 'a02dde7', '218ccbc'],
  },
  {
    id: 'marketplace-direct-payments',
    title: 'Marketplace — buyers pay sellers directly',
    area: 'marketplace',
    status: 'shipped',
    shippedAt: '2026-08-12',
    summary:
      'Physical-item payment and delivery are arranged between buyer and seller; Lantern is not in the money path for them.',
    details: [
      'Listings state that payment, pickup and delivery are arranged directly, and advise paying only when the item can be verified.',
      'In-app checkout remains for digital goods (question banks), which deliver instantly.',
    ],
    howToUse: ['Explore \u2192 Marketplace \u2192 a listing shows the direct-arrangement notice in Settings and on the listing.'],
    surfaces: ['web', 'mobile'],
    adminNotes: [
      'Disputes on physical items are mediation only \u2014 there is no platform-held balance to refund.',
      'Digital purchases are the exception: those are real orders with instant fulfilment.',
    ],
    commits: ['81dda81', '7af658a'],
  },
  {
    id: 'explore-trust-and-gating',
    title: 'Explore — review gating, sponsored labelling, guest fixes',
    area: 'marketplace',
    status: 'shipped',
    shippedAt: '2026-08-16',
    summary: 'Explore audit follow-ups: reviews require a real transaction, sponsored jobs are gated and labelled, and guests stop being bounced.',
    details: [
      'Reviews are gated on a completed transaction rather than being open to anyone.',
      'Sponsored job placement is gated and visibly labelled.',
      'Guest browsing no longer bounces to sign-in from owner checks that compared two undefined values.',
    ],
    howToUse: ['Explore \u2192 Marketplace / Jobs as a signed-out visitor and as a buyer.'],
    surfaces: ['web', 'mobile', 'api'],
    adminNotes: ['Review abuse should now be rare by construction; report-based moderation still applies.'],
    commits: ['744b686'],
  },
  {
    id: 'platform-bot-protection',
    title: 'Platform — Turnstile bot protection on signup and contact',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-08-14',
    summary: 'Cloudflare Turnstile guards account creation and the contact form.',
    details: [
      'Signup verifies its token with Supabase directly; the contact form verifies server-side via siteverify.',
      '/health reports turnstile as enforced or off, so a half-configured deployment is visible without submitting a real form.',
    ],
    howToUse: ['Sign up or submit the contact form; the widget solves inline.'],
    surfaces: ['web', 'api'],
    adminNotes: [
      'Enforcement needs TURNSTILE_SECRET and TURNSTILE_HOSTNAMES together \u2014 missing either reads as "off" on /health.',
      'Hostnames are managed in the Cloudflare dashboard; removing one breaks local dev with error 110200.',
    ],
    commits: ['a5dd0cd', '152c708', '01c078a'],
  },
  {
    id: 'platform-session-security',
    title: 'Platform — HttpOnly cookie sessions and password-change revocation',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-08-16',
    summary: 'Web sessions moved out of localStorage into HttpOnly cookies, and changing a password signs other devices out.',
    details: [
      'Existing localStorage tokens migrate to cookie sessions on next load.',
      'POST /auth/revoke-other-sessions sets a session cutoff and signs the user out globally, then re-authenticates the current device.',
    ],
    howToUse: ['Settings \u2192 change password; other signed-in devices are signed out.'],
    surfaces: ['web', 'mobile', 'api'],
    adminNotes: [
      'A user reporting "I was logged out everywhere" after a password change is expected behaviour.',
      'Unexpected sign-outs (no password change) now report to Sentry as an incident.',
    ],
    commits: ['bf0537d', '34de0e3'],
  },
  {
    id: 'platform-monitoring',
    title: 'Platform — crash and error monitoring',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-08-19',
    summary: 'Sentry is live on web, mobile and API, and now captures the error classes that are never thrown.',
    details: [
      'Release builds carry publishable DSNs, so Android crashes are no longer visible only over adb.',
      'Web additionally captures failed fetch/XHR responses, CSP violations, and sign-outs the user did not ask for \u2014 none of which surface as thrown errors.',
      'API reports AI provider-chain collapses explicitly, because each AI route answers 503 from its own catch and never reaches the Express error handler.',
      'Expected, already-handled conditions (rate limits, offline fetches, Safari codec gaps) are filtered out so real crashes are not buried.',
    ],
    howToUse: ['sentry.io \u2192 lantern-study org \u2192 web / mobile / api projects.'],
    surfaces: ['web', 'mobile', 'api'],
    adminNotes: [
      'Sentry presence is reported on /health so you can confirm monitoring is on without triggering an error.',
      'An "Unexpected sign-out" event means a session died under a user \u2014 usually a refresh-token rejection.',
    ],
    commits: ['a3a849f', '82e1b23', '6c2183e'],
  },
  {
    id: 'platform-ai-cost-controls',
    title: 'Platform — AI cost controls and usage visibility',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-08-19',
    summary:
      'Repeat AI generations are cached, the daily allowance is 20 requests, and real token spend is now recorded and visible in Admin.',
    details: [
      'Ten AI features cache their responses for 7 days keyed on feature + source + options; a hit skips the provider call entirely.',
      'Transcription runs Groq-only in production; the daily per-user allowance dropped from 100 to 20 requests.',
      'Providers report token usage per call, including cached-input tokens (billed at a discount), recorded to ai_inference_log.',
      'Admin \u2192 AI Ops shows tokens by feature, spend by day, cache-served share, and a live per-provider gauge.',
    ],
    howToUse: ['Admin \u2192 AI Ops for tokens and provider health; Admin \u2192 Analytics for the raw event stream.'],
    surfaces: ['web', 'api', 'database'],
    adminNotes: [
      'Cache replays log provider "cache" with no tokens \u2014 they are activity, never spend.',
      'AI_RESPONSE_CACHE=0 disables caching; AI_COST_PER_MTOKEN_USD tunes the cost estimate; AI_DAILY_LIMIT the allowance.',
      'Token history only exists from 2026-08-19 onward; earlier calls log as zero-token rows.',
    ],
    commits: ['70e3581', '161f458', '4b6b911', 'b43b92e'],
  },
  {
    id: 'platform-ai-reliability',
    title: 'Platform — AI provider fallback, credit refunds and output validation',
    area: 'platform',
    status: 'partial',
    shippedAt: '2026-08-19',
    summary:
      'Groq runs on a current model with Fireworks configured as standby, failed AI requests refund their credits, and unusable AI output is rejected instead of shipped.',
    details: [
      'Groq retired llama-3.3-70b-versatile on 2026-08-16, which took AI down; the chain now runs openai/gpt-oss-120b with GROQ_MODEL/FIREWORKS_MODEL overrides so the next retirement is an env change.',
      'A request that never produced a completion refunds both its global and per-feature credit, and the usage headers no longer report a charge the user did not incur.',
      'Quizzes and practice-test questions with no answerable options, and flashcards with a blank side, are rejected rather than returned and cached.',
      'Both providers now run reasoning models, so their reasoning traces are stripped before JSON parsing and token budgets carry headroom for thinking.',
    ],
    howToUse: ['Admin \u2192 AI Ops \u2192 Provider health check \u2192 Probe groq / Probe fireworks.'],
    surfaces: ['api'],
    adminNotes: [
      'Marked partial: the Fireworks key is currently rejected as invalid (401 UNAUTHORIZED), so there is no working fallback behind Groq. Probe it after updating the key in Render.',
      'The provider probe calls a provider directly, bypassing the fallback chain, so a dead key cannot be masked by whichever provider answers next.',
    ],
    commits: ['b374ce4', '34a90a4', 'ec240b0', 'd4fc45c', 'b8e41b2', 'e982127'],
  },
  {
    id: 'platform-webview-storage',
    title: 'Platform — the web app works where localStorage is blocked',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-08-18',
    summary: 'In-app browsers (WhatsApp, Instagram) and blocked-site-data settings no longer show a blank page.',
    details: [
      'Those environments expose window.localStorage as null, and boot reads storage before React mounts \u2014 so it was a white screen, not a degraded feature.',
      'A fallback in-memory store is installed before any other module loads, carrying over anything the real store can still read so sessions survive.',
    ],
    howToUse: ['Open a lanternstudy.com link inside WhatsApp or Instagram, or with all cookies blocked.'],
    surfaces: ['web'],
    adminNotes: [
      'Users in these browsers keep a working session for the visit; it is forgotten on reload, which is what a privacy-restricted browser implies.',
      'Note that typeof localStorage !== "undefined" does NOT catch this case \u2014 typeof null is "object".',
    ],
    commits: ['01a01a4'],
  },
  {
    id: 'notes-document-reader',
    title: 'Notes — read PDFs and slide decks fullscreen',
    area: 'notes',
    status: 'shipped',
    shippedAt: '2026-08-13',
    summary: 'Attached PDFs and slide decks open fullscreen inside the app and close back to the note.',
    details: [
      'The previous "full screen" handed the file to an external browser and left the app entirely.',
    ],
    howToUse: ['Open a note with a PDF or slide attachment \u2192 fullscreen control.'],
    surfaces: ['web', 'mobile'],
    adminNotes: ['Files are served through signed URLs; an expired link shows a load error rather than silently failing.'],
    commits: ['d281849'],
  },
  {
    id: 'offline-bundle-fidelity',
    title: 'Offline mode — bundle fidelity and download from group chat',
    area: 'groups',
    status: 'shipped',
    shippedAt: '2026-08-17',
    summary:
      'Downloaded tests keep every question type intact, and the mobile group chat can save a test for offline use.',
    details: [
      'Offline bundles are shared web/mobile storage holding two question shapes; the mobile cloud path cast instead of converting, so purchased banks opened empty.',
      'Matching pairs, fill-in-blank answers and diagram labels survive the round trip; previously their structures were dropped in storage.',
      'The mobile group-chat test setup gained "Download for offline", matching the web \u2014 previously the only path was More \u2192 Offline mode.',
    ],
    howToUse: ['Group chat \u2192 test setup \u2192 Download for offline, or More \u2192 Offline mode \u2192 Customize.'],
    surfaces: ['mobile', 'web', 'database'],
    adminNotes: ['A user reporting "empty questions" in a purchased bank is on a build older than 1.0.19.'],
    commits: ['3cfaebd', 'a2fa9a5', '5af0573'],
  },
  {
    id: 'mobile-stability-1-0-25',
    title: 'Mobile — stability and UX fixes through 1.0.25',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-08-18',
    summary:
      'Swipe-to-grade no longer crashes the app, font-size changes stay on Settings, and the Offline screen clears the system navigation bar.',
    details: [
      'Swiping a flashcard to grade it crashed the app from the first release of that component: the gesture worklet called ordinary JS functions on the UI thread.',
      'Changing font size remounts the whole app to apply the scale; navigation state and the boot gate now survive, so Settings stays open instead of dumping the user on Home.',
      'Offline screen padding moved to the scroll container so its bottom buttons are reachable, and test setup preselects all question types like the web.',
    ],
    howToUse: ['Library \u2192 study a deck \u2192 swipe a card; Settings \u2192 font size; More \u2192 Offline mode.'],
    surfaces: ['mobile'],
    adminNotes: [
      'APKs are published to the bjamilk/lantern-study-releases repo; the site\u2019s download link tracks the latest release asset.',
      'Ship via full builds, never OTA \u2014 OTA from main has crash-looped Android before.',
    ],
    commits: ['604c6de', 'ab707e4', '88ab201'],
  },
  {
    id: 'admin-console-reliability',
    title: 'Admin — console reliability and honest counts',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-08-13',
    summary: 'Admin filters actually refetch, a failed tab no longer blanks itself, and search and bulk-send report real numbers.',
    details: [
      'Changing a filter re-runs its query instead of showing the previous result set.',
      'A failed load leaves the previous data in place with an error, rather than blanking the tab.',
      'Email search and bulk-send counts state what they actually matched and sent, including visible caps.',
    ],
    howToUse: ['Admin \u2192 any tab with filters or pagination.'],
    surfaces: ['web', 'api'],
    adminNotes: ['Bulk notification sends are capped; the cap is shown rather than silently truncating.'],
    commits: ['3ad7179', '3dbd05d'],
  },
  {
    id: 'signup-reliability',
    title: 'Platform — signup no longer reports a failure after succeeding',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-08-19',
    summary: 'Account creation with email confirmation stopped logging a 401 error moments after the signup itself succeeded.',
    details: [
      'With confirmation enabled signUp returns a user but no session, so the follow-up profile write had no bearer token and was guaranteed to 401.',
      'The profile is written only when a session exists; otherwise it is created on first sign-in from the same signup metadata, so nothing is lost.',
    ],
    howToUse: ['Sign up with a new email and confirm it.'],
    surfaces: ['web'],
    adminNotes: ['Profiles for confirmation-pending accounts are created at first sign-in, not at signup \u2014 a brief gap in the profiles table is expected.'],
    commits: ['d3c9f0d'],
  },
];

export function sortProductFeatures(entries: ProductFeatureEntry[]): ProductFeatureEntry[] {
  return [...entries].sort((a, b) => {
    if (a.shippedAt !== b.shippedAt) return b.shippedAt.localeCompare(a.shippedAt);
    return a.title.localeCompare(b.title);
  });
}
