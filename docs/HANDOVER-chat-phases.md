# Handover — mobile chat: reliability, performance, capability, robustness

Written Aug 5 2026. Full plan (executable detail for every remaining step):
`~/.claude/plans/looking-at-the-chat-gentle-ritchie.md`.

## Why this work exists

An audit of the chat surface found four classes of problem, none of which came from a
bug report:

1. Chat could **lose messages** — three independent mechanisms in `groupStore.ts`, and it
   was the only major feature that never touched the offline queue.
2. A lot is **built but unreachable** — store actions and API functions with zero UI callers.
3. **Re-render storm** — both chat screens subscribed to the whole store; no message
   component is memoized.
4. **Failures render as empty states** — a network error on the chat list shows
   "No conversations yet — Create Group", indistinguishable from a new account.

## Done (committed, NOT pushed)

| Commit | What |
|---|---|
| `83f88c1` | Phase A — the three message-loss fixes + `deliveryState` + "Not sent · Retry" |
| `203c8c4` | A6 — offline outbox on `syncService` |
| `f30005b` | B1/B2 — per-value selectors, gated question chain |

**Phase A detail.** `sendMessage`'s catch restored snapshots captured *before* the await,
destroying any realtime message that landed mid-send and reverting the whole `groups`
array. Group sends threw "Another message is still sending" as an Alert; DM sends did a
bare `return` after the composer was already cleared. DM failures deleted the optimistic
row and never reverted `dmThreads[].lastMessage`, so the list advertised a message that
never sent. All fixed; sends now serialize through a per-conversation promise chain.

**A6 detail.** `syncService.registerHandler` is a new passthrough; the `'message'` handler
is registered **from groupStore**, because syncService imports no stores and registering
there would create a cycle. Network-shaped failures enqueue and stay `pending`; server
rejections are `failed`. Replay is safe — same `clientMessageId`, unique partial indexes
on `(group_id, sender_id, client_message_id)` with `23505` recovery.

## Remaining

**B3** memoize `MessageBubble` (remove its per-row store subscription — N subscriptions +
N `groups.find()` scans per update; pass `members` down instead). Use the **default**
shallow comparator; a hand-written one that forgets `userVote` / `isGroupedWithPrevious` /
`flagCount` is a silent correctness bug.
**B4** stable memoized `MessageRow` — **must** add `extraData` covering `userVotes`,
`firstUnreadId`, `user?.id`. Plan flags this as the most likely regression in the phase.
**B5** FlatList windowing on all four lists. `removeClippedSubviews` **Android only** — on
iOS it blanks cells and breaks the `scrollToIndex`/`scrollToEnd` these screens rely on.

**C0** delete `inviteByEmail`, `approvePendingMember`, `rejectPendingMember`, the
`pendingMembers` field, and 12 unconsumed returns from `useGroupHandlers`.
**C1** group-invites inbox (`fetchPendingGroupInvites` has no caller).
**C2→C4** invite-link chain, ordered. **C5** blocked-users screen. **C6** image attach in
DMs/threads. **C7** mentions + AI tutor in threads.

**D1–D7** error/empty-state primitives, `listError` in the store, then accessibility.

## Traps

- **`inviteByEmail` is dangerous, not just dead.** No email match falls through to
  `(results as any[])[0]` and calls `addGroupMember` — and `/users/search` matches
  usernames only, so the match essentially never succeeds. Wiring it up would add an
  arbitrary stranger to a private group. Delete it.
- **`approvePendingMember`/`rejectPendingMember` have no server concept.** `pending` means
  "invitee hasn't accepted"; `getGroupMembers` filters those rows out and no endpoint
  returns `pending_members`. A mobile approval UI would be permanently empty. Web's
  equivalent section is vestigial for the same reason.
- **Typecheck baseline is 55 pre-existing errors.** The change is clean only if it stays at
  55, never zero.
- **No component test harness exists in `apps/mobile`.** Add unit tests only for new pure
  helpers; do not invent a harness.
- **Mobile ships via EAS only.** `npx eas-cli login` then
  `build --platform android --profile preview`. Claude cannot run this — it needs the
  user's Expo credentials. Dev clients show everything; a real phone shows none of it.

## Verification debt (important)

Everything above is **typechecked and boot-verified only**. None of the plan's device
scenarios have been run:

- two devices in one group, kill A's network mid-send while B's message lands — B's
  message must survive A's failure
- airplane mode, tap send three times — three pending bubbles, all deliver in order on
  reconnect, no alert
- offline send → force-quit → reopen → reconnect → exactly one message on the peer
- render counter in `MessageBubble` on a 200-message group — a keystroke should re-render
  0 bubbles (was N)

## Loose end spotted while verifying

`DmBubble` never got the WhatsApp restyle — it still uses `colors.primary` for the own
bubble while `MessageBubble` uses `chatBubbleOwn`, so DMs and groups look like different
apps. Same bucket as the outstanding bubble-chrome items.
