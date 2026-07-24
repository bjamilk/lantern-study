import { useEffect, useRef } from 'react';
import * as Linking from 'expo-linking';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CommonActions } from '@react-navigation/native';
import { isAllowedMobileDeepLink } from '../utils/deepLinkAllowlist';
import { parseDeepLink } from '@lantern/shared';
import { joinGroupByInvite } from '../services/api';
import { navigationRef } from '../navigation/navigationRef';
import { useAuthStore } from '../stores/authStore';

const PENDING_NOTE_SHARE_TOKEN_KEY = '@lantern_pending_note_share_token';

function navigateWhenReady(action: Parameters<typeof CommonActions.navigate>[0]) {
  const run = () => {
    if (navigationRef.isReady()) {
      navigationRef.dispatch(CommonActions.navigate(action));
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
  navigateWhenReady({
    name: 'Main',
    params: {
      screen: 'StudyTab',
      params: { screen: 'NoteShareAccept', params: { token } },
    },
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

  try {
    const normalized = url.replace('lanternstudy:/', 'https://lanternstudy.app/');
    const urlObj = new URL(normalized.startsWith('http') ? normalized : `https://lanternstudy.app/${normalized}`);
    const inviteId = urlObj.searchParams.get('inviteId');
    if (inviteId) {
      const group = await joinGroupByInvite(inviteId, userId);
      const groupId = (group as { id?: string })?.id;
      if (groupId) {
        navigateWhenReady({
          name: 'Main',
          params: {
            screen: 'ChatTab',
            params: { screen: 'GroupChat', params: { groupId } },
          },
        });
      }
      return;
    }
  } catch {
    // Fall through to path-based links.
  }

  if (!parsed) return;
  switch (parsed.type) {
    case 'deck':
      navigateWhenReady({
        name: 'Main',
        params: { screen: 'StudyTab', params: { screen: 'DeckDetail', params: { deckId: parsed.id } } },
      });
      break;
    case 'group':
      navigateWhenReady({
        name: 'Main',
        params: { screen: 'ChatTab', params: { screen: 'GroupChat', params: { groupId: parsed.id } } },
      });
      break;
    case 'listing':
      navigateWhenReady({
        name: 'Main',
        params: { screen: 'MarketTab', params: { screen: 'ListingDetail', params: { listingId: parsed.id } } },
      });
      break;
    default:
      break;
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
    return () => sub.remove();
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
