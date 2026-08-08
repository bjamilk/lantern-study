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
| *(working tree)* | B3/B4/B5 — memoized bubbles, `MessageRow`/`DmMessageRow`, FlatList windowing |

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

**Phase B detail (uncommitted).** `MessageBubble` lost its per-row store subscription and
takes a `members` prop; `timeLabel` / `optionItems` / `authorLabel` / `mentionUsername` /
`avatarUrl` moved into `useMemo` *above* the `isRemoved` early return; both bubbles are
`React.memo` with the **default** comparator. New `MessageRow` (GroupChatScreen) and
`DmMessageRow` (DirectMessageScreen) own the date separator / unread divider / grouping and
build the per-message closures internally, so only primitives and stable references cross
the memo boundary. `DmMessageRow` memoizes the projection object `DmBubble` takes —
a fresh literal there would defeat the memo outright. Both lists carry `extraData`
(`userVotes`, `firstUnreadId`, `user?.id`, roster). Screen-level handlers
(`handleVoteMessage`, `handleFlagMessage`, `handleMentionUser`, `handleScrollToMessage`,
`handleRetryMessage`) are `useCallback`-stable; `handleScrollToMessage` reads the message
list through a ref so its identity survives every incoming message. Windowing lives in
`components/chat/chatListWindowing.ts` and is spread onto all four lists.

**Phase C detail (uncommitted).**

- **C0** — `inviteByEmail`, `approvePendingMember`, `rejectPendingMember` and the
  `pendingMembers` field/mapper are gone from `groupStore`, and `pendingMembers` is also
  gone from `packages/shared` types + `apiMappers` and from the api-server type. Verified
  first that no endpoint ever emits `pending_members` — it was a type with no producer.
  `useGroupHandlers` dropped its 12 unconsumed returns (kept `handleSelectGroup`,
  `handleInitiateDm`, `userVotes`) and its whole-store subscription with them.
- **C1** — group-invites section in `GroupsScreen`, above message requests, with
  Accept/Decline. Accept refetches groups *before* navigating, because the group is not in
  the store yet and `GroupChatScreen` reads its name and roster from there. An invites
  fetch failure is swallowed deliberately so it cannot blank the chat list.
- **C2** — mobile `mapApiGroup` now maps `inviteId`. The server was already returning it;
  mobile dropped it, so every generated link carried the group id and was a dead end.
- **C3** — `buildGroupInviteLink` in `packages/shared/src/linking`, `'invite'` added to
  `DeepLinkType`, and `useDeepLinkHandler` now resolves *both* `/invite/<token>` and the
  older `?inviteId=` form. Only the query form was handled before, so links the app itself
  produced did nothing for the recipient. Unit tests in `linking/groupInviteLink.test.ts`.
- **C4** — `components/GroupInviteLinkPanel.tsx`, used by `AddMembersModal` and (new) the
  `GroupInfoModal` members tab. Renders an explanatory empty state when there is no
  `inviteId` rather than a link that silently fails.
- **C5** — `screens/settings/BlockedUsersScreen.tsx`, routed as `BlockedUsers` and reachable
  from Settings → Privacy. Hydrates ids via `fetchUserProfile`; a profile that fails to load
  still gets a row, or the user loses the ability to unblock that person.
- **C6** — `hooks/useChatImageAttach.ts`, wired into all three composers. Returns
  `undefined` when disabled so the composer's attach button visibility comes for free.
- **C7** — `AI_QUERY_PATTERN` / `parseAiQuery` / `formatAiTutorReply` moved into
  `packages/shared/src/utils/aiChatQuery.ts` (with tests) and both web's `MessageInputBar`
  and mobile now use them. New `hooks/useAiTutorSend.ts` returns
  `'not-a-query' | 'answered' | 'failed'` — composer state stays with the caller because it
  varies (voice-note sends pass override text and must not clear the box), and getting it
  wrong loses the user's question. `ChatThreadModal` now takes `mentionCandidates` and runs
  the tutor.

## Remaining

**D1–D7** error/empty-state primitives, `listError` in the store, then accessibility.

## Traps

- **Do not reinstate `inviteByEmail`** (deleted in C0). No email match fell through to
  `(results as any[])[0]` and called `addGroupMember` — and `/users/search` matches
  usernames only, so the match essentially never succeeded. It would add an arbitrary
  stranger to a private group.
- **Do not reinstate `approvePendingMember`/`rejectPendingMember`** (deleted in C0). They
  had no server concept: `pending` means "invitee hasn't accepted", `getGroupMembers`
  filters those rows out, and no endpoint returns `pending_members`. Any approval UI is
  permanently empty. Web's equivalent section is vestigial for the same reason.
- **Typecheck baseline is 55 pre-existing errors.** The change is clean only if it stays at
  55, never zero.
- **No component test harness exists in `apps/mobile`.** Add unit tests only for new pure
  helpers; do not invent a harness.
- **Mobile ships via EAS only.** `npx eas-cli login` then
  `build --platform android --profile preview`. Claude cannot run this — it needs the
  user's Expo credentials. Dev clients show everything; a real phone shows none of it.

## Verification debt (important)

Everything above is **typechecked only** — mobile stays at the 55-error baseline and the
jest suite is unchanged (1 pre-existing `marketplaceFilters` failure). Phase A/B1/B2 were
boot-verified when they shipped. **B3/B4/B5 have not run on a device at all:** the iOS dev
client was serving a cached bundle, and the `simctl uninstall` that finally busted it signed
the simulator out, so the chat screens became unreachable. Re-verify from a signed-in dev
client before trusting any of it. None of the plan's device scenarios have been run:

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
