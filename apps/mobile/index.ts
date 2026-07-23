import './src/theme/installFontScale';
import { registerRootComponent } from 'expo';
import App from './App';
import { initSentry, Sentry } from './src/services/sentry';

initSentry();

registerRootComponent(Sentry.wrap(App));
