# Handover: Real Group Member-vs-Member Duels

**Date:** 2026-06-12  
**Status:** Implemented in code; local DB migration applied; end-to-end flow ready for smoke testing.

---

## Summary

Replaced the fake “Challenge to a Duel” flow (real questions, simulated opponent via `Math.random()` / `setTimeout`) with **async member-vs-member challenges**:

1. Challenger sends invite → opponent gets notification  
2. Opponent accepts or declines  
3. Both play the **same server-frozen question set** on their own schedule  
4. Server scores submissions, picks winner, updates stats/badges, notifies both  

**Solo practice** remains as an honest alternative: same questions, no opponent, no win recorded.

---

## Architecture

```
Challenger → POST /api/v1/challenges
          → group_challenges (pending) + frozen question_ids
          → notification (challenge_invite) → Opponent

Opponent → POST /challenges/:id/accept|decline

Each player → GET /challenges/:id (questions when accepted)
            → POST /challenges/:id/submit (server recomputes score)

Both finished → winner_id, gamesWon++, DUELIST badge check, challenge_result notifications
```

**Winner rules:** higher score → lower total time → earliest `finished_at`.  
**Expiry:** 24 hours while `pending`.

---

## What was built

### Database
| Item | Path |
|------|------|
| Migration | `supabase/migrations/20260612120000_group_challenges.sql` |
| Tables | `group_challenges`, `challenge_participants` |
| Notifications | `notifications.type`, `notifications.data` columns |

### API (`apps/api-server`)
| Item | Path |
|------|------|
| Routes | `src/routes/challenges.ts` → mounted at `/api/v1/challenges` in `src/server.ts` |
| Service | `src/services/challengeService.ts` |
| Scoring | `src/utils/challengeScoring.ts` (local copy; avoids `@lantern/shared` subpath resolution issues in api-server tsconfig) |
| Types | `src/types/challenges.ts` |
| Validators | `validateCreateChallenge`, `validateSubmitChallenge`, `validateChallengeId` in `middleware/validation.ts` |
| Notifications | `createNotification` in `services/supabase.ts` persists `type` + `data` |

**Endpoints:**
- `POST /` — create challenge  
- `GET /` — list my challenges (`?status=` optional)  
- `GET /:id` — challenge detail + questions (when accepted)  
- `POST /:id/accept` · `POST /:id/decline` · `POST /:id/submit`

### Shared package
- Types: `GroupChallenge`, `ChallengeStatus`, `ChallengeParticipant`; extended `GameSession`, `AppNotification`  
- Helpers: `isQuestionTestable`, `scoreDuelAnswers`, etc. in `packages/shared/src/utils/testHelpers.ts`  
- API client helpers in `packages/shared/src/api/endpoints.ts`

### Web
| Item | Path |
|------|------|
| API client | `services/challenges.ts` |
| Game flow | `hooks/useGameHandlers.ts` (simulation removed) |
| Challenge config | `components/TestConfigModal.tsx` — “Send Challenge” + “Solo Practice” |
| Inbox | `components/ChallengesInboxModal.tsx` |
| Notifications | `components/NotificationModal.tsx` — `challenge:` deep-links |
| Realtime | `hooks/useAppEffects.ts` — includes `type`/`data`; opens challenges inbox on challenge notifications |

### Mobile
| Item | Path |
|------|------|
| Store | `apps/mobile/src/stores/gameStore.ts` (no fake opponent) |
| Service | `apps/mobile/src/services/challenges.ts` |
| Inbox | `apps/mobile/src/screens/games/ChallengesInboxScreen.tsx` |
| UI | `ChallengeModal.tsx`, `GameScreen.tsx` (field-name fix), `GameResultScreen.tsx` |
| Notifications | `NotificationsScreen.tsx` — tap routes to inbox; realtime types in `useRealtimeSubscriptions.ts` |

---

## Local dev setup

| Service | URL / command |
|---------|----------------|
| Supabase (local) | `http://127.0.0.1:55421` (Kong), DB port `55422` |
| API | `npm run dev:api` → `http://localhost:3001` |
| Web | `npm run dev:web` → `http://localhost:5173` |
| Mobile | `npm run dev:mobile` or Expo with `--offline` if Metro fetch fails |

**Env:** API reads `apps/api-server/.env` (`SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`). Web/mobile use root `.env` / `VITE_*` / `EXPO_PUBLIC_*`.

---

## Database migration (critical)

The migration **must exist** in the target Supabase project or challenge API calls return **500** (`Could not find the table 'public.group_challenges'`).

### Already done (this machine, local Supabase)
Applied via Docker to `supabase_db_lantern-study___111625`:

```powershell
Get-Content "supabase\migrations\20260612120000_group_challenges.sql" |
  docker exec -i supabase_db_lantern-study___111625 psql -U postgres -d postgres
```

### Remote / staging / production
Run the same SQL in **Supabase SQL Editor**, or use Supabase CLI `db push` when available.

Verify after apply:

```javascript
// From apps/api-server with dotenv loaded
const { data, error } = await supabase.from('group_challenges').select('id').limit(1);
// error should be null
```

---

## Issues hit during development

| Symptom | Cause | Fix |
|---------|-------|-----|
| `404` on `/api/v1/challenges` | Stale Node process on port 3001 (pre-challenges code) | Kill PID on 3001; restart `npm run dev:api` |
| `500` on POST challenge | Migration not applied | Apply `20260612120000_group_challenges.sql` |
| api-server typecheck failures | `@lantern/shared/utils` subpaths not resolved under api-server `tsconfig` | Local `challengeScoring.ts` + `types/challenges.ts` |
| Metro start failure | Expo CLI network fetch | `npx expo start --offline` |

**Quick route check:** `GET /api/v1/challenges` without auth should return **401**, not **404**.

---

## Smoke test checklist

Use two accounts in the same group with enough testable questions.

- [ ] A: group member profile → Challenge → configure → **Send Challenge** → success toast / “Challenge sent”  
- [ ] B: notification → **Challenges inbox** → Accept  
- [ ] A & B: play duel (same question count); finish and submit  
- [ ] Both see result notification; winner gets `gamesWon` increment (and DUELIST badge at thresholds)  
- [ ] B: Decline path on a pending invite  
- [ ] Solo practice: runs game, no opponent UI, no win recorded  
- [ ] Mobile: questions render correctly (not blank stems)

---

## Known limitations / follow-ups

1. **DUELIST badge on server** — only DUELIST levels are evaluated in `challengeScoring.checkAndAwardBadges`; full multi-badge server logic still lives on clients for other stats.  
2. **No live/real-time duel mode** — schema supports future live play; current flow is async only.  
3. **Hosted Supabase** — migration applied locally only unless someone ran it on remote.  
4. **API server restart** — required after pulling challenge routes; nodemon does not always replace long-running stale processes.  
5. **E2E tests** — no automated tests added for challenge flow.  
6. **Supabase MCP** — was unavailable during dev; migrations applied via Docker `psql`.

---

## Key files (quick reference)

```
supabase/migrations/20260612120000_group_challenges.sql
apps/api-server/src/routes/challenges.ts
apps/api-server/src/services/challengeService.ts
apps/api-server/src/utils/challengeScoring.ts
services/challenges.ts                          # web client
hooks/useGameHandlers.ts
components/ChallengesInboxModal.tsx
apps/mobile/src/stores/gameStore.ts
apps/mobile/src/services/challenges.ts
apps/mobile/src/screens/games/ChallengesInboxScreen.tsx
packages/shared/src/types/index.ts
```

---

## Removing old behavior

Confirmed removed from codebase:
- `simulateOpponentAnswer` (mobile)
- Client-side opponent `Math.random()` simulation (web)
- Fake instant “Start Battle” without server challenge

If duels feel “instant” or opponent scores appear without a real second player, that indicates old client bundle or old API — hard refresh / restart dev servers.

---

## Contact / context

Plan reference: `.cursor/plans/real_group_duels_baecd146.plan.md` (do not edit plan file).  
Implementation session covered web, mobile, API, shared types, and local migration apply.
