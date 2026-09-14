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
    id: 'guided-mode-dark-accents-1-0-57',
    title: 'Guided mode in Lantern AI, readable dark accents, and small things that land where they say (1.0.57)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-13',
    summary:
      'Turn on Guided from the composer (web) or the "+" sheet (phone) and pick a goal: continue the plan’s next topic, start a topic, or something else. Lantern teaches one step, asks one check question, re-teaches on a miss, and suggests what to do next — same cost per turn, and it never claims to open anything. Every accent colour’s buttons and lit tabs now clear AA in dark mode. The tile you picked shows on the room header, switcher, rail and Home. Study all from the Home card opens the review session with Home’s own count. Note rows in a set carry the same menu as decks, including Add cover.',
    details: [
      'Shared CompanionUserContext gains mode (the server’s modes were unreachable before); COMPANION_MODE_PROMPTS.guided: one step per reply, one check, never advance on a wrong answer, re-teach differently, then offer the next step or one activity the set has; states it cannot open or navigate anything; validation falls back to explain.',
      'Goal picker: Continue learning: <next topic> derived from the set’s saved plan (same rule as the plan spine’s Continue) on every door — bar, room tile, credits chip — with a host value winning; no next topic → no row. Guided pill in the header; chips and picker are mutually exclusive by model.',
      'Dark accents: ensureAaPair pairs primaryFill with the real textInverse (was derived for a white label): sky 3.78→6.34, emerald 3.65→6.93, amber 3.70→8.19, pink 3.75→4.98, violet 3.79→4.86; light byte-identical; presets unchanged.',
      'Web: tile override forwarded to SetRoomHeader, SetRail, StudySetSwitcher and Home cards; InlineReviewCard uses Home’s due total and session handler; RecentMaterials note tiles/rows get the cover menu; planTopicActivity never returns read so Continue lights the chip it opens.',
      'Mobile: set room kebab moved to the shared ActionSheet (Set settings was untappable inline); bar height and screen clearance derive from one tested helper.',
      'Founder’s Cursor edits included: adaptive-quiz question mapping, turn-into, set routes, import-and-study modal (off-scale sizes migrated to steps, allowlist lowered 16→1).',
    ],
    howToUse: [
      'Ask Lantern → Guided (web composer pill; phone "+" sheet row) → pick a goal → answer each check question.',
      'Settings → Appearance: any accent now reads in dark mode.',
    ],
    surfaces: ['web', 'mobile'],
    adminNotes: [
      'No new migration. Still hand-applied from earlier: 20260912090000_companion_message_citations.sql, 20260912200000_community_kind_backfill.sql.',
    ],
    commits: ['496eca09'],
  },
  {
    id: 'home-card-tile-picker-grid-list-1-0-56',
    title: 'Review a card from Home, pick each set’s tile, and switch materials between grid and list on the phone (1.0.56)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-13',
    summary:
      'When cards are due, web Home leads with one you can flip and grade with the session’s own grading path — free, no AI. Set settings gain a Tile block: six hues and six glyphs with a live preview and Reset; a cover still wins; Home, hub and room header all show the set’s own art. Inside a set on the phone, materials and lectures switch between grid and list with a sort and remember the choice; every set, even an empty one, reaches its calendar. The plan’s Continue opens the activity it named, and note rows inside a set carry the same menu as decks.',
    details: [
      'Web InlineReviewCard on Recent activities: first due card across decks, Show answer → Again/Hard/Good/Easy via handleUpdateSrsData (FSRS, offline queue, quests identical to a session); cloze/occlusion excluded; Study all N due link.',
      'Tile picker: migration 20260913150000_study_set_tile.sql (tile_hue, tile_glyph with CHECKs); PATCH validates and null-resets; reads degrade to derived art when the columns are missing; a save on a host without the columns answers 503 naming the migration and both clients show it in the block and keep the pick unsaved; shared setTileArt precedence cover > override > hash.',
      'Mobile ViewModeToggle/viewMode (same model and keys as web) on the room’s Materials and Lectures segments, persisted in AsyncStorage; StudyPlanPanel keeps Details on an empty plan so View schedule is reachable.',
      'Web planTopicActivity returns notes | walkthrough | quiz | cards | lesson (never read) so Continue lands on the chip it lights; NoteRoomRow renders a sibling ⋮ with the cover menu.',
      'Mobile HomeStudySetsCard and SetRoomHeader render the shared tile art.',
    ],
    howToUse: [
      'Web Home: flip the card, grade it; Skip advances; Study all N due opens the session.',
      'Set settings → Tile: pick a colour and glyph, Reset returns to the derived tile.',
      'Set room → Materials or Lectures: the grid/list toggle and the sort sheet.',
    ],
    surfaces: ['web', 'mobile'],
    adminNotes: [
      'Migration 20260913150000_study_set_tile.sql is hand-applied; until then tile saves answer "Set tiles need a server update — try again later" and reads show derived art.',
      'Still hand-applied: 20260912090000_companion_message_citations.sql, 20260912200000_community_kind_backfill.sql.',
    ],
    commits: ['299e8230'],
  },
  {
    id: 'study-plan-share-bars-covers-1-0-55',
    title: 'A study plan you can see, Share that tells the truth, bars that name where you are, and pictures that show (1.0.55)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-13',
    summary:
      'Inside a set, Plan is a timeline: units with progress rings, topics inside, done ones struck through, one Continue, and a Details sheet with topics, covered, mastered, syllabus and exam dates; the same on web with a progress sidebar. Share works from the set header and cards and never claims a recipient can open a private set. Materials and lectures switch between grid and list with a sort. Covers on sets, decks and notes render on every card and header and survive a restart. The mobile bottom bars show icons; the tab you are on opens into a pill with its name beside the icon, and the set bar shows where you are. The set calendar plans the set and always draws a grid.',
    details: [
      'Study Plan: mobile StudyPlanPanel + studyPlanPresentation (pure, tested; contrast-safe ink fill on a lilac track); web StudyPlanTimeline on shared planTimeline (units from unitsFromSourceMaterials, next-topic rule, ring arcs). Sources chips omitted: no provenance data.',
      'Share: shared shareLink builder; study-set sharing does not exist (visibility is written, never read), so the copy says the set is private; two older false claims corrected.',
      'Covers: refs persisted bucket-qualified (cover-images/…) and legacy rows normalised on read (normalizeCoverRef); routes probe the column before uploading and answer 503 with the migration name or a storage message; deck mappers map coverPath on web and mobile; web deck menus gate on ownership, not sharing; mobile picker never overlaps a sliding sheet with the picker Activity.',
      'Bars: tabPillLayout (pure): idle icon-only, active pill hugs icon + text-body semibold label, ends pinned, interior slides, 180 ms LayoutAnimation (snap under reduce motion); accessibilityRole tab + label + selected on every item; set bar in replace mode gets the same; badge anchored at the glyph corner in a wide slot so two-digit counts render.',
      'Calendar: StudyCalendarScreen reads the set’s saved plan topics and always renders the month grid with today and an EXAM chip; setup is a card above it.',
      'Home: CourseReadinessCard never returns null (skeleton, 8 s timeout, honest empty card with Add exam date). Web grid⇄list toggle + sort persisted per surface. Mobile setPresentation is a thin adapter over shared (fixed a web/phone tile-hue mismatch).',
      'Fonts, icon sizes and button skins unchanged except the requested larger active-tab label (a type-scale step, not a raw size).',
    ],
    howToUse: [
      'Open a set → Plan: expand a unit, tap Continue on the next topic, Details for progress, syllabus, exam dates and View schedule.',
      'Set header → Share, or a set card ⋮ → Share.',
      'Set room → Recent materials / Lectures: the grid⇄list toggle and the sort menu.',
      'Bottom bar: tap a tab; its name appears beside the icon. Inside a set the bar shows Home · Materials · Flashcards · Tests · Record · Ask.',
    ],
    surfaces: ['web', 'mobile'],
    adminNotes: [
      'Migration 20260913120000_cover_images.sql must be applied (it was on 2026-09-13); rows uploaded before this release carry bare paths and are normalised on read — no backfill needed.',
      'Still hand-applied: 20260912090000_companion_message_citations.sql, 20260912200000_community_kind_backfill.sql.',
      'Known: dark mode under a custom accent draws primary-button labels at ~3.7:1 (accent system, pre-existing). A 0-material set has no route to View schedule (no Details button).',
    ],
    commits: ['8e850152'],
  },
  {
    id: 'study-set-parity-covers-1-0-54',
    title: 'The set stays in one place, Home reads in two screens, and sets, decks and notes take a picture (1.0.54)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-13',
    summary:
      'Inside a set the bottom bar becomes the set (Home, Materials, Flashcards, Tests, Record, Ask) and the room has a remembered segment row; on the web the left rail becomes the set with a switcher, its activities, Upload and a live materials tree. Set cards carry tile art, progress, count chips, a resume pill and the last-studied time, with Edit and Delete behind a menu. Both Homes share one eight-region spine with a new Recent activities section and a Progress door. Every tile and card is flat. Studio gates show a card and the button that resolves the blocker. A study set, deck or note can carry a picture uploaded from the gallery.',
    details: [
      'Mobile: segment row Overview · Materials · Practice · Lectures · Plan (remembered per set, driven one-way from the set bar through a ticketed param inbox — the store is the single writer); one bottom bar at a time; Study tab press returns to the hub; companion scopes to the set.',
      'Web: SetRail from the path /study/sets/:id (switcher, Study plan, Chat, Tutor, Record, Practice group, Upload, materials tree); set room header as an object (tile, chip strip, progress), styled switcher, timer idle state with presets, plan unit pills with a lilac ring, in-set Recent materials with a type filter, Exam dates and syllabus cards on every room, compact own-way grid; /study no longer flashes the empty state before sets load.',
      'Shared: packages/shared/src/study/setPresentation.ts (tile art, count chips, relative time) and dashboard/homeSections.ts (the Home spine, recentActivities); hard offset shadow removed app-wide (web --shadow-hard, mobile DOOR_TILE.shadowOffset).',
      'Covers: migration 20260913120000_cover_images.sql adds cover_path to decks, notes and study_sets; private cover-images bucket auto-created; POST/DELETE /decks/:id/cover, /notes/:id/cover, /users/me/study-sets/:id/cover (5 MB cap on sets, 10 MB otherwise); thumbnails via the existing sibling-thumb pipeline; no AI generation (no provider exists).',
      'Fonts, icon sizes and button skins unchanged (measured on device: title cap 41 px, primary pill 116 px, identical to 1.0.53).',
    ],
    howToUse: [
      'Open a set: use the bottom bar (mobile) or the left rail (web) to move between its materials, cards, tests, recordings and plan without leaving it.',
      'Study tab: search, sort, and read each set’s progress and contents on its card; ⋮ for Edit, Move, Delete.',
      'Set settings → Study set picture → Upload picture (recommended 400×400px, max 5MB); a deck or note: ⋮ → Add cover.',
      'Home → Your progress for goals, quests, the heatmap, badges, tests, group performance and the leaderboard.',
    ],
    surfaces: ['web', 'mobile'],
    adminNotes: [
      'Migration 20260913120000_cover_images.sql is hand-applied; until then cover uploads answer 503 naming the file and reads degrade to no cover.',
      'Earlier hand-applied migrations still pending: 20260912090000_companion_message_citations.sql, 20260912200000_community_kind_backfill.sql.',
      'The web timer’s View stats link was omitted: no stats screen exists yet.',
      'components/dashboard GettingStartedChecklist is unreferenced after the Home trim.',
    ],
    commits: ['3fcd99ed'],
  },
  {
    id: 'pdf-viewer-photo-race-chat-home-1-0-53',
    title: 'PDFs open in your phone’s viewer, photo questions always see the photo, and a chat home with gallery, forwarding and link previews (1.0.53)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-13',
    summary:
      'On Android, Open PDF hands the downloaded file to the system PDF viewer instead of a share sheet. A photo question sent while the photo was still being read went out without the photo and was answered blind; the companion now waits for the read to finish. Dark mode’s outgoing chat bubble is legible again. Chat gains a home pane with drafts and presence, an in-chat media gallery, forwarding to another chat, link previews and reactions; communities file student rooms under their real kind.',
    details: [
      'expo-intent-launcher added (native dependency): Open PDF fires ACTION_VIEW with a content URI from the cache; the share sheet remains only as the fallback when no viewer is installed. Both lockfiles regenerated.',
      'Companion store awaits the in-flight image read before building the request context; a wire-level test asserts the request carries context.imageAttachments and that pending images clear only after a successful send.',
      'Dark-mode user bubble uses the inverted theme pair (primaryFill + textInverse) instead of hard-coded white text.',
      'Chat (web + mobile): chat home pane with drafts, inbox and presence; media gallery per chat; forward a message to another chat; link preview chips; message reactions; DM header shows the peer’s presence.',
      'Communities: hub model and discovery plan reworked; migration 20260912200000_community_kind_backfill.sql promotes purpose-tagged topic rooms to their real kind (safe to re-run).',
    ],
    howToUse: [
      'Library → a note with a PDF → Open PDF: your PDF app opens it.',
      'Ask Lantern → “+” → Add image: wait for the chip to show the word count, then ask; questions sent early now wait for the read.',
      'Chats → the home pane lists conversations with drafts and who is online; open a chat → gallery for its media, long-press a message to react or forward.',
    ],
    surfaces: ['web', 'mobile'],
    adminNotes: [
      'Migration 20260912200000_community_kind_backfill.sql is hand-applied; until then student rooms created before 20260908120000 stay filed as topic.',
      'Migration 20260912090000_companion_message_citations.sql is still hand-applied (citations vanish on reload until then).',
      'Lock-screen media controls are verified only where a keyguard is enabled (emulators default to none).',
    ],
    commits: ['500c0aeb'],
  },
  {
    id: 'ink-pivot-lockscreen-photos-1-0-52',
    title: 'One dark ink instead of blue, lecture controls on the lock screen, photos in Lantern AI (1.0.52)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-12',
    summary:
      'Buttons, links, active states, text, icons and the app icon now share one near-black ink on web and mobile; in dark mode they invert. The Android splash is a rounded square on cream. A playing lecture gets a media notification and lock-screen controls with the note’s title, and keeps playing in the background. Lantern AI can read a photo of a page or slide (2 AI uses) and answer about it. Recordings and PDFs that cannot be opened now say why, and PDFs open in the phone’s own viewer.',
    details: [
      'Primary, text and glyph tokens unified on #191919 light / #f5f5f5 dark with neutral grey secondaries, in packages/shared tokens and index.css together; “Default” accent is the ink, custom accents untouched.',
      'Navigation pills, dots and filters are ink/outline controls; feature pastels stay on tiles and discs; lilac stays only on citation chips.',
      'Android 12 masks the splash to a circle, so the mark is inscribed inside that circle (440/1024) and reads as a rounded square.',
      'Lecture audio moved to expo-audio with a lock-screen media session; registering the session can never block playback, and artwork is a real file URL.',
      'Companion photo attach: POST /ai/companion/attachments (OCR, 2 credits, fenced as untrusted text); the queue processor now feeds the transcript to the model; the “+” sheet offers Add image, Take photo, Attach a note.',
      'PDF preview no longer uses Google’s viewer; Android shows a card with name and size and opens the file in a system app; iOS renders it in-app.',
      'High-contrast mode detected dark by a literal slate hex and would have painted dialogs black on black; detection is now luminance-based.',
    ],
    howToUse: [
      'Library → a lecture note → Audio → play: pull down the shade for the media controls; lock the phone for the lock-screen controls.',
      'Ask Lantern → “+” → Add image or Take photo (2 AI uses): the chip shows the photo and its word count; ask about it.',
      'Settings → Appearance: “Default” accent is the ink; pick any preset to colour buttons instead.',
    ],
    surfaces: ['web', 'mobile'],
    adminNotes: [
      'Two migrations are hand-applied: 20260912090000_companion_message_citations.sql and 20260912100000_companion_image_attachments.sql. Until the second is applied, Add image answers “Photos need a server update — try again later.”',
      'Lock-screen controls cannot be verified on an emulator whose keyguard is disabled.',
      'Open PDF on Android uses the share sheet; a direct viewer intent needs expo-intent-launcher, not yet added.',
    ],
    commits: ['83251ef7'],
  },
  {
    id: 'turn-into-and-due-counts-1-0-51',
    title:
      'Turn any Lantern AI answer into cards, a test or a lesson; Home counts due cards one way (1.0.51)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-12',
    summary:
      'A single companion answer can become flashcards, a test or a lesson without copying anything by hand: Turn Into files the answer as a note in the current set, then opens the generation flow or studio that already exists. Home’s "Study all N due" and the review session it starts now read the same plan total, so the number a student sees is the number they get. Companion citations persist, the flashcards due summary stops failing, tests started in a set carry that set, and the web app stays signed in on a fresh page load.',
    details: [
      'Turn Into sits on a single chat answer on web and mobile: the answer is filed as a note in the current set, then the existing generation flow or studio opens on it — no new pipeline, no copy-paste.',
      'Home’s "Study all N due" button and the review session it starts both count from one plan total, so the two can no longer disagree.',
      'Companion citations are persisted rather than held in memory for the life of the response (migration 20260912090000_companion_message_citations.sql).',
      'The flashcards due-summary endpoint no longer returns a 500.',
      'A test started inside a study set carries that set’s id, so the result lands back in the set it came from.',
      'The web app stays signed in on a fresh page load instead of bouncing to sign-in (3450eea0).',
    ],
    howToUse: [
      'Web or mobile → Lantern AI: on any single answer, use Turn Into → flashcards, test or lesson. The answer is saved as a note in the set you are in, then the usual generation or studio screen opens.',
      'Home → "Study all N due": the count and the session that starts from it come from the same plan total.',
      'Open a study set and start a test from it: the result is attributed to that set.',
    ],
    surfaces: ['web', 'mobile'],
    adminNotes: [
      'Migration 20260912090000_companion_message_citations.sql is hand-applied: citations persist across reload only after the migration. Before it is applied, citations still render in the live response and disappear on reload — that is the missing migration, not a new bug.',
    ],
    commits: ['2906506e', '3450eea0'],
  },
  {
    id: 'shop-shell-1-0-40',
    title: 'Mobile 1.0.40 — Amazon-shaped Shop shell: Cart/You header, You hub, Payouts, seller home',
    area: 'marketplace',
    status: 'shipped',
    shippedAt: '2026-09-02',
    summary:
      'Every buy/sell tool that lived behind a "..." overflow is visible: a Cart + You header with live badges on every Shop screen, a quick-access band, a You hub with a persisted Buying | Selling side and a Your Seller Account section, a Payouts screen with an earnings ledger, Your Listings as the seller home with a Needs-you strip, Buy Again, status pills on orders, and thumbnails/CTAs in Cart and Saved. Shop moved to the top bar and Jobs to the profile drawer, both pilot-only.',
    details: [
      'One badge source: hooks/useShopBadges() feeds header, band, hub and Your Listings, so counts cannot disagree. needsYou = seller action orders + buyer action orders + offers awaiting me + offers awaiting you (your turn only, via canRespondToOffer) + unread inquiries (real DM unread joined on inquiry dm_thread_id, not open-status counts).',
      'Store exports orderNeedsSeller / BUYER_ACTION_ORDER_STATUSES / offerAwaitsUser; OrderStatusPill and the Orders sort consume the same predicates. Cheap sync: setCartCount from loaded rows, optimistic addToCart, invalidateShopSummary after checkout / offer response / order actions; realtime marketplace_* notifications force a summary refetch.',
      'SellerPayoutScreen wraps the untouched SellerPayoutSetup and lists fetchSellerPayments pages with the server vocabulary (initialized / paid / payout_pending / paid_out / refunded / failed). Pages are 20 rows; Load more continues while a full page returns.',
      'You hub: Buying | Selling segment persisted per user (AsyncStorage). Payouts row shows "Not set up" only when the payout profile is inactive AND activeListings > 0. Embedded SellerPayoutSetup removed from the hub.',
      'Route params: Orders { role, view: buy_again }, Offers { tab }, Inquiries { tab }, MyListings { openInsights }; each screen param-syncs when already mounted. Deep links: marketplace/cart, marketplace/you, marketplace/products, marketplace/payouts.',
      'The shared MarketplaceWorkspaceBar is deleted; Your Listings uses SellerToolsRow + SellerNeedsYouStrip and an ActionSheet in place of a 5-button Alert (Android caps Alert at 3).',
    ],
    howToUse: [
      'Shop (top bar) -> You icon -> Buying | Selling. Selling -> Payouts to add bank details and see the ledger.',
      'Selling -> Your Listings: the Needs-you strip at the top is the seller to-do list; chips below are every seller tool.',
      'You -> Buy Again lists completed purchases with a one-tap reorder.',
    ],
    surfaces: ['mobile', 'api'],
    adminNotes: [
      'Jobs board is now behind the same private-pilot allowlist as the marketplace (JOBS_PRIVATE 403); MARKETPLACE_PUBLIC=true opens both. Sitemaps serve only section landing pages while the pilot is on.',
      'Emulator/dev trap: a foreground Bash timeout while a workflow runs interrupts its subagents; worktree isolation needs the session cwd to be a repo — see memory notes.',
    ],
    commits: ['352dbec', '611705e', '4113e05', 'f7adecd', '6119e36', '3d63c57', '854ff8a'],
  },
  {
    id: 'marketplace-departments-1-0-39',
    title: 'Mobile 1.0.39 — nine product departments, Shop-by-department browse, Shop/Jobs tabs',
    area: 'marketplace',
    status: 'shipped',
    shippedAt: '2026-09-01',
    summary:
      'The academic / student-life split described the seller, not the product, which buried phones, hostels, hair and food under "student life". Replaced with nine Amazon-shaped departments and 104 leaves, a three-level buyer browse that actually filters, the same drill-down for sellers, and Shop and Jobs as separate bottom-tab destinations. Also repairs an access check that reported outages as "you are not on the private pilot".',
    details: [
      'Taxonomy: nine departments (electronics, study-materials, housing, fashion-beauty, food-groceries, services, transport, events-tickets, campus-essentials), 146 nodes / 104 leaves, with a 57-row legacy map. Listings keep marketplace_listings.category (5 SQL functions, 4 indexes and the search vector read it); the leaf lives in category_specific_fields.taxonomyNodeId.',
      'Browse filtering follows one rule, coversWholeCategories: a node that owns every leaf of its listing categories also collects listings that carry no leaf yet; a node that owns only part of one filters on its descendant leaf ids instead. Without it, "Smartphones" would have shown every unfiled laptop — 13 of 16 listing categories have more than one leaf.',
      'A group filters on descendant leaves (new taxonomyNodeIds param) rather than the coarse category, because Phones & Tablets and Computers & Laptops are both stored as `electronics`. useSearchRpc had to learn about the leaf list or a group browse would silently return the whole category.',
      'Navigation: Jobs owns its own stack so Shop and Jobs keep independent history. Six bottom destinations (Chat, Library, Shop, Jobs, Home, Offline) — above Material\'s recommended five, so the tabs are icon-led and compact, verified legible at 360dp.',
      'Access check: the client treated any probe failure — network, 5s timeout, cold Render dyno, a token that had not finished restoring — as a denial, cached it, and never retried, so one blip locked all 19 gated screens for the session. Now three-state (allowed / denied / unknown) with a retry, an honest "couldn\'t check" screen, and an `authenticated` flag on GET /marketplace/access so an anonymous-race answer is not mistaken for a verdict.',
      'validateBody exempted question-banks but not study-packs from the 100-key body cap, so publishing a deck of 45+ cards (30+ with tags) was rejected with 400 before the route ran.',
    ],
    howToUse: [
      'Shop tab → Departments → walk down to the exact subcategory; breadcrumbs above the results widen the search a level per tap.',
      'Shop opens on All rather than a department, so a department with no stock is never the first thing a buyer sees.',
      'Filters → Condition (new / like new / good / fair), which the API has always accepted and no UI ever sent.',
      'Selling: the listing-type picker is the same drill-down; "Something else" asks you to name the type and stores it as custom:<name>.',
    ],
    surfaces: ['web', 'mobile', 'api', 'database'],
    adminNotes: [
      'Requires migration 20260901090000_backfill_taxonomy_node_ids.sql. It rewrites the 41 legacy node ids whose replacement is a leaf and REMOVES the rest rather than writing them to a group — a group id would hide the listing twice over, since leaf browse matches only leaves and the unfiled rule matches only NULL. Also adds the partial index the browse filter reads on every drill-down.',
      'Groups, People and the leftover Rooms tab are HIDDEN, not deleted: flip DISCOVER_SECTION_ENABLED in packages/shared/src/marketplace/discoverSections.ts to restore them. Rooms still live on each community page. Web and mobile both read it.',
      'The marketplace stays a private pilot; the allowlist is unchanged (founder id only, in middleware/marketplaceAccess.ts). MARKETPLACE_PUBLIC=true opens it to everyone with no code change.',
    ],
    commits: ['2e28859', 'cafbded', '215ea50', '7b3e045'],
  },
  {
    id: 'reactions-palette-1-0-38',
    title: 'Mobile 1.0.38 — emoji reactions, real Delete, visible selection, palette repair',
    area: 'chat',
    status: 'shipped',
    shippedAt: '2026-08-30',
    summary:
      'Emoji reactions on every message type (groups + DMs, questions included), Delete promoted out of the vanishing overflow menu into the action bar, a selection highlight that actually renders, and a platform-wide palette fix that restores 511 styling rules which silently produced nothing.',
    details: [
      'Reactions: message_reactions table (one row per message+user+emoji), service-role only, with counts denormalised onto messages.reactions / dm_messages.reactions by trigger so they ride the existing realtime channels. Fixed eight-emoji set; optimistic toggle with rollback.',
      'Reactions are deliberately separate from question up/down votes: votes decide whether a question is verified into tests, reactions gate nothing.',
      'Delete: onMore was passed only when the overflow list was non-empty, so for an own message with nothing else applicable the button — and the only path to Delete — disappeared. Now a first-class trash action gated by the shared canRemoveChatMessage, with an explained disabled state.',
      'Selection highlight: 1.0.37 shipped `bg-lantern-primary/15`, which Tailwind drops entirely when the colour is an unparseable var(). Now an inline themed colour via a withAlpha helper.',
      'Palette: CSS vars now hold RGB channels and colours are declared rgb(var(--x) / <alpha-value>), so opacity modifiers work at last — 418 dead classes on web, 93 on mobile. primary-background / accent-background stay whole colours (their dark values carry their own alpha), guarded by a test.',
    ],
    howToUse: [
      'Long-press a message → emoji row appears above the action bar; tap one to react.',
      'Tap any reaction chip under a message to add or remove your own.',
      'Long-press your own message → the trash button deletes it (within 30 minutes; questions cannot be deleted).',
    ],
    surfaces: ['web', 'mobile', 'api', 'database'],
    adminNotes: [
      'Requires migration 20260830120000_chat_message_reactions.sql (applied 2026-08-30). Without it the API answers 503 "Reactions are not available yet" and nothing else is affected.',
      'The palette change is all-or-nothing per platform: a CSS var holding a whole colour inside rgb() renders transparent on web and undefined on mobile. Never reintroduce hex into --color-* vars.',
    ],
    commits: ['2b555e9', '259f508'],
  },
  {
    id: 'chat-fixes-semester-1-0-37',
    title: 'Mobile 1.0.37 — chat selection/star/pin fixes, semester on the profile',
    area: 'chat',
    status: 'shipped',
    shippedAt: '2026-08-30',
    summary:
      'Four founder-reported chat defects: a long-pressed message had no visual selection, starred messages were unreachable after starring, the floating sync chip covered and swallowed taps on the pinned-message bar, and the chat list drew a hairline between every conversation. Ships with first/second semester on the academic profile (web + mobile).',
    details: [
      'Selection: the action-bar target row now tints full-width; the target id is part of the list extraData, without which the memoized rows never repaint.',
      'Starred: chat menu gains "Starred messages (n)", filtering the thread in place so replies, jumps and unstar keep working; amber banner + Show all; filter-aware empty state. Group and DM.',
      'Sync chip: informational only, so it renders pointerEvents=none and hides entirely when online with nothing pending (the rule SyncDot already followed). The pinned bar also reserves right padding.',
      'Chat list: row hairlines removed from conversations and pending invites; section headers and search results keep theirs.',
      'Semester: profiles.current_semester (1|2, nullable) via migration 20260830090000, shared semesterLabel/semesterOptions, API 400 on anything but 1|2, and the field in all four academic forms.',
    ],
    howToUse: [
      'Long-press any message: the row highlights while the action bar is open.',
      'Chat menu → Starred messages to see just your starred ones; Show all to return.',
      'Settings → Academic (or profile setup) → Semester: First or Second; tap the selected chip again to clear it.',
    ],
    surfaces: ['web', 'mobile', 'api'],
    adminNotes: [
      'Migration 20260830090000_profile_current_semester.sql applied 2026-08-30. The semester field reads "Not set" and silently no-ops on any environment where it has not been applied.',
    ],
    commits: ['444896c'],
  },
  {
    id: 'tips-persistence-1-0-36',
    title: 'Mobile 1.0.36 — "Don\'t show again" sticks; community lounges live',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-08-29',
    summary:
      'Feature-tip opt-outs are now permanent across devices: the durable hide flags are monotonic, so a device that has not loaded the profile yet can no longer overwrite a saved "Don\'t show again" back to false (the overwrite is what kept resurrecting tips on web). Ships alongside the server-side activation of community lounges (migration 20260829170000 applied).',
    details: [
      'Persistence is one-way for skippedAll / dontShowAgain / checklistDismissed — only the explicit Replay Tips flow in Settings can turn them back off.',
      'Devices self-heal the profile: if local state knows a durable hide the profile lost, it is pushed back up on the next settings sync.',
      'Web shipped the same fix in 1d63ff6; this release carries the mobile half.',
    ],
    howToUse: [
      'Tap "Don\'t show again" on any coach tip once — it never returns unless you choose Replay Tips in Settings.',
      'Discover → Community → "Community chat" now opens the shared lounge (live since the migration was applied).',
    ],
    surfaces: ['mobile'],
    adminNotes: [
      'The "Unexpected sign-out" Sentry alarm (fingerprint unexpected-sign-out) is the regression signal for the related web auth fix; all 15 open Sentry issues were resolved 2026-08-29 and auto-reopen on recurrence.',
    ],
    commits: ['1d63ff6'],
  },
  {
    id: 'community-lounges-1-0-35',
    title: 'Mobile 1.0.35 — community lounges, honest Discover, temporary rooms',
    area: 'groups',
    status: 'shipped',
    shippedAt: '2026-08-29',
    summary:
      'A community is now a place you can talk, not a member directory: every community has a shared lounge chat, one tap from the Discover card or the community page. "Your communities" now lists your actual memberships (a fresh account no longer sees another campus presented as its own), the tab is named Community again, and study rooms close on their own after 6 hours and are deleted a few days later.',
    details: [
      'Lounge = one admin-less group per community (visibility community), minted lazily on first open; membership in the community is the only requirement, and concurrent first-openers converge on a single lounge.',
      'The "Your communities" section is sourced from the membership list itself; discover results are a separate "More to join" section, deduped against memberships.',
      'If a signed-up student with an academic profile has no memberships (signup paths that skip the profile save), the server re-derives them on the next communities fetch.',
      'Rooms: 24h auto-close (raised from 6h on 2026-09-02; expired rooms read closed immediately, joins are refused), listed on the mobile hub\'s Room tab while open, hard delete after 3 days, swept opportunistically on room traffic.',
    ],
    howToUse: [
      'Discover → Community → your community card → "Community chat" drops you into the lounge.',
      'The same button sits on the community page under Join/Leave once you are a member.',
    ],
    surfaces: ['web', 'mobile', 'api'],
    adminNotes: [
      'Requires migration 20260829170000_community_lounges.sql (communities.lounge_group_id). Until applied, the lounge button returns "Community chat is not available yet" (503) and nothing else breaks.',
      'Lounges have no admins by design — moderation happens via the existing message-report pipeline, not group admin tools.',
    ],
    commits: ['6eb6a96'],
  },
  {
    id: 'maintenance-1-0-34',
    title: 'Mobile 1.0.34 — institutions list restored, study-room picker fix',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-08-29',
    summary:
      'Maintenance release. The institutions list loads again in academic-profile setup, settings and the jobs create screen (the marketplace private-pilot gate had accidentally blocked the shared campus lookup — fixed server-side, this build just aligns versions), and the study-room course picker shows its prompt correctly.',
    details: [
      'Server: GET /marketplace/campuses is exempt from the private-pilot gate as reference data; commerce routes remain founder-only.',
      'Study room: the course picker used an unsupported label prop; it now uses placeholder, restoring the mobile typecheck baseline to zero.',
      'Includes the full 1.0.33 safe-area and back-button sweep for anyone updating straight from 1.0.32 or earlier.',
    ],
    howToUse: [
      'Profile setup and Settings → Academic: the university picker lists all institutions again.',
    ],
    surfaces: ['mobile', 'api'],
    adminNotes: [
      'The institutions outage was server-side (403 from the pilot gate), so 1.0.33 devices recovered without updating; 1.0.34 exists to keep the shipped binary current with main.',
    ],
    commits: ['5cc8ad1'],
  },
  {
    id: 'readiness-pilot-1-0-33',
    title: 'Mobile 1.0.33 — exam readiness, marketplace private pilot, profile-sheet fix',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-08-29',
    summary:
      'Exam readiness on both dashboards: every enrolled course gets an honest coverage-and-mastery rollup against its shared topic outline, a day-one "Start here" pointer, exam countdowns, and (at 20+ student cohorts) what the class finds hardest. The goods marketplace enters a founder-only private pilot with a friendly explanation for everyone else. The academic-profile setup sheet no longer hides its buttons under Android system bars.',
    details: [
      'Readiness = 60% average topic mastery + 40% syllabus coverage; no score is ever fabricated — courses with no performance evidence show coverage or "no study data yet".',
      'Mastery now refreshes on flashcard reviews as well as test submissions (debounced server-side).',
      'Web: Exam readiness card on the Dashboard with expandable per-topic breakdowns and the class signal. Mobile: matching Dashboard card opening the full Mastery screen (newly reachable), which focuses on a single course when opened from a course row.',
      'Marketplace private pilot: the API 403s non-allowlisted accounts on every marketplace route; web and mobile render a private-pilot explanation instead of broken screens; the mobile Discover icon routes non-pilot accounts to the Discover hub.',
      'Academic-profile setup modal: header and footer padded by real safe-area insets on Android 15+ edge-to-edge; keyboard behavior fixed for API 35+.',
      'App-wide edge-to-edge sweep: 40 modals/sheets/bars now pad by the real system insets so no button hides under the status or navigation bar; 25 keyboard-avoiding views fixed for Android 15+.',
      'Back buttons everywhere: a shared 44pt BackButton replaces the tiny header glyph on 16 screens; Tests, Flashcards, Notes and Discover gain back buttons; 30 undersized back icons enlarged and 23 given bigger touch targets.',
    ],
    howToUse: [
      'Dashboard → Exam readiness: tap a course (mobile) or expand it (web) for the topic-by-topic picture and the class signal.',
      'Set exam dates on your courses to get countdowns; seed a course outline in the Library to make coverage meaningful.',
      'Reopening the marketplace later is an env flip (MARKETPLACE_PUBLIC=true) or an allowlist extension (MARKETPLACE_ALLOWED_USER_IDS) — no code change.',
    ],
    surfaces: ['mobile', 'web', 'api'],
    adminNotes: [
      'Readiness bridges course_topics titles to mastery tags case/whitespace-insensitively — topics only match when tag text and outline title normalise identically.',
      'Class signal is cohort-floored at 20 students by the RPC and the API; below that it reports itself unavailable.',
      'The marketplace gate allowlists user ids server-side; GET /marketplace/access is the open probe clients use to decide what to render.',
    ],
    commits: ['f82415e', '9bab59d'],
  },
  {
    id: 'marketplace-ratings-1-0-32',
    title: 'Mobile 1.0.32 — marketplace ratings, top-rated discovery, chats column (web)',
    area: 'marketplace',
    status: 'shipped',
    shippedAt: '2026-08-29',
    summary:
      'Ratings-led discovery for the goods marketplace on web and mobile: stars with review counts on browse cards and related rails, a Top rated sort and minimum-rating filter, and a ratings summary on every listing with a tappable star histogram, review sorting, Verified purchase badges and Helpful votes. On web, Chats now opens as a side column instead of collapsing inside the sidebar.',
    details: [
      'Per-listing rating aggregate (rating_avg / rating_count) maintained by a database trigger on reviews, backfilled for existing reviews, and exposed on browse, batch, similar and detail payloads.',
      'Browse: sort by Top rated (best average first, unrated last) and filter to ★4/3/2/1 & up — filter panel on web, filter-sheet chips on mobile.',
      'Listing page: average + star histogram; tapping a bar filters reviews to that star bucket. Reviews sort by Top (most helpful), Most recent, Highest or Lowest rating.',
      'Verified purchase badge on reviews whose author completed an order, owns the digital product, or had the inquiry marked purchased by the seller — the same proofs the write gate uses.',
      'Helpful votes on reviews (one per person, own reviews excluded); authors see "N people found this helpful".',
      'Web chats column: expanding Chats slides out a dedicated list column beside the sidebar (the sidebar condenses to its icon rail while open); on the chat screen the column yields to the conversation list.',
    ],
    howToUse: [
      'Marketplace → filters → "Customer rating" and the "Top rated" sort (web), or the Rating chips and Top rated chip in the filter sheet (mobile).',
      'On a listing, tap a histogram bar to read only that star bucket; use the sort control above the reviews to reorder them.',
      'Mark a review Helpful from the button under it; tap again to undo.',
      'On web, click "Chats" in the sidebar to slide the chat list out as its own column; click again (or ✕ in its header) to retract it.',
    ],
    surfaces: ['mobile', 'web', 'api'],
    adminNotes: [
      'Requires migration 20260828160000_marketplace_ratings_and_review_votes.sql. Until it is applied everything degrades: no stars anywhere, Top rated falls back to newest, and the Helpful / Verified controls stay hidden.',
      'Rating sort and the minimum-rating filter run through the fallback browse query; with a search term active they use ilike matching rather than full-text ranking.',
      'Helpful counts and verified flags are computed at read time; a failed lookup omits them rather than failing the review list.',
    ],
    commits: ['16e05c2'],
  },
  {
    id: 'mobile-shell-chat-tools-1-0-31',
    title: 'Mobile 1.0.31 — chat-first shell, chat tools, lights-out dark',
    // 'mobile' is not a ProductFeatureArea; this shipped untyped because no
    // gate typechecks this file (esbuild strips types). Chat is the release's
    // centre of gravity.
    area: 'chat',
    status: 'shipped',
    shippedAt: '2026-08-28',
    summary:
      'Navigation rebuilt around chat: chat-first shell with a top icon bar, profile drawer and scroll-away bars; chat multi-select and message actions (reply/forward/copy/star/pin) in a top action bar; search across chats, messages (full history via new endpoint), and people; colour-coded notifications; X-style pure-black dark mode.',
    details: [
      'Chat is the first screen after sign-in. Base bar: Chat / Library / Dashboard / Offline. Budget, Notifications, Lantern AI and Discover moved to a top icon bar; Settings, low-data, theme and log-out to a profile drawer (avatar tap or edge swipe).',
      'Both bars hide on scroll-down and return on scroll-up on every root surface.',
      'Chat list: long-press multi-select with pin / mute (8h) / archive / delete acting on the selection; chat pins are device-local; Archived pinned to the top under a persistent search bar.',
      'Messages: long-press swaps the chat header for an action bar (reply, forward, copy, star, pin + overflow edit/remove/report) in groups, sub-groups and DMs. Stars and pinned-message banner are device-local.',
      'Search: universal chat-list search (Chats / Messages / People), in-conversation match jumping, and GET /messages/search for full history (membership-scoped; client falls back to latest-message previews until the API deploys).',
      'Notifications are colour-coded by feature family with a left accent border on web and mobile; test completions now carry type test_result.',
      'Dark mode is pure black (X-style) on web and mobile; dark own-bubble text is pure white. Web Enter inserts a newline — Send sends.',
      'Composers clear the soft keyboard on Android 15+ (companion, group chat, DMs). Confirm/action sheets respect the bottom system inset.',
      'Offline screen no longer lists Available-to-Download groups; downloads stay in the group Study/Test flow.',
    ],
    howToUse: [
      'Long-press a chat for the selection bar; tap more chats to extend; icons act on all selected at once.',
      'Long-press any message for reply / forward / copy / star / pin; ⋮ holds edit, remove and report.',
      'Group menu (⋮) → Search messages jumps between matches in the conversation.',
      'Profile drawer: tap your avatar (top-left) or swipe right from the left edge; dark mode toggle lives there.',
    ],
    surfaces: ['mobile', 'web', 'api'],
    adminNotes: [
      'Chat pins, message stars and pinned messages are DEVICE-LOCAL (AsyncStorage) — no backend fields yet, so they do not sync across devices.',
      'Full-history message search needs this API release; older clients and servers fall back to latest-message preview matching silently.',
      'Mute uses the existing endpoints with a fixed 8h duration from the selection bar.',
      'Support: notifications created before this release keep their generic type and stay in the default indigo family.',
    ],
    commits: ['45b7ae7', 'c07ab8e', '78274ae', 'db85fdd', '56a9eb4', 'd31f525'],
  },
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
    id: 'mobile-marketplace-study-1-0-26',
    title: 'Mobile — marketplace, jobs, and study release (1.0.26)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-08-20',
    summary:
      'The 1.0.26 build lands the session-long marketplace/jobs/library work on mobile: full jobs filters and employer tools, honest sold-out/expired/offer states, and Anki-style flashcard review polish.',
    details: [
      'Jobs browse gained the full filter set (all 8 employment types, pay, compensation, location, and sort — the minPay filter and closing-soon sort were previously unreachable on phones), plus employer logo/company/member tools, the applicant-profile editor, and in-app reading of applicants’ screening answers.',
      'Jobs safety/honesty: template placeholders can no longer be published as real jobs, a passed deadline closes applications, deleting a note now confirms first, the editor’s Quiz button stores a quiz that actually opens on the dashboard, reviews are gated to real buyers (no more hardcoded 5-star), and Pay now / View order reach the order an accepted offer created.',
      'Marketplace: sold-out and expired listings drop their purchase CTAs, editing a listing no longer rewrites its sale end date, bundle creation works (it now sends the required campus), and item condition is filterable.',
      'Study: flashcard review shows the interval each grade would schedule, an undo-last-grade, and an end-of-session summary; a lapsed card no longer silently falls out of the review queue; Import & Study actually saves what it generates; and note previews render clean text instead of raw markdown.',
    ],
    howToUse: ['Explore → Jobs (filters, employer hub); Explore → Goods (condition filter); Library → study a deck (grade previews, undo, summary).'],
    surfaces: ['mobile'],
    adminNotes: [
      'APKs are published to the bjamilk/lantern-study-releases repo; the site’s download link tracks the latest release asset.',
      'Ship via full builds, never OTA — OTA from main has crash-looped Android before.',
      'The web + API halves of this work were already deployed; 1.0.26 is the mobile binary that captures it.',
    ],
    commits: ['0e9eec4', 'e31ac98', '9af6337', 'b49f3b8', '05f5792'],
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
  {
    id: 'mobile-campus-shop-1-0-30',
    title: 'Mobile — campus shop, study products, and a tidier day-to-day (1.0.30)',
    area: 'marketplace',
    status: 'shipped',
    shippedAt: '2026-08-27',
    summary:
      'The 1.0.30 binary catches mobile up to the web: marketplace browse/search with a listing classifier, study products from photographed notes, the Study wallet as a Budget tab, and a decluttered Dashboard and Chat.',
    details: [
      'Campus shop: category browse, search suggestions as you type, and a listing detail page with related listings underneath.',
      'Creating or editing a listing runs it through a classifier that picks the category, instead of asking the seller to find it in the taxonomy.',
      'Photographed notes can be published as a Study Product, and semester study packs are proposed from the courses a student takes — enqueued as drafts, one at a time, for review before publishing.',
      'The Study wallet moved into Budget as a sibling tab rather than its own destination.',
      'Dashboard: shortcut tiles for AI Tools/Notes/Flashcards/Explore, the topics-mastery card and the questions-to-review card are hidden; the network feed moved into Notifications; greeting and Daily Quests share one row; Import & Study opens from the dashboard.',
      'Chat: mute durations collapsed under a single Mute control, question filters nested under All questions, and Summarize group chat removed from the overflow menu.',
    ],
    howToUse: [
      'Explore → Goods (browse, search, listing pages); Notes → a photo note → publish as a Study Product; Budget → Study wallet tab.',
    ],
    surfaces: ['mobile'],
    adminNotes: [
      'APKs are published to the bjamilk/lantern-study-releases repo; the site\u2019s download link tracks the latest release asset.',
      'Ship via full builds, never OTA \u2014 OTA from main has crash-looped Android before.',
      'versionCode 86, built from main @ de6ed33; the web and API were already live on 341b0ef, so this is the mobile binary that reaches parity.',
      'Discover (cross-university study rooms, presence, ambassador invites) is in the binary but stays behind the platform-admin gate and shows \u201cComing soon\u201d to everyone else. The Marketplace itself is not gated.',
      'Handwriting OCR is NOT live: /health reports gemini and handwritingOcr off, so the photo-notes OCR path degrades to plain photo notes until those keys are set in Render.',
    ],
    commits: ['de6ed33', '341b0ef', '9158230', 'ac974ae', '40208dd', 'ef6b22d'],
  },
  {
    id: 'community-server-view-1-0-41',
    title: 'Communities as servers \u2014 channels, rooms, members and presence (1.0.41)',
    area: 'groups',
    status: 'shipped',
    shippedAt: '2026-09-02',
    summary:
      'A community is now a place a student stays inside: its lounge is a channel, the study groups filed under it are channels, its open 24h rooms are the voice-like channels, and the roster shows who is online and who runs it.',
    details: [
      'One read paints the view: GET /communities/:id/channels returns the lounge, channels sorted joined-first with unread counts, open rooms, member count and online count.',
      'Chat is unchanged \u2014 channels ARE groups, so messages, realtime, typing, read receipts, reactions, mute and archive all keep working. The chat body is rendered by both the Chat tab and the community, from one extracted component.',
      'Everything stays on the community surface (founder rule): on mobile the community, channels, rooms and roster sit on the community\u2019s own stack; on web a channel renders inside the community page beside the channel column at /discover/c/:slug/ch/:groupId.',
      'Members are cursor-paged with role and online status; Online/Offline sections, status dots and Owner/Admin/Moderator badges. A member who hides their online status never shows a dot.',
      'Presence is two layers: profiles.last_seen_at (5 minutes, honours the privacy setting) plus one Supabase presence channel per community, held only while a community is on screen and gated by membership, low-data mode and a member cap.',
      'Rooms inside a community come from GET /study-rooms?communityId&courseId; room lifetime moved from 6 hours to 24.',
      'Guests of a public community see public channels only \u2014 no rooms, roster, online count or message previews. A private community stays 404 to non-members.',
    ],
    howToUse: [
      'Profile menu \u2192 Community \u2192 tap a community. Web: Discover \u2192 Communities \u2192 a community, or /discover/c/:slug.',
    ],
    surfaces: ['mobile', 'web', 'api'],
    adminNotes: [
      'Still behind canAccessDiscoverHub (platform admins only). Everyone else sees Coming soon.',
      'Security gap closed on the way: group create/update now refuse a community listing from a non-member, so nobody can file a group into a community they are not in.',
      'No new tables and no migration; the pre-existing communities.lounge_group_id migration is applied in production.',
      'Presence topics are not membership-gated yet \u2014 acceptable while admin-only, to be hardened with Realtime RLS before the gate opens.',
      'Verified with two accounts on 2026-09-02: presence, cross-account unread and Owner badges all confirmed live.',
    ],
    commits: ['821697c', '16f1ff2', 'c9a6eb6', 'd0b0747'],
  },
  {
    id: 'marketplace-fee-in-price-1-0-41',
    title: 'Hand-over fee moved into the price (1.0.41)',
    area: 'marketplace',
    status: 'shipped',
    shippedAt: '2026-09-02',
    summary:
      'Buyers pay the listed price with nothing added at checkout; Lantern keeps 5% and the seller receives 95%. Previously the buyer paid list + 5% and the seller received the full list price.',
    details: [
      'resolveMarketplaceFees is the single split decider. The buyer-side surcharge knob defaults to 0; a new MARKETPLACE_PHYSICAL_COMMISSION_BPS (default 500) feeds the hand-over commission.',
      'Every downstream reader \u2014 Paystack initialisation, the webhook amount check, the seller transfer, refunds, the ledger and the shop summary \u2014 reads the stored columns, so nothing else in the money path changed.',
      'A checkout session opened before the change is retired and re-initialised rather than resumed, so nobody is charged the old total under the new copy.',
      'A late Paystack success against a retired session is recorded as a settlement mismatch instead of silently doing nothing.',
      'Buyer disclosures, seller payout copy and the terms describe the new model on both platforms.',
    ],
    howToUse: [
      'Shop \u2192 any hand-over listing \u2192 Buy Now shows a single Total. Sellers see the split on Payouts.',
    ],
    surfaces: ['mobile', 'web', 'api'],
    adminNotes: [
      'Paystack\u2019s processing fee now comes out of Lantern\u2019s 5%, not out of an extra charge to the buyer.',
      'Check GET /marketplace/payments/config reports serviceFeeBps 0 and physicalCommissionBps 500. A stale MARKETPLACE_SERVICE_FEE_BPS=500 in Render would double-dip.',
      'The DB CHECK from 20260823122000 holds for the new split; the only migration is a corrected table comment.',
    ],
    commits: ['69f1a88', 'd77d0d3'],
  },
  {
    id: 'admin-role-management-1-0-41',
    title: 'Platform-admin role management enabled in the console (1.0.41)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-02',
    summary:
      'Make admin / Revoke admin in Admin \u2192 Users now work. The buttons existed but the API refused every call because ENABLE_ADMIN_ROLE_MANAGEMENT had to be set to true and was set nowhere.',
    details: [
      'The variable is now a kill switch: role management is on unless it is set to the literal "false". Any other value, including the old "true", means enabled.',
      'GET /admin/stats reports roleManagementEnabled, and the Users tab disables the buttons with an explanation when the server has it switched off \u2014 instead of failing on click with a 403.',
    ],
    howToUse: ['Admin \u2192 Users \u2192 Make admin / Revoke admin, then type CONFIRM_ADMIN_ROLE_CHANGE.'],
    surfaces: ['web', 'api'],
    adminNotes: [
      'Guards unchanged: platform-admin auth, the typed confirmation phrase, no revoking your own role, the last platform admin cannot be removed, an audit entry, and a forced global sign-out with a session cutoff on revoke.',
      'If the buttons are greyed out, the Render service has ENABLE_ADMIN_ROLE_MANAGEMENT=false set explicitly \u2014 remove it.',
    ],
    commits: ['b284135'],
  },
  {
    id: 'mobile-shop-shell-1-0-41',
    title: 'Mobile \u2014 collapsible Shop search and a tidier profile menu (1.0.41)',
    area: 'marketplace',
    status: 'shipped',
    shippedAt: '2026-09-02',
    summary:
      'The Shop header collapses search behind an icon so Alerts, Cart, You and Sell share the row, and recent searches live in the suggestions rather than a band of their own.',
    details: [
      'Collapsed: a search icon plus Alerts, Cart, You and Sell stretched across the row, with labels when the row is wide enough. Expanded: a full-width field with Close and Clear; only Sell yields its width.',
      'Whether the box is open is derived from the stored query, so returning from a listing or the cart re-shows the field with the query and a Clear control.',
      'The separate Recent chips band is gone \u2014 recent searches were already in the suggestions dropdown, which goes away with the keyboard.',
      'The quick-actions band under the header shows labels only; the hint lines under Your Orders, Buy Again and Saved are gone.',
      'Profile menu order: Community, Jobs, Low-data mode, Dark mode, Settings.',
    ],
    howToUse: ['Shop \u2192 the search icon in the header; profile avatar \u2192 the drawer.'],
    surfaces: ['mobile'],
    adminNotes: [
      'Community and Jobs are gated surfaces, so each row is listed only for accounts that can open it.',
    ],
    commits: ['1f2bf56', 'c386033'],
  },
  {
    id: 'mobile-community-chat-freeze-1-0-42',
    title: 'Mobile \u2014 community chat freeze fixed; decorative accent rails removed (1.0.42)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-03',
    summary:
      'Opening a chat that belongs to a community, from the Chat screen, froze the app until it was force-quit \u2014 every time, and again on re-entry. Fixed. Separately, the coloured edge and tinted fill are gone from cards that used them decoratively.',
    details: [
      'Cause: GroupChatScreen resolved the community through a zustand selector calling findMyCommunity, which returns a fresh { slug, name } object per call. A selector that returns a new object every render is a permanently changed snapshot, so React re-rendered without end and the JS thread never recovered.',
      'Only chats with a non-null communityId could hit it, which is why exactly the community-created chats froze and ordinary chats did not.',
      'Fix: subscribe to the memberships array and derive with useMemo. The selector that invited the mistake is deleted rather than left for reuse, and a test pins the hazard (findMyCommunity returns a fresh object per call, so callers must memoize).',
      'Every other selector in both apps was audited: all return primitives, functions or stored references.',
      'Accent rails: removed from the dashboard greeting (mobile and web), study hub cards, saved sessions, the offline storage card and notification rows; the sub-group rail in the chat list is now a neutral indent marker. Colour at an edge survives only where it is semantic: reply quotes, warning/error callouts, and the selected chat.',
    ],
    howToUse: ['Chat \u2192 any chat created inside a community (its header reads \u201cin <Community>\u201d).'],
    surfaces: ['mobile', 'web'],
    adminNotes: [
      '1.0.41 shipped with this freeze; 1.0.42 is the fix and should replace it on the download link.',
      'Verified on a signed-in emulator: open a community channel from the Chat list, back, reopen, scroll and type \u2014 responsive, with logcat clean of ANR, \u201cMaximum update depth\u201d and the React snapshot warning.',
      'Rule for future work: never call a helper that builds an object inside a zustand selector.',
    ],
    commits: ['2f37242', '53059ce'],
  },
  {
    id: 'community-boards-1-0-43',
    title: 'Community boards \u2014 a community stops being a chat app (1.0.43)',
    area: 'groups',
    status: 'shipped',
    shippedAt: '2026-09-03',
    summary:
      'A community channel is now a BOARD: titled posts newest-first with reactions, comments and one server-side pin. The lounge stays a live chat renamed General. Study moves to study groups, which are created from the community and live in Chat.',
    details: [
      'Founder decisions: the lounge stays a live chat (not a board) and is renamed General; any member may create a board while roles are display-only; board posts do NOT push \u2014 unread badge only, with @mentions still notifying.',
      'A board post is an ordinary message row with a subject and no thread parent; a comment is the same row with a thread parent. Migration 20260903120000 adds groups.community_surface, messages.subject/pinned_at/pinned_by, a roots-only index and a one-pin-per-board unique index.',
      'The surface is derived, not stored, for the lounge: id = communities.lounge_group_id renders as chat, any other community group renders as a board unless community_surface is study_group.',
      'Study groups are created from the community, open in Chat with questions/tests/games, and stay listed under STUDY GROUPS as "Opens in Chat". Boards are filtered out of the Chat tab; the lounge stays in it.',
      'Existing question posts in a former channel render as read-only cards pointing at study groups, so nothing is orphaned.',
    ],
    howToUse: ['Profile menu \u2192 Community \u2192 a community \u2192 General, a board, or + to start a board / study group / room.'],
    surfaces: ['mobile', 'web', 'api'],
    adminNotes: [
      'Still behind canAccessDiscoverHub (platform admins only).',
      'Migration 20260903120000 was hand-applied in production before the merge; the API degrades with an explicit 503 if it is ever missing.',
      'A community can no longer end up with a second, empty lounge: openLounge adopts an existing lounge before minting, and the group-delete route refuses a lounge outright. A lounge WAS deleted outside the app on 2026-09-03 and its messages were lost; the cause was never identified.',
    ],
    commits: ['82757f5', '682a28d', 'dc3b5bf'],
  },
  {
    id: 'chat-wallpaper-1-0-43',
    title: 'Chat wallpaper \u2014 your own photo behind a conversation (1.0.43)',
    area: 'chat',
    status: 'shipped',
    shippedAt: '2026-09-03',
    summary:
      'A student can set a photo from their device as a chat background, per chat from the chat menu or as a default for every chat from Settings, with a chat able to stay plain despite a default.',
    details: [
      'Local only: the photo is downscaled and copied into the app document directory under the signed-in user id, stored as a RELATIVE path rebuilt at read time. Nothing is uploaded, so it costs no data.',
      'Legibility is structural \u2014 with a wallpaper on, no transcript text is drawn on the photo. Bubbles were already opaque; sender names, the replies link, own question bubbles, own reaction chips, date separators and the empty state now sit on opaque pills. The scrim has no path to zero and there is deliberately no dim slider.',
      'Applies to group chats, direct messages and the community lounge; not to boards, which are a post list rather than a transcript.',
      'A file that has genuinely gone missing is forgotten and the chat falls back to plain; a transient decode error never deletes the preference.',
    ],
    howToUse: ['A chat \u2192 \u22ee \u2192 Chat background \u2192 Choose a photo (or No background). Settings for the default across all chats.'],
    surfaces: ['mobile'],
    adminNotes: [
      'Nothing is stored server-side, so there is no moderation surface and no cost; a wallpaper is invisible to everyone but its owner.',
      'An absolute file path would break when iOS rewrites the app container on update, and the cache directory is reclaimed by Android \u2014 hence document directory plus relative paths.',
    ],
    commits: ['3106b35'],
  },
  {
    id: 'board-twitter-actions-1-0-44',
    title: 'Twitter-shaped board posts \u2014 favorite, repost, bookmark, share (1.0.44)',
    area: 'groups',
    status: 'shipped',
    shippedAt: '2026-09-04',
    summary:
      'Community board posts get the four Twitter actions in place of the single emoji reaction, and a post can carry a title, a body and one photo or animated GIF as a single row.',
    details: [
      'Founder decisions: GIF means an uploaded .gif (no Giphy/Tenor integration); video is deliberately out of scope; share is a members-only link via the OS share sheet; a repost returns to the top of the SAME board; favorite replaces the emoji react on boards only, leaving group-chat reactions untouched.',
      'Favorite reuses message_reactions with one fixed emoji, so the per-user state, the count and the denormalising trigger all come free \u2014 no new table and no new endpoint.',
      'Repost writes client_message_id = repost:<originalId>, so the existing UNIQUE (group_id, sender_id, client_message_id) partial index enforces one repost per person per post in the database rather than in the UI. A repost whose original is hard-deleted recovers the id from that key and renders a tombstone instead of a blank card.',
      'Bookmarks are account-level and private. Migration 20260904120000 adds message_bookmarks with RLS on, no policies and no anon/authenticated grants \u2014 service-role only, matching message_reactions. There is deliberately no denormalised count: on a board with a visible roster, a save count would turn a private "read later" into a social signal.',
      'The device-local saves it replaces (mobile AsyncStorage per board, web localStorage flat) are imported once per account, each row carrying its own descending timestamp so the strict keyset pagination cannot skip ties.',
      'The 5MB GIF cap is enforced in the upload route, not only in the composers, because the route otherwise accepted 10MB and passed animated GIFs through byte-for-byte.',
    ],
    howToUse: [
      'A community \u2192 a board \u2192 any post: heart to favorite, arrows to repost, bookmark to save, share for the link. Saved posts lists everything you bookmarked.',
      'Composer: title, body, then the photo or GIF button \u2014 all posted as one post.',
    ],
    surfaces: ['mobile', 'web'],
    adminNotes: [
      'Migration 20260904120000_board_bookmarks.sql must be hand-applied. Until it is, bookmark writes answer 503 and reads report serverBacked: false; boards keep loading normally.',
      'The note-files bucket declares no file_size_limit, so the route-level GIF cap is the only server-side limit on passthrough GIFs.',
    ],
    commits: ['41df865'],
  },
  {
    id: 'in-app-dialogs-1-0-45',
    title: 'Every dialog is the app\u2019s own, and BACK is never a dead key (1.0.45)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-08',
    summary:
      'All 412 system alerts were replaced with one in-app dialog on the design system, and hardware BACK now always resolves a dialog instead of doing nothing.',
    details: [
      'components/ui/appDialog exposes appAlert with React Native Alert.alert\u2019s exact signature, plus confirmAsync for the two-button case, so the sweep across 79 files was an import swap rather than a rewrite.',
      'A single AppDialogHost is mounted above every navigator and modal layer. A dialog raised from inside a Modal screen draws above it \u2014 verified on device, since nested Modal stacking on Android cannot be tested in jest.',
      'BACK runs the cancel button, or the only button when there is one. The exploratory run that prompted this found students trapped on OK-only notices, where BACK did nothing at all.',
      'noSystemAlertLint fails the build if Alert.alert reappears anywhere under apps/mobile/src.',
      'Contrast is asserted for title, message and every button on colors.card in both palettes.',
    ],
    howToUse: [
      'Any confirmation, error or notice in the mobile app is now the in-app dialog.',
      'Press BACK on a dialog: a confirm cancels, a single-button notice runs that button.',
    ],
    surfaces: ['mobile'],
    adminNotes: [
      'A student reporting a "stuck" screen on an older build was almost certainly on an OK-only system alert where BACK was inert.',
    ],
    commits: ['c0c53f05'],
  },
  {
    id: 'study-shop-own-bar-1-0-45',
    title: 'Study and Shop take over the bottom bar, and the door you are in is named (1.0.45)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-08',
    summary:
      'In Study and Shop the contextual row replaces the global five-tab bar, with one adaptive control out. Every door carries its name, and the selected one is named larger beside its icon on its own tint.',
    details: [
      'The row used to sit above the global bar; in Study and Shop it now stands in its place. Deck detail, the note editor, the walk-through and the community page keep the row above the bar, because those are single screens you pass through.',
      'One leading control adapts: Back when the stack can pop, Home at a section root. It is never absent and never inert.',
      'A selected door is named at 15 sp beside its icon on the feature tint; a row with no selection labels every door at 11 sp, the same treatment the pass-through rows use. Verified on device that "Flashcards" renders whole at 360 dp and 411 dp at the default text size, and truncates only at 360 dp with text at 1.5x, where the full word remains in the accessible name.',
      'Bottom clearance changes with the mode and is computed in one planner rather than at each call site \u2014 about 40 screens read it.',
    ],
    howToUse: [
      'Tap Study: the bottom bar becomes Library, Flashcards, Tests, Record and AI with a Home button.',
      'Move between doors without climbing back to the hub; the leading button returns you to the rest of the app.',
    ],
    surfaces: ['mobile'],
    adminNotes: [
      'Founder decision on 2026-09-08, overturning the earlier rule that the global bar never moves. The rationale comments in navigation/contextualBars.ts were rewritten to match.',
    ],
    commits: ['3e402eda', 'c8c544e3', '840ccf00'],
  },
  {
    id: 'board-mark-answered-1-0-45',
    title: 'A community question can be marked answered (1.0.45)',
    area: 'groups',
    status: 'shipped',
    shippedAt: '2026-09-08',
    summary:
      'The asker or a moderator can point a question post at the reply that answered it, and undo it. The column and the shared rule existed since Wave 8; nothing wrote it, so both clients hid the control.',
    details: [
      'POST /communities/:communityId/posts/:postId/answered takes an answerMessageId, or null to clear.',
      'Permission is re-derived server-side from the shared boardPostRules \u2014 answerable kind, not removed, author or moderator. A client flag is never trusted.',
      'A foreign reply is rejected by one equality, thread_root_id = postId, which covers another board, another community, a removed reply and the post pointing at itself.',
      'The accept control lives on the reply\u2019s own long-press rather than the post\u2019s menu, because a board card never renders the replies \u2014 a post-menu control could not point at one. The post menu carries only "Clear accepted answer".',
      'Un-answering records its own audit action carrying the previous value, so a clear is distinguishable from never having been set.',
    ],
    howToUse: [
      'Open a community board question, long-press the reply that answered it, and choose Mark as answer.',
      'The post menu offers Clear accepted answer once one is set.',
    ],
    surfaces: ['mobile', 'web'],
    adminNotes: [
      'Requires migration 20260908120000 (applied 2026-09-08). A database without answered_message_id gets a 503 and the honest not-enabled copy, never a 500.',
    ],
    commits: ['db54b617'],
  },
  {
    id: 'honest-ai-allowance-identity-1-0-45',
    title: 'The app stopped stating an AI allowance and a name it was never given (1.0.45)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-08',
    summary:
      'On a cold start both clients printed a confident "20 of 20" from a shared default, for accounts the server gives 100. And an account with no name was called by its email local part, on every avatar and to screen readers.',
    details: [
      'Every failure path \u2014 the fetch catch, auth-not-ready, the 429 backoff \u2014 returned a synthesized default. Both clients now start at an explicit unknown that renders as silence and gates no generation; the server stays the only real limit.',
      'A failed generation was already refunded server-side, but the phone never re-read its counters. GET /jobs/:id now carries the live usage headers and both job clients republish them. refundFeatureAiCredit also hard-coded a one-credit refund, so multi-credit jobs kept the difference.',
      'The email-as-name defect was not a client bug: the signup trigger stored the email local part as profiles.name, which no client could tell from a chosen name. Migration 20260908140000 fixes that forward; ensureUserProfile on mobile no longer writes it either.',
      'A real name that happens to match the email local part is kept \u2014 the rule drops addresses, not people called ada with an ada@ address.',
      'Avatar colour is seeded from the account id, so accounts without a name no longer all render the same colour.',
    ],
    howToUse: [
      'Me \u2192 Usage & limits shows "Checking your AI uses\u2026" rather than a number, when the figures are not known.',
    ],
    surfaces: ['mobile', 'web'],
    adminNotes: [
      'Migration 20260908140000 must be hand-applied for new signups; existing rows are untouched. The release notes for that migration carry the count query and the optional backfill.',
    ],
    commits: ['51317dd2', '46f4e714'],
  },
  {
    id: 'board-media-signing-fix-1-0-44',
    title: 'Shared photos stopped disappearing after 24 hours (1.0.44)',
    area: 'chat',
    status: 'shipped',
    shippedAt: '2026-09-04',
    summary:
      'Every photo and voice note shared in a chat or on a board became unreachable one day after posting, silently on mobile and as a broken image on the web. Media is now re-signed on read.',
    details: [
      'uploadChatImage and uploadChatAudio requested a 7-day signed URL; createSignedStorageUrl runs that through clampSignedUrlTtl, whose ceiling is 24 hours. The already-clamped URL was written verbatim into messages.text and nothing ever re-signed it.',
      'Mobile passed the stored URL through normalizeStorageUrl, which returns cloud URLs unchanged, and ChatImageThumbnail returned null when the image failed \u2014 so the photo vanished with no error and no placeholder. Web used a bare <img> and showed a broken image.',
      'Fixed on read rather than by raising the cap: the stored URL is treated as a reference and re-signed through POST /storage/signed-urls. A shared coalescer batches every resolve in one tick into a single request, de-duped by (bucket, path, variant) and chunked to the route cap, so a 20-photo screen is one call.',
      'Nothing is lost retroactively \u2014 only the link had expired, and the object path survives in the stored URL, so photos posted before this release load again.',
      'Separately, no message query selected the reactions column, so every count read {} until a realtime update or the viewer own tap. Fixed for group messages, threads, pinned posts and DMs, each degrading if the column is absent.',
    ],
    howToUse: ['Nothing to do \u2014 old photos load again on next open.'],
    surfaces: ['mobile', 'web'],
    adminNotes: [
      'STORAGE_SIGNED_URL_MAX_TTL stays 24 hours deliberately; the fix is on the read path, so raising it would only widen the window on a leaked URL.',
      'POST /storage/signed-url (singular) now has no client callers \u2014 the batch route replaced it.',
    ],
    commits: ['41df865'],
  },
  {
    id: 'ai-answers-full-width-1-0-46',
    title: 'Lantern AI answers render full-width on Android (1.0.46)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-10',
    summary:
      'Companion answers on Android collapsed to roughly one character per line, which made every reply unreadable. Answers now fill the bubble, and the markdown the model actually writes renders as structure instead of raw syntax.',
    details: [
      'The answer text no longer collapses to a single character per line on Android \u2014 the bubble takes the width it is given, so a long reply reads as paragraphs.',
      'Markdown blocks render: headings, nested and numbered bullets, tables, and fenced code, rather than printing their source characters.',
      'AI colours and type roles moved onto design tokens, so the companion follows the palette in both light and dark instead of carrying hard-coded values.',
      'A typing indicator shows while an answer is being produced, so a slow reply no longer looks like a dead screen.',
    ],
    howToUse: [
      'Study \u2192 AI: ask anything. Answers arrive full-width, with headings, lists, tables and code blocks laid out.',
    ],
    surfaces: ['mobile'],
    adminNotes: [
      'A student reporting "the AI reply is one letter per line" or unreadable answers was on 1.0.45 or earlier on Android; the fix requires the 1.0.46 build, not an OTA-only change.',
    ],
    commits: ['79e27c30'],
  },
  {
    id: 'study-set-parity-wave-1-1-0-47',
    title: 'Study sets scope the studios, and generated work is filed where it belongs (1.0.47)',
    area: 'notes',
    status: 'partial',
    shippedAt: '2026-09-11',
    summary:
      'Wave 1 of study-set parity: six mobile studios are scoped by the study set you are in, generated decks are filed into that set on both clients, refused saves say why and can be retried, and Turn Into offers six destinations with honest costs. Study sets carry their own exam date, which stays switched off until migration 20260911140000 is applied.',
    details: [
      'Six mobile studios are scoped by study set, so what you see in a studio is the set you opened, not everything you own.',
      'A generated deck is filed into its study set on web and mobile; the API returns study_set_id so the client files it rather than guessing.',
      'A refused save shows the server\u2019s own reason instead of a generic failure, and retry works from that message \u2014 previously the work was simply lost.',
      'Turn Into sits at the top of the notes studio and offers six destinations with honest costs, with Play marked free.',
      'Plan and Essay are primary set tools rather than buried entries, and copy says "set" when you are in a set.',
      'The notes studio shows a running job, so a generation in flight is visible instead of appearing to have done nothing.',
      'Each study set carries its own exam date; until the migration lands the UI says exam dates are not switched on yet rather than failing.',
    ],
    howToUse: [
      'Open a study set, then any studio: Library, Flashcards, Tests, Record, AI and Notes are scoped to that set.',
      'Notes studio \u2192 Turn Into: pick one of six destinations; Play is free and the rest show their cost up front.',
      'Set tools: Plan and Essay are on the set itself.',
    ],
    surfaces: ['mobile', 'web', 'api', 'database'],
    adminNotes: [
      'Feature shipped incomplete until the migration is applied: 20260911140000_study_set_exam_date.sql is hand-applied. Until then per-set exam dates stay off and the UI says so \u2014 a student reporting "I cannot set an exam date on my set" is hitting that, not a bug.',
      'Everything else in Wave 1 (studio scoping, deck filing, honest refusal reasons, Turn Into, running-job visibility) is live without the migration.',
    ],
    commits: ['cfcb4dea'],
  },
  {
    id: 'studyfetch-look-note-typography-1-0-48',
    title: 'StudyFetch look on web and phone, real note typography, and Home doors that open (1.0.48)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-12',
    summary:
      'Wave 2: web and mobile wear the same StudyFetch-style skin — cream ground, charcoal rail, pastel door tiles with black art and a hard shadow, black pill buttons and Bitter serif titles. Notes render with a real heading hierarchy instead of flat text, companion citations are chips, the cross-set attachment leak is closed, and the Home doors go where they say.',
    details: [
      'One look on both clients: cream ground, charcoal rail, pastel door tiles carrying black art and a hard shadow, black pill buttons, Bitter serif titles with an italic accent, and a mint hue for sets.',
      'The mobile tab bar is a black pill that keeps all five labels rather than dropping them to fit.',
      'Notes and lecture notes render through a shared block parser, so headings, subheadings and body text carry a real hierarchy; an Edit toggle switches between the rendered note and its source.',
      'Companion citations render as chips instead of inline noise, and the attachment leak that let one set’s file follow you into another set is fixed.',
      'Home doors work: the Record tile no longer throws, Continue continues where you left off, and quiz and tutor open distinct doors instead of the same one.',
      'Web: a set’s Plan tab carries an exam-date field.',
      'Mobile: the Home set list caches, so it renders from cache and says it is offline rather than showing nothing.',
    ],
    howToUse: [
      'Open the app on web or phone: the new look applies everywhere; Home tiles are the doors into Record, quiz, tutor and Continue.',
      'Open a note or lecture note: it renders with headings; use Edit to see and change the source.',
      'Web → a study set → Plan: set the exam date for that set.',
    ],
    surfaces: ['web', 'mobile'],
    adminNotes: [
      'A student reporting flat, heading-less notes, a Record tile that crashes, or a companion attachment showing up in the wrong set was on 1.0.47 or earlier; all four need the 1.0.48 build.',
    ],
    commits: ['11c4e9e7'],
  },
  {
    id: 'mobile-parity-wave-p-1-0-49',
    title: 'The phone catches up with the web app: Home, the set room, the companion and Me (1.0.49)',
    area: 'platform',
    status: 'shipped',
    shippedAt: '2026-09-12',
    summary:
      'Wave P brings mobile up to the web app: Home in web’s order with six door tiles and a review button that actually reviews, a set room with a persistent timer, a server-backed plan and set-scoped doors, new upload, settings and artifact-library screens with folders, a companion that says what it is scoped to, and a Me progress hub with readable charts. Web gets serif headings by default, stream errors that keep the exchange, and citations back from the queue worker.',
    details: [
      'Mobile Home follows the web order, with six door tiles and a review button that starts a review instead of going nowhere.',
      'The set room holds a persistent timer, a server-backed plan, doors scoped to that set, and responds to touch as soon as it opens.',
      'New mobile screens: upload, settings, and an artifact library organised into folders.',
      'The companion shows the scope it is answering in, offers scoped prompt chips, has a real empty state, a searchable history and six named actions; an attachment is stamped with the room it belongs to.',
      'The companion no longer re-opens after the app is backgrounded, and a send cannot fire twice.',
      'Me is a progress hub, with chart axes that can be read.',
      'Web: serif headings render by default, a stream error keeps the exchange instead of discarding it, and the queue worker returns citations.',
    ],
    howToUse: [
      'Mobile → Home: six door tiles in the web’s order; the review button starts a review.',
      'Open a study set: the room carries the timer, the plan and the set’s own doors; upload, settings and the artifact library are reachable from there.',
      'Mobile → AI: the scope line says what the companion is answering over; chips, history search and the six actions sit with it.',
      'Mobile → Me: the progress hub.',
    ],
    surfaces: ['web', 'mobile'],
    adminNotes: [
      '"Study all N due" still reviews the largest deck rather than everything due — known, and a Wave 3 item; a student reporting it is not hitting a new bug.',
    ],
    commits: ['97ad22f1'],
  },
];

export function sortProductFeatures(entries: ProductFeatureEntry[]): ProductFeatureEntry[] {
  return [...entries].sort((a, b) => {
    if (a.shippedAt !== b.shippedAt) return b.shippedAt.localeCompare(a.shippedAt);
    return a.title.localeCompare(b.title);
  });
}
