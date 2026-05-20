// ===========================================
// Lantern Study Mobile - Deep Linking Configuration
// ===========================================

import { LinkingOptions } from '@react-navigation/native';
import * as Linking from 'expo-linking';
import { RootStackParamList } from './RootNavigator';

const prefix = Linking.createURL('/');

export const linkingConfig: LinkingOptions<RootStackParamList> = {
  prefixes: [
    prefix,
    'lanternstudy://',
    'https://lanternstudy.app',
  ],
  config: {
    screens: {
      Auth: {
        screens: {
          Login: 'login',
          SignUp: 'signup',
          ForgotPassword: 'forgot-password',
        },
      },
      Main: {
        screens: {
          Dashboard: 'dashboard',
          Flashcards: {
            screens: {
              FlashcardsList: 'flashcards',
              DeckDetail: 'deck/:deckId',
              FlashcardReview: 'flashcard/:flashcardId',
            },
          },
          Profile: 'profile',
        },
      },
    },
  },
  // Handle deep links
  async getInitialURL() {
    // Check if app was opened from a deep link
    const url = await Linking.getInitialURL();
    if (url != null) {
      return url;
    }
    return null;
  },
  // Listen for incoming deep links
  subscribe(listener) {
    const subscription = Linking.addEventListener('url', ({ url }) => {
      listener(url);
    });
    return () => {
      subscription.remove();
    };
  },
};

export default linkingConfig;
