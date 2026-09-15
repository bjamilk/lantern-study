/**
 * The app's imperative deep-link and notification router.
 *
 * Mounted once by RootNavigator. Handles three sources with one code path
 * (`handleIncomingUrl`): the cold-start URL, the `url` event while running, and
 * a tapped notification whose payload carries `data.url` (or a bare `jobId`).
 * Everything is filtered through `isAllowedMobileDeepLink` first, and the two
 * link types that change something — an auth link that would set a session, an
 * invite that would join a group — go through `utils/deepLinkAllowlist`'s plan
 * functions and an explicit `confirmAsync` before anything happens. An incoming
 * URL is untrusted input: any installed app can send one.
 *
 * Main export: `useDeepLinkHandler()`. No return value; it wires listeners.
 *
 * Touches:
 * - expo-linking (`getInitialURL`, the `url` event)
 * - AsyncStorage: `@lantern_pending_note_share_token`, the one link that is
 *   parked rather than dropped when nobody is signed in
 * - services/pushNotifications (received + response listeners)
 * - services/api `joinGroupByInvite` — the one network call made here
 * - stores: authStore (the signed-in user), jobsStore (`onJobPush`,
 *   `resolveJobLink`), uiStore (unfolding the dashboard's daily-quiz panel)
 * - navigationRef / CommonActions for the dispatch itself
 *
 * Gotchas:
 * - Where a link LANDS is not decided here. `navigation/deepLinkTargets.ts`
 *   holds that table (shared with the linking config, so a link cannot mean one
 *   thing on a cold start and another on a tap) and
 *   `navigation/deepLinkPrepare.ts` does the I/O a target needs first. Only the
 *   cases this file handles inline — note shares, invites, jobs, profile, the
 *   daily quiz — are decided here, and each returns early.
 * - The navigator may not exist yet when a cold link arrives, hence the polling
 *   in `navigateWhenReady`; it gives up after 8 s and the link is lost.
 * - Every effect is keyed on `user?.id` alone, so it re-subscribes on sign-in
 *   and on account switch.
 */
import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommonActions } from '@react-navigation/native';
import {
  isAllowedMobileDeepLink,
  inviteIdFromUrl,
  planAuthDeepLink,
  planInviteDeepLink,
} from '../utils/deepLinkAllowlist';
import { parseDeepLink } from '@lantern/shared';
import { confirmAsync } from '../components/ui/appDialog';
import { useToastStore } from '../stores/toastStore';
import { joinGroupByInvite } from '../services/api';
import {
  addNotificationReceivedListener,
  addNotificationResponseListener,
  type NotificationPayload,
} from '../services/pushNotifications';
import { navigationRef } from '../navigation/navigationRef';
import { useAuthStore } from '../stores/authStore';
import { useJobsStore } from '../stores/jobsStore';
import { useUIStore } from '../stores/uiStore';
import { prepareDeepLinkTarget } from '../navigation/deepLinkPrepare';

import { toTab } from '../navigation/nestedTab';

const PENDING_NOTE_SHARE_TOKEN_KEY = '@lantern_pending_note_share_token';

/** The dashboard panel the daily quiz lives in (CollapsibleSection id). */
const DAILY_QUIZ_SECTION_ID = 'dailyQuiz';

/**
 * `navigate(name, params)` — the string form.
 *
 * The object form (`navigate({ name, params })`) is deprecated and warns on
 * every dispatch ("Passing an object as the argument to 'navigate' is
 * deprecated" filled the device log at each notification tap). Nested targets
 * still carry `initial: false` through `toTab`, so a tab's own root is placed
 * beneath the screen being opened.
 */
function navigateWhenReady(name: string, params?: object) {
  const run = () => {
    if (navigationRef.isReady()) {
      navigationRef.dispatch(CommonActions.navigate(name, params));
      return true;
    }
    return false;
  };
  if (run()) return;
  const interval = setInterval(() => {
    if (run()) clearInterval(interval);
  }, 200);
  setTimeout(() => clearInterval(interval), 8000);
}

/**
 * gotrue's own `error_code` is a machine string ("otp_expired"). Show the
 * student what it means; never drop it on the floor, which is how an expired
 * link became "nothing happened".
 */
function authLinkErrorMessage(code: string): string {
  const normalized = code.toLowerCase();
  if (normalized.includes('expired')) return 'That link has expired. Ask for a new one.';
  if (normalized.includes('used')) return 'That link has already been used. Ask for a new one.';
  return `That sign-in link could not be used (${code}).`;
}

function navigateToNoteShare(token: string) {
  navigateWhenReady('Main', {
    screen: 'StudyTab',
    params: toTab('NoteShareAccept', { token }),
  });
}

/**
 * Route one incoming URL. The order of the branches below is the contract.
 *
 * 1. Allowlist, then parse. An unrecognised or disallowed URL is dropped.
 * 2. Note shares are handled BEFORE the signed-in check, because they are the
 *    only link worth parking: the token is stashed and replayed by the second
 *    effect once a user exists.
 * 3. Everything after that requires a user and returns early otherwise.
 * 4. The inline cases (invite, jobs, profile, quiz) each return; only what
 *    falls through reaches the shared table via `prepareDeepLinkTarget`.
 *
 * Recursive for exactly one case: a `jobs/<id>` link the store can resolve to a
 * real artefact is re-entered as that artefact's URL.
 */
async function handleIncomingUrl(url: string, userId?: string, userEmail?: string | null) {
  if (!isAllowedMobileDeepLink(url)) return;

  // FIXED (F45): an auth link is handled BEFORE anything else, and never acts
  // on its own. A link carrying a session is attacker-controlled input — any
  // installed app can send `lanternstudy://reset-password#access_token=…` — so
  // while somebody else is signed in on this handset it is refused outright and
  // the student is offered a sign-out instead of being switched silently.
  const authPlan = planAuthDeepLink(url, { userId, email: userEmail });
  if (authPlan.action === 'show-error') {
    useToastStore.getState().showToast(authLinkErrorMessage(authPlan.errorCode), 'error');
    return;
  }
  if (authPlan.action === 'already-signed-in') {
    useToastStore.getState().showToast("You're already signed in on this device.", 'info');
    return;
  }
  if (authPlan.action === 'confirm-sign-out-first') {
    const who = authPlan.email ? `as ${authPlan.email}` : 'for a different account';
    const confirmed = await confirmAsync(
      `Sign out ${authPlan.currentEmail ? `of ${authPlan.currentEmail}` : 'of this account'}?`,
      `This link signs in ${who}. Sign out first, then open the link again to use it.`,
      { confirmLabel: 'Sign out', destructive: true }
    );
    if (confirmed) {
      try {
        await useAuthStore.getState().signOut({ reason: 'user' });
        useToastStore.getState().showToast('Signed out. Open the link again to continue.', 'info');
      } catch {
        useToastStore.getState().showToast('Could not sign out. Try again from Settings.', 'error');
      }
    }
    return;
  }
  if (authPlan.action === 'confirm-sign-in') {
    // Signed out: the auth screens own this flow (they hold the reset form and
    // the OTP field and ask their own "Sign in as <email>?"). Nothing to do
    // here beyond not consuming the link.
    return;
  }

  const parsed = parseDeepLink(url);

  if (parsed?.type === 'note_share') {
    if (!userId) {
      await AsyncStorage.setItem(PENDING_NOTE_SHARE_TOKEN_KEY, parsed.id);
      return;
    }
    await AsyncStorage.removeItem(PENDING_NOTE_SHARE_TOKEN_KEY);
    navigateToNoteShare(parsed.id);
    return;
  }

  if (!userId) return;

  // Invite tokens arrive two ways: as `?inviteId=` (older links) and as the
  // `/invite/<token>` path that the app's own share sheet produces. Only the
  // query form was handled, so every link the app itself generated was a
  // no-op for the recipient.
  const inviteId: string | null =
    parsed?.type === 'invite' ? parsed.id : inviteIdFromUrl(url);

  // Redeem the invite, then open the group it named. The join is the only
  // side effect this file performs; every other branch only navigates.
  // FIXED (F45): it now takes a yes first. Joining is a membership change other
  // people see — the group's members get the student's name, avatar and
  // academic profile — and a BROWSABLE custom-scheme link meant any web page
  // could fire `lanternstudy://?inviteId=…` and enrol a signed-in student in an
  // attacker's group with nothing shown on screen. A failure is surfaced too,
  // instead of being swallowed into "the link did nothing".
  const invitePlan = planInviteDeepLink(url, inviteId, userId);
  if (invitePlan.action === 'confirm-join') {
    const confirmed = await confirmAsync(
      'Join this study group?',
      'You opened a group invite. Members of the group will see your name, photo and course details.',
      { confirmLabel: 'Join group' }
    );
    if (!confirmed) return;
    try {
      const group = await joinGroupByInvite(invitePlan.inviteId, userId);
      const groupId = (group as { id?: string })?.id;
      if (groupId) {
        navigateWhenReady('Main', {
          screen: 'ChatTab',
          params: { screen: 'GroupChat', params: { groupId }, initial: false },
        });
      }
    } catch (err) {
      useToastStore
        .getState()
        .showToast(
          err instanceof Error && err.message
            ? `Could not join the group: ${err.message}`
            : 'Could not join the group. The invite may have expired.',
          'error'
        );
    }
    return;
  }

  if (!parsed) return;

  // Wave G: `lanternstudy://jobs/<jobId>` — a generation whose artefact the
  // sender could not name (a push that beat this device to the news, or an
  // older server's bare "completed"). The store resolves it to the real
  // artefact when it knows one, and to the job's own card on Home when it
  // does not; either answer is true, and neither is "the app reopened
  // wherever it happened to be", which is what an empty payload did.
  if ((parsed.type as string) === 'jobs' && parsed.id) {
    const resolved = await useJobsStore.getState().resolveJobLink(parsed.id);
    if (resolved && resolved !== url) {
      await handleIncomingUrl(resolved, userId, userEmail);
      return;
    }
    navigateWhenReady('Main', { screen: 'HomeTab' });
    return;
  }

  // EditProfile is a ROOT screen, not one of Main's tabs, so it is the one
  // target the shared table cannot be dispatched into Main.
  if (parsed.type === 'profile') {
    navigateWhenReady('EditProfile');
    return;
  }

  if ((parsed.type as string) === 'quiz') {
    // The daily quiz is answered in place on the dashboard, inside a panel the
    // student may have folded away. Opening it means opening that panel.
    const ui = useUIStore.getState();
    if (ui.collapsedDashboardSections[DAILY_QUIZ_SECTION_ID]) {
      ui.toggleDashboardSection(DAILY_QUIZ_SECTION_ID);
    }
  }

  // Wave G: a finished generation's notification links to its artefact
  // (components/jobs/jobSheetModel.ts jobResultLink). Deck, note, test and
  // quiz targets are all resolved by one table — navigation/linking.ts's
  // `resolveDeepLinkNavigation`, which the linking config and this handler now
  // share, so a link cannot mean one thing on a cold start and another on a
  // notification tap. `prepareDeepLinkTarget` wraps that table with the I/O a
  // target needs first — a test is started before TestTaking is shown, since
  // that screen renders from `activeTest` and never starts one itself.
  const target = await prepareDeepLinkTarget(url);
  if (target) {
    navigateWhenReady(
      'Main',
      target.params ? { screen: target.screen, params: target.params } : { screen: target.screen }
    );
  }
}

export function useDeepLinkHandler() {
  const user = useAuthStore((state) => state.user);
  const handledInitial = useRef(false);

  /**
   * The three inbound sources, subscribed together.
   *
   * `handledInitial` is a ref, not state: this effect re-runs on every
   * `user?.id` change (sign-in, account switch) and the cold-start URL must be
   * consumed exactly once for the process, not once per identity — replaying it
   * on sign-in would re-open a launch link over whatever the student is doing.
   * The listeners themselves are torn down and re-created each run so they
   * close over the current user id rather than a stale one.
   */
  useEffect(() => {
    if (!handledInitial.current) {
      handledInitial.current = true;
      void Linking.getInitialURL().then((url) => {
        if (url) void handleIncomingUrl(url, user?.id, user?.email);
      });
    }

    const sub = Linking.addEventListener('url', ({ url }) => {
      void handleIncomingUrl(url, user?.id, user?.email);
    });

    // Tapping a notification never went anywhere: the listener existed but
    // nothing subscribed to it. A completion notification — local OR a push
    // the server sent while the app was in the background — carries the
    // artefact's deep link in `data.url`, so it is routed through exactly the
    // same allowlist and navigation path as a link opened from outside.
    const unsubscribeNotifications = addNotificationResponseListener(
      (payload: NotificationPayload) => {
        // A push about a job the store knows is also NEWS: the JS poller does
        // not run in the background, so this may be the first this device
        // hears that the work finished.
        if (payload.jobId) void useJobsStore.getState().onJobPush(payload.jobId);
        const url = payload.url || (payload.jobId ? `lanternstudy://jobs/${payload.jobId}` : null);
        if (url) void handleIncomingUrl(url, user?.id, user?.email);
      }
    );

    // A push that ARRIVES (rather than one that is tapped) still counts as the
    // student having been told: the store records it so the local notification
    // for the same job is not posted on top of it.
    const unsubscribeReceived = addNotificationReceivedListener((payload) => {
      if (payload.jobId) void useJobsStore.getState().onJobPush(payload.jobId);
    });

    return () => {
      sub.remove();
      unsubscribeNotifications();
      unsubscribeReceived();
    };
  }, [user?.id]);

  /**
   * Replay the one parked link. A note share that arrived signed-out was
   * stashed by `handleIncomingUrl`; this fires on the next id and clears the
   * key BEFORE navigating, so a second sign-in cannot open it again.
   */
  useEffect(() => {
    if (!user?.id) return;
    void AsyncStorage.getItem(PENDING_NOTE_SHARE_TOKEN_KEY).then(async (token) => {
      if (!token) return;
      await AsyncStorage.removeItem(PENDING_NOTE_SHARE_TOKEN_KEY);
      navigateToNoteShare(token);
    });
  }, [user?.id]);
}
