/**
 * NetInfo shim (Android dev-client only).
 *
 * @react-native-community/netinfo 11.5.2's native module (a legacy `TurboReactPackage`)
 * does not register with React Native 0.81 bridgeless / New Architecture in this Expo
 * dev-client build — `TurboModuleRegistry.getEnforcing('RNCNetInfo')` throws
 * "could not be found in the native binary", crashing the app on boot.
 *
 * Metro routes `@react-native-community/netinfo` here for platform === 'android' only
 * (see metro.config.js); iOS keeps the real module. This shim reports "connected" and
 * lets the network-aware sync code run. Emulators are always online, so behavior is
 * correct there; on a physical device offline transitions won't fire until netinfo's
 * native registration is fixed (or a config-plugin/patch is added).
 */

export type NetInfoStateType =
  | 'unknown'
  | 'none'
  | 'cellular'
  | 'wifi'
  | 'bluetooth'
  | 'ethernet'
  | 'wimax'
  | 'vpn'
  | 'other';

export interface NetInfoState {
  type: NetInfoStateType;
  isConnected: boolean | null;
  isInternetReachable: boolean | null;
  details: unknown;
}

export type NetInfoSubscription = () => void;

const connectedState: NetInfoState = {
  type: 'wifi',
  isConnected: true,
  isInternetReachable: true,
  details: { isConnectionExpensive: false },
};

const listeners = new Set<(state: NetInfoState) => void>();

function fetch(): Promise<NetInfoState> {
  return Promise.resolve(connectedState);
}

function refresh(): Promise<NetInfoState> {
  return Promise.resolve(connectedState);
}

function addEventListener(listener: (state: NetInfoState) => void): NetInfoSubscription {
  listeners.add(listener);
  // Emit the current (connected) state asynchronously, mirroring the real module.
  Promise.resolve().then(() => {
    if (listeners.has(listener)) listener(connectedState);
  });
  return () => {
    listeners.delete(listener);
  };
}

function useNetInfo(): NetInfoState {
  return connectedState;
}

function configure(): void {
  /* no-op */
}

const NetInfo = {
  fetch,
  refresh,
  addEventListener,
  useNetInfo,
  configure,
};

export { addEventListener, fetch, refresh, useNetInfo, configure };
export default NetInfo;
