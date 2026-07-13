import 'react-native-gesture-handler';
import './src/theme/installFontScale';
import { registerRootComponent } from 'expo';
import App from './App';
import { initSentry, Sentry } from './src/services/sentry';

try {
  initSentry();
} catch (error) {
  console.warn('[sentry] init failed:', error);
}

registerRootComponent(Sentry.wrap(App));
