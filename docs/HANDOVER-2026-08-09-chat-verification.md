# Handover — mobile chat phases A–D: shipped, deployed, device-verified

Written Aug 9 2026. Everything below is **on `main` and pushed** (`origin/main` level, 0/0).
Phase-by-phase design detail lives in [`HANDOVER-chat-phases.md`](./HANDOVER-chat-phases.md);
this file is the state of play and the environment you need to reproduce it.

## Where the work stands

The four-phase chat plan (`~/.claude/plans/looking-at-the-chat-gentle-ritchie.md`) is
**complete**. A/B/C/D are all implemented, and most of it has now been exercised on a real
device rather than only typechecked.

| Commit | What |
|---|---|
| `c3b50ce` | B3/B4/B5 + all of Phase C |
| `e693f47` | all of Phase D |
| `1d11ae0` | **bug** found on device: offline DM rendered an empty state over a load failure |
| `40b3a04` | **bug**: `GroupInfoModal` showed the previously-opened group's name |
| `330f7a7` | `@expo/plist` patch — unbreaks `expo prebuild` and `expo run:ios` |
| `6c1ff90` | iOS native build: fmt C++17 plugin + slider Fabric exclusion |
| `e8179a3` | **bug**: group name showed as "Group" after joining by invite |
| `3a7226d` `926c8bb` `f8ae39f` `1dc1781` `4c07d29` | verification records in the phase handover |

Earlier phases (`83f88c1` Phase A, `203c8c4` A6, `f30005b` B1/B2) were already on main.

## Verified on device

| Check | Result |
|---|---|
| B3/B4 render counts | ✅ 30 bubble renders on open, **still 30 after 10 keystrokes** |
| B5 windowing | ⚠️ partial — `removeClippedSubviews` verified not to blank cells over 30 messages. Rows dropping out of the window needs ~100+ (`windowSize: 11` is eleven *screenfuls*) |
| C1 invites inbox | ✅ UI only, via a temporary stub — this account has no real pending invites. Decline hit the real API and correctly kept the row on failure |
| C2/C3/C4 invite chain | ✅ **full round trip**: link carries `invite-…` not the group UUID → second account opened it → joined → header went 1 → 2 members, confirmed from both devices |
| C5 blocked users | ✅ routes from Settings → Privacy, loads, empty state |
| C6 image attach | ✅ button now renders in the DM composer **and** in threads |
| C7 `@AI` in a thread | ✅ "AI Tutor is thinking…" then the answer posted, threaded on the root |
| D1/D2/D3 | ✅ "Loading conversation"; airplane mode → "Couldn't refresh your chats" banner over cached list |
| D4 ErrorState | ✅ after `1d11ae0` |
| D7 accessibility | ✅ measured from the `uiautomator` tree: GroupChatScreen 20/20 clickable nodes labelled, GroupInfoModal 8/8 (was 14 pressables / 0 labels) |

**Not verified:** a VoiceOver/TalkBack pass by ear, and B5 at a list length where windowing
actually engages.

## Deployment

- **Web** → Cloudflare Pages, **deployed** Aug 8. `wrangler` is authenticated on this Mac
  with `pages (write)`, so `npx wrangler pages deploy dist --project-name lantern-study
  --branch main` works directly — the PowerShell script in `scripts/` is not needed (and
  `pwsh` is not installed). Check what is live with
  `curl -s https://lanternstudy.com/sw.js | grep -oE 'lantern-[a-z0-9]+-[a-z0-9]+'`.
- **API** → Render, auto-deploys on push to `main`. Healthy.
- **Mobile** → **not shipped.** EAS only, needs your Expo credentials:
  `npx eas-cli login` then `build --platform android --profile preview`. Essentially all of
  this work is mobile, so none of it is in users' hands yet.

CI is red only on `security-audit` (`npm audit` high/critical), which is pre-existing —
identical on the last commit before this work. The other three jobs are green.

## Dev environment — read this before touching the simulators

These cost hours this session. All of them are traps that look like app bugs.

### Two Metro instances are required

The rebuilt iOS dev client has **no `EXDevLauncher`**, so the
`lanternstudy://expo-development-client/?url=…` deep link does nothing there and it falls
back to React Native's default packager port. Android's dev client pins whatever URL it was
last given. So:

| Platform | Metro | Launch |
|---|---|---|
| iOS | **8081** | `xcrun simctl launch <udid> com.lanternstudy.app.dev` |
| Android | **8082** | `adb reverse tcp:8082 tcp:8082` then `am start -a android.intent.action.VIEW -d "lanternstudy://expo-development-client/?url=http://127.0.0.1:8082"` |

Start each with `npx expo start --dev-client --port <port>` from `apps/mobile` on **Node 20**.

### Never trust a booting app as proof your code is running

`~/LanternStudyDev.app` (the old prebuilt client) contains an **embedded `main.jsbundle`
from Aug 1** and never contacts Metro. Every iOS screenshot taken with it is Aug 1 code
whatever your diff says, and `simctl uninstall` does not help because reinstalling restores
the same bundle. **Always confirm a fresh `iOS Bundled` / `Android Bundled` line appears in
the Metro log *after* your launch.** Use the freshly built Debug app, not `~/LanternStudyDev.app`.

### Building iOS

`expo run:ios` **cannot be used on this machine** — `devicectl` misreports under Xcode 26,
so Expo classifies the booted simulator as a physical device and demands signing certs.
Build directly from `apps/mobile/ios`:

```
xcodebuild -workspace LanternStudyDev.xcworkspace -scheme LanternStudyDev \
  -configuration Debug -sdk iphonesimulator \
  -destination "platform=iOS Simulator,id=<udid>" -derivedDataPath <dir> build
```

**Do not add `CODE_SIGNING_ALLOWED=NO`.** It leaves the app unsigned, which breaks Keychain
access, which breaks `expo-secure-store`, which means Supabase can never persist a session
— sign-in silently never sticks. The symptom is a stream of
`WARN [secureStorage] getItemAsync(sb-…-auth-token) failed` in the Metro log.

Two patches in `patches/` keep this working (`postinstall` applies them):
`@expo+plist` (xmldom 0.9 compat — without it `expo prebuild` and `run:ios` both die) and
`@react-native-community+slider` (excludes a Fabric-only file this Legacy-Architecture app
must not compile). `apps/mobile/plugins/withFmtCxx17.js` builds the `fmt` pod as C++17,
without which it will not compile under this Xcode.

### Android emulator DNS

If everything fails as "Network request failed" and logcat shows `Unable to resolve host`,
the emulator's DNS has gone stale. `-dns-server` alone does **not** fix it — the snapshot
restores the broken state. Cold boot:

```
emulator -avd Pixel_8 -no-snapshot-load -dns-server 8.8.8.8,8.8.4.4
```

Kill the old instance first and delete
`~/.android/avd/Pixel_8.avd/{hardware-qemu.ini.lock,multiinstance.lock}`, or the new one
refuses to start. DNS takes ~15s after `sys.boot_completed` — testing immediately gives a
false negative.

To test offline behaviour, launch **online**, let the bundle load, *then*
`adb shell cmd connectivity airplane-mode enable`. Airplane mode also blocks the bundle
fetch, and Fast Refresh will not reach the app while offline.

### Driving the UI

Drive it one step at a time and screenshot between steps. Chained blind taps signed the
Android account out once in this session by hitting Log out. On iOS, `keyevent 111` (ESC)
closes the whole modal rather than just the keyboard.

## Outstanding

1. **Test data to delete.** `zz-verify-temp` is a real group on the primary account: ~30
   junk messages, one AI-tutor reply, and the second account as a member. I stopped short
   of deleting it (⋮ → About group → Danger → Delete Permanently is yours to press).
2. **`DmBubble` never got the WhatsApp restyle** — still `colors.primary` for the own
   bubble where `MessageBubble` uses `chatBubbleOwn`, so DMs and groups look like different
   apps. Longest-standing loose end, predates this work.
3. **Mobile EAS build** — nothing is in users' hands until you run it.
4. **B5 at scale** and a real screen-reader pass, per the table above.
5. `security-audit` in CI, if you ever want it green — needs expo 57 / react-router 7 /
   vitest 4, i.e. a planned upgrade project, not a passing fix.

## Baselines to check against

- `apps/mobile` typecheck: **55 errors**. Match it; never chase zero. Diff the error *set*,
  not the count — `npx tsc --noEmit | grep -E "^src/" | sed 's/([0-9]*,[0-9]*)//' | sort`
  against a stashed baseline.
- `apps/web` 0, `apps/api-server` 0, `packages/shared` 10 (all pre-existing test files).
- Tests: shared 413 pass, web 24 pass, mobile has **one pre-existing failure**
  (`marketplaceFilters`).
