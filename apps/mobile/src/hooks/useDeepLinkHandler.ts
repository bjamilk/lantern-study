import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommonActions } from '@react-navigation/native';
import { isAllowedMobileDeepLink } from '../utils/deepLinkAllowlist';
import { parseDeepLink } from '@lantern/shared';
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

function navigateToNoteShare(token: string) {
  navigateWhenReady('Main', {
    screen: 'StudyTab',
    params: toTab('NoteShareAccept', { token }),
  });
}

async function handleIncomingUrl(url: string, userId?: string) {
  if (!isAllowedMobileDeepLink(url)) return;
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
  let inviteId: string | null = parsed?.type === 'invite' ? parsed.id : null;
  if (!inviteId) {
    try {
      const normalized = url.replace('lanternstudy:/', 'https://lanternstudy.com/');
      const urlObj = new URL(
        normalized.startsWith('http') ? normalized : `https://lanternstudy.com/${normalized}`
      );
      inviteId = urlObj.searchParams.get('inviteId');
    } catch {
      // Fall through to path-based links.
    }
  }

  if (inviteId) {
    try {
      const group = await joinGroupByInvite(inviteId, userId);
      const groupId = (group as { id?: string })?.id;
      if (groupId) {
        navigateWhenReady('Main', {
          screen: 'ChatTab',
          params: { screen: 'GroupChat', params: { groupId }, initial: false },
        });
      }
    } catch {
      // A revoked or already-used invite should not crash the launch path.
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
      await handleIncomingUrl(resolved, userId);
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

  useEffect(() => {
    if (!handledInitial.current) {
      handledInitial.current = true;
      void Linking.getInitialURL().then((url) => {
        if (url) void handleIncomingUrl(url, user?.id);
      });
    }

    const sub = Linking.addEventListener('url', ({ url }) => {
      void handleIncomingUrl(url, user?.id);
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
        if (url) void handleIncomingUrl(url, user?.id);
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

  useEffect(() => {
    if (!user?.id) return;
    void AsyncStorage.getItem(PENDING_NOTE_SHARE_TOKEN_KEY).then(async (token) => {
      if (!token) return;
      await AsyncStorage.removeItem(PENDING_NOTE_SHARE_TOKEN_KEY);
      navigateToNoteShare(token);
    });
  }, [user?.id]);
}
