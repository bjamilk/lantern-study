import { useCallback } from 'react';
import { appAlert } from '../components/ui/appDialog';
import { useNotificationSubscription } from './useRealtimeSubscriptions';
import { useAuthStore } from '../stores/authStore';
import { buildCurrentGameUser } from '../utils/currentGameUser';
import { useGameStore } from '../stores/gameStore';
import {
  navigateToChallengesInbox,
  navigateToGameResult,
  navigateToGameScreen,
} from '../navigation/navigationRef';

function parseChallengeNotification(raw: Record<string, unknown>): {
  type?: string;
  challengeId?: string;
  message?: string;
} {
  const data = (raw.data ?? raw) as Record<string, unknown>;
  const nested = data.data as Record<string, unknown> | undefined;
  return {
    type: (raw.type as string) || (data.type as string),
    challengeId:
      (nested?.challengeId as string) ||
      (data.challengeId as string) ||
      (typeof raw.link === 'string' ? raw.link.replace('challenge:', '') : undefined),
    message: (raw.message as string) || (raw.body as string) || (raw.title as string),
  };
}

export function useChallengeNotificationHandler() {
  const { user, profileName } = useAuthStore();
  const { startChallengePlay } = useGameStore();

  const handleNotification = useCallback(
    (notification: Record<string, unknown>) => {
      const { type, challengeId, message } = parseChallengeNotification(notification);
      if (!type?.startsWith('challenge') || !challengeId || !user?.id) return;

      const currentUser = buildCurrentGameUser(user, profileName);

      if (type === 'challenge_result') {
        void startChallengePlay(challengeId, currentUser)
          .then(session => {
            navigateToGameResult(session, currentUser);
          })
          .catch(() => navigateToChallengesInbox());
        return;
      }

      if (type === 'challenge_accepted') {
        appAlert(
          'Duel accepted!',
          message || 'Your opponent accepted the duel. Start playing now?',
          [
            { text: 'Later', style: 'cancel', onPress: () => navigateToChallengesInbox() },
            {
              text: 'Play Now',
              onPress: () => {
                void startChallengePlay(challengeId, currentUser)
                  .then(session => {
                    if (session.isComplete || session.awaitingOpponent) {
                      navigateToGameResult(session, currentUser);
                    } else {
                      navigateToGameScreen();
                    }
                  })
                  .catch(() => navigateToChallengesInbox());
              },
            },
          ]
        );
        return;
      }

      navigateToChallengesInbox();
    },
    [user, profileName, startChallengePlay]
  );

  useNotificationSubscription(handleNotification as never);
}
