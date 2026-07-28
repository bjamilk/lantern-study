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
];

export function sortProductFeatures(entries: ProductFeatureEntry[]): ProductFeatureEntry[] {
  return [...entries].sort((a, b) => {
    if (a.shippedAt !== b.shippedAt) return b.shippedAt.localeCompare(a.shippedAt);
    return a.title.localeCompare(b.title);
  });
}
