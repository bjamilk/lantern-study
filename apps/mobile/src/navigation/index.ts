/**
 * Public surface of the navigation module: the root navigator, the route/param
 * types, and the deep-link config plus its routing table.
 *
 * Deliberately narrow. The pure planners (./tabPressBehavior, ./stackNavigate,
 * ./contextualBars, ./segmentParamSync, ./nestedTab, ./legacyTabs) are imported
 * by path from their own callers and their tests, and are not re-exported here.
 */
export { RootNavigator } from './RootNavigator';
export * from './types';
export { linkingConfig, resolveDeepLinkNavigation } from './linking';