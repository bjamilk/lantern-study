# Handover — outstanding items 1, 2, 4, 5 from the chat-verification handover

Written Aug 9 2026, following [`HANDOVER-2026-08-09-chat-verification.md`](./HANDOVER-2026-08-09-chat-verification.md).
Item 3 (the mobile EAS build) was explicitly out of scope.

**Nothing here is committed.** The working tree carries the changes below.

## 2 — DmBubble now matches MessageBubble ✅

DMs and groups were two different apps: `DmBubble` painted the own bubble
`colors.primary` (indigo) with `textInverse` text and a hardcoded `#c7d2fe` for
meta, sitting on the same WhatsApp paper canvas the group chat uses.

It now uses the shared `chatBubbleOwn / chatBubbleOther / chatBubbleText /
chatBubbleMeta` tokens, drops the border the peer bubble had (MessageBubble has
none), and passes `onPrimary={false}` to `ReceiptTicks` — the own bubble is pale
green now, not indigo, so the white-on-primary tick would have been invisible.

Two pieces moved out of `MessageBubble` so the divergence cannot recur:

| New file | Why |
|---|---|
| `components/chat/VoiceNotePlayer.tsx` | DMs had their own Play/Pause pill with no duration and no seek. Both surfaces now use the scrubbable player; it reads the `chatBubble*` tokens itself, so callers pass only `isOwn`. |
| `components/chat/ChatMessageBody.tsx` | `MentionText` + the `![image](url)` unwrapping. |

**That second one fixes a live bug.** `useChatImageAttach` posts attachments as
`![image](url)` markdown, and only `MessageBubble` knew how to unwrap it — so
once C6 enabled the attach button in DMs and threads, those bubbles rendered the
raw markdown as literal text. Sharing the body component fixes DMs and threads.

Verified on the Android emulator against a real DM and the group chat side by
side: identical green own-bubble, identical white peer bubble, identical meta
colour, receipt ticks legible on both.

## 4a — B5 windowing ✅ (verified at 248 rows)

The previous session could not get the list long enough. Numbers now:

| List length | MessageBubbles mounted |
|---|---|
| 62 rows (the group's real length) | **62** — every row mounted, windowing never engages |
| 248 rows | **97 at rest, 15–104 while scrolling, peak 104** |

So `windowSize: 11` needs roughly **145+ rows** at this bubble height before
anything falls out of the window — which is why 30, and then 62, showed nothing.
At 248 rows about 60% of the list stays unmounted.

`removeClippedSubviews` (Android only) is clean: 40 fast flings up to the top of
history and 40 back down, screenshotting every 10 — no blank cells at any sample,
including the frames where the mounted count had dropped to 15 mid-fling.

**How it was measured** (both edits reverted, nothing committed): a mount/unmount
counter in `MessageBubbleComponent` logging to Metro, and a temporary `useMemo` in
`GroupChatScreen` that padded `displayMessages` 4× under fresh ids. Padding is the
only practical way to reach that length — see the seeding trap below.

## 4b — screen-reader pass ⚠️ done, and it found things

TalkBack was enabled on the emulator and confirmed driving focus (green focus
rect, swipe-right traversal). TalkBack does **not** log its utterances without its
own developer flag, so this is a traversal-and-label audit of the live
accessibility tree — not a literal listen. Findings are real either way, since
TalkBack's linear traversal follows tree order.

D7's result holds: **0 unlabelled clickables** on GroupChatScreen. But:

1. **Every message is announced four times.** The bubble carries a good label
   (`"You at 8:12 PM. n1n2"`), and then its children are separate stops: the
   message text, the timestamp, and the receipt. A TalkBack user swipes
   `"You at 8:12 PM. n1n2"` → `"n1n2"` → `"8:12 PM"` → `"Seen by 1 of 1"` for
   *every* message. This is the one that makes chat unusable by ear.
   Not a one-line fix: the reply-quote, the voice-note controls and the
   `Not sent · Retry` button live inside the same bubble and must stay focusable,
   so `no-hide-descendants` on the row is wrong. The timestamp is already in the
   bubble label; the receipt is not, and is worth keeping — probably fold it in
   and hide only the two text children.
2. **The header reads `"zz-verify-temp, ZZ, zz-verify-temp, 2 members"`** — the
   avatar's initials are announced, and the title twice.
3. **`Send` is announced twice** (button label + its text child).
4. **Touch targets under Android's 48dp minimum:** Go back 36×37dp,
   More actions 36×37dp, Send 49×32dp. Attach image and Record voice note are
   44×44dp — they set a 44pt minimum, which is the *iOS* guideline.

**Update, later the same session: all four were fixed** (user asked for all four).

1. Message rows now compose one label — speaker, time, content, edited flag,
   delivery state: `"You at 8:24 PM. w14q1. Seen by 1 of 1"`. Media markers go
   through `chatMessagePreview`, so a voice note announces as "Voice note", not
   a signed URL. The duplicate children (message text via `MentionText`,
   timestamp, "edited", "Sending…", question stem) are
   `importantForAccessibility="no"`; the static receipt tick is hidden inside
   `ReceiptTicks`. Everything interactive keeps its own stop: reply-quote,
   thread link, Retry, voice-note controls, the long-press seen-detail tick,
   and the "Mention X" author press. Also fixes the `Seen by 0 of 0`
   announcement (now falls back to "Sent").
2. `ResolvedAvatar` grew a `decorative` prop (label removed,
   `no-hide-descendants`, `accessibilityElementsHidden`); used in
   `GroupChatHeader` and both bubbles. Node-level before/after: the header
   avatar used to be its own labeled node duplicating the title; now only the
   title carries the name.
3. Shared `Button` (`components/ui/index.tsx`): caption Text is
   not-important, label falls back to string children, plus
   `accessibilityRole="button"` and disabled/busy state. Fixes "Send, Send"
   everywhere Button is used.
4. Go back / More actions now `min-w/h-[48px]`; Add question, attach, mic
   bumped 44→48; composer Send gets `min-w/h-[48px]` via className. Verified
   from node bounds: nothing interactive in the header/composer is under 48dp
   except the TextInput itself (37dp tall — not in the findings, left alone).

Files: `MessageBubble.tsx`, `DmBubble.tsx`, `ChatMessageBody.tsx`,
`ReceiptTicks.tsx`, `GroupChatHeader.tsx`, `ChatComposer.tsx`,
`ResolvedAvatar.tsx`, `components/ui/index.tsx`. Typecheck identical to
baseline; mobile jest unchanged (the one pre-existing failure).

**Verification honesty:** labels, bounds, and the avatar de-duplication are
confirmed from the live tree on the emulator. The child-text *silencing* cannot
be confirmed via uiautomator — it sets `FLAG_INCLUDE_NOT_IMPORTANT_VIEWS`, so
not-important nodes still appear in dumps; TalkBack does not set that flag and
skips them (documented platform behavior). An empirical TalkBack focus walk was
attempted; TalkBack on this emulator intercepts injected gestures
nondeterministically (some boots treat `input tap`/`swipe` as real touches —
one stray swipe armed swipe-to-reply), so a literal listen on a real device
remains the last residual. `adb shell input keycombination 57 22` (Alt+Right)
does drive TalkBack linear navigation reliably when you need it.

## 5 — security-audit: high advisories 18 → 12, CI still red

`npm audit fix` is **unusable at the root** — it tries to "fix" `expo` by
downgrading it to 48.0.21 and dies on peer resolution. Every change below is a
targeted version bump instead.

| Fixed | How |
|---|---|
| postcss | root devDep `^8.5.15` → `^8.5.26`, and the existing `expo → postcss` override with it |
| nanoid | new override `^3.3.18` (both consumers, postcss and `@react-navigation/routers`, ask for `^3.3.11`) |
| js-yaml | nested override `@expo/xcpretty → js-yaml ^4.3.1` (a blanket override would have dragged istanbul's js-yaml 3 to 4 and broken it) |
| react-router / react-router-dom | `apps/web` `^7.18.0` → `^7.18.2` |
| pdfjs-dist | `apps/api-server` `^5.6.205` → `^6.2.108` |

The pdfjs bump is the only one that closes a **reachable runtime** hole:
`pdfPageOcr.ts` rasterizes user-uploaded PDFs, which is exactly the surface of
GHSA-hq66-cqwq-w95j (arbitrary JS execution on a malicious PDF). The 5→6 major was
smoke-tested against the precise API that file uses — `legacy/build/pdf.mjs`
import, `getDocument`, `getViewport`, `render({canvasContext, viewport, canvas})`
onto `@napi-rs/canvas`, `destroy` — including asserting the rasterized page is not
blank. Drop-in.

**The 12 that remain, and why they stay:**

- 10 are the **expo / metro / react-native build toolchain** (`@expo/cli`,
  `@expo/metro*`, `metro*`, `image-size`, `react-native`,
  `@react-native/community-cli-plugin`). npm's suggested "fixes" are
  `expo@53`/`react-native@0.72` — *downgrades*. Genuinely needs the expo 57
  upgrade project.
- 2 are **officeparser → its pinned `pdfjs-dist` 5.6.205**. Upstream-blocked:
  officeparser 7.5.1 pins `6.1.200`, still inside the advisory range. I tried an
  `officeparser → pdfjs-dist` nested override and **reverted it** — npm dropped
  officeparser's nested copy and resolved it against the hoisted `pdfjs-dist`
  4.10.38 that `apps/web` owns, which is worse than the vulnerability. Don't
  repeat that.

So `security-audit` stays red, exactly as the last handover predicted.

Two side effects worth knowing: `npm install` pruned 32 stale nested lock entries
(including `@react-native/metro-config`, which nothing references —
`metro.config.js` uses `expo/metro-config`), and **`scripts/package-lock.eas-mobile.json`
was not touched**, so EAS builds still resolve the old versions.

## Also fixed — Group Settings ignored light mode (mobile)

Spotted in a screenshot mid-session: the Group Settings sheet stayed dark navy
with white text while the app was in light mode.

`apps/mobile/src/components/GroupInfoModal.tsx` built its `StyleSheet` at module
scope with **41 baked dark-mode hexes**. Only a handful of inline styles read
`useTheme`, and one of them —
`<View style={[styles.container, { backgroundColor: colors.card }]}>` — repainted
the sheet's own background, which is why the modal chrome looked right while
everything inside it stayed dark.

The sheet is now `makeStyles(colors)` behind a `useMemo`, with every surface,
text and border colour mapped onto the theme tokens. Saturated fills keep white
text on purpose (primary, warning, error, and the sky accent on Create Subgroup)
— correct in both themes. Verified on the Android emulator in light mode across
all three tabs: Details, Members and Danger.

**Web is a different story.** `components/GroupInfoModal.tsx` (the root
`components/` tree is the web app — `apps/web/vite.config.ts` sets `root` to the
repo root) is already theme-aware: it uses `bg-lantern-*` CSS-variable tokens and
paired `dark:` variants throughout, including the danger cards
(`bg-orange-50 dark:bg-orange-900/30` and friends). `components/ui/Modal.tsx` is
`bg-lantern-surface`. I could not confirm this in a browser — the preview tab was
stuck on a policy check — so if you are seeing it on web, it is a different
screen and worth naming.

## 1 — test data: NOT deleted, and there is more of it now

`zz-verify-temp` is still there, and B5 seeding added roughly 50 more junk
messages to it (`n*`, `b5-*`, `w*`, `q*`, `p*`, `z*`).

I don't perform permanent deletions of real account data, so the last press is
yours. The emulator is parked on the exact screen: **⋮ → About group → Danger →
Delete Permanently**.

## Baselines — all matched

- `apps/mobile` typecheck: 51 `src/` lines, identical error *set* to before. The
  only delta is `TS2694 AVPlaybackStatus` moving `MessageBubble.tsx` →
  `VoiceNotePlayer.tsx` with the code.
- Tests: shared 413 pass, web 24 pass, api-server 204 pass, mobile 31 pass with
  the one pre-existing `marketplaceFilters` failure.
- `apps/web` and `apps/api-server` typecheck clean; `vite build` succeeds.

## New trap for the dev-environment list

**Scripted `adb` chat sends silently merge.** `ChatComposer` disables Send while
`sending` is true, so a tap during the round trip is swallowed — the draft stays
and the next `input text` appends to it, producing messages like
`b5-22b5-23b5-24b5-25`. A blind fixed-delay loop lost about two of every three
sends; longer delays and press-with-duration did not help. Poll until the
composer shows its placeholder again, or don't seed at all — pad the list in code,
as the B5 run did.

Also: `packages/shared` runs **jest**, not vitest. `npx vitest run` there fails all
57 suites with `describe is not defined` and looks like a catastrophic regression.
