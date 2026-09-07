/**
 * Expo Go build: push notifications are unavailable (SDK 53+).
 * Metro resolves this file when bundling for Expo Go via the .expo.ts extension.
 */

import { Platform } from 'react-native';
import type {
  PushAppIdentity,
  PushPermissionState,
  PushReadiness,
  PushRegisterOutcome,
  PushServerStatus,
} from '../utils/pushDiagnostics';

export function isPushNotificationsSupported(): boolean {
  return false;
}

export async function registerForPushNotifications(): Promise<string | null> {
  return null;
}

export async function uploadPushToken(_expoPushToken: string): Promise<void> {
  // no-op in Expo Go
}

export interface NotificationPayload {
  url?: string;
  jobId?: string;
  kind?: string;
  pending?: boolean;
}

export function addNotificationResponseListener(
  _handler: (payload: NotificationPayload) => void
): () => void {
  return () => {};
}

export function addNotificationReceivedListener(
  _handler: (payload: NotificationPayload) => void
): () => void {
  return () => {};
}

/** Expo Go delivers nothing, and says so rather than promising. */
export async function areJobNotificationsReady(): Promise<boolean> {
  return false;
}

/** Not "we could not check": Expo Go genuinely cannot receive a push. */
export async function jobNotificationsReadiness(): Promise<PushReadiness> {
  return 'off';
}

export async function fetchPushTokenRegistered(): Promise<boolean | null> {
  return null;
}

export async function fetchPushTokenStatus(): Promise<PushServerStatus | null> {
  return null;
}

export async function getPushPermissionState(): Promise<PushPermissionState> {
  return 'unavailable';
}

export function getCachedPushToken(): string | null {
  return null;
}

export function getLastPushRegisterError(): string | null {
  return 'Expo Go cannot receive push notifications — install the full app.';
}

/** The identity is still true here; only delivery is missing. */
export function getPushAppIdentity(): PushAppIdentity {
  return {
    platform: Platform.OS,
    applicationId: null,
    projectId: null,
    appVariant: 'expo-go',
    deviceTokenType: null,
  };
}

export async function uploadPushTokenChecked(_expoPushToken: string): Promise<void> {
  // no-op in Expo Go
}

export function clearPushToken(): Promise<void> {
  return Promise.resolve();
}

export async function reRegisterPushToken(): Promise<PushRegisterOutcome> {
  return {
    token: null,
    uploaded: false,
    error: 'Push notifications need the full app — Expo Go cannot receive them.',
  };
}

export async function enableJobNotifications(): Promise<boolean> {
  return false;
}
