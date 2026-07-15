import 'react-native-gesture-handler';
import type { ComponentType } from 'react';
import { registerRootComponent } from 'expo';
import App from './App';
import { initSentry, Sentry } from './src/services/sentry';

let Root: ComponentType<any> = App;

try {
  initSentry();
  // Only wrap when Sentry initialized successfully; never block boot if native Sentry fails.
  Root = Sentry.wrap(App);
} catch (error) {
  console.warn('[sentry] init/wrap failed; continuing without Sentry:', error);
  Root = App;
}

registerRootComponent(Root);
