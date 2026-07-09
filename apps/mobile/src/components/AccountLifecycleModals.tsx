import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  Modal,
  TextInput,
  ScrollView,
  Pressable,
  Alert,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import {
  ACCOUNT_DATA_LOSS_ITEMS,
  ACCOUNT_DELETE_CONFIRM_TEXT,
  ACCOUNT_DELETION_GRACE_DAYS,
  ACCOUNT_EXPORT_COPY,
  isSignedExportV2,
  type AccountLifecycleInfo,
} from '@lantern/shared';
import { Button } from './ui';
import {
  deactivateUserAccount,
  deleteUserAccountImmediate,
  fetchAccountLifecycle,
  importUserAccountBackup,
  reactivateUserAccount,
} from '../services/accountLifecycle';

export function AccountPausedBannerMobile({
  lifecycle,
  onReactivate,
  onExport,
  loading,
}: {
  lifecycle: AccountLifecycleInfo;
  onReactivate: () => void;
  onExport: () => void;
  loading?: boolean;
}) {
  const scheduledLabel = lifecycle.deletionScheduledAt
    ? new Date(lifecycle.deletionScheduledAt).toLocaleDateString(undefined, { dateStyle: 'long' })
    : null;

  return (
    <View className="mx-4 mt-3 mb-1 rounded-xl border border-amber-300 dark:border-amber-700 bg-amber-50 dark:bg-amber-900/20 p-4 gap-3">
      <Text className="text-sm font-semibold text-amber-950 dark:text-amber-100">
        Your account is paused
      </Text>
      <Text className="text-sm text-amber-900/90 dark:text-amber-200/90 leading-relaxed">
        {scheduledLabel
          ? `Permanent deletion is scheduled for ${scheduledLabel}`
          : `Permanent deletion is scheduled in ${ACCOUNT_DELETION_GRACE_DAYS} days`}
        {lifecycle.graceDaysRemaining != null
          ? ` (${lifecycle.graceDaysRemaining} day${lifecycle.graceDaysRemaining === 1 ? '' : 's'} left).`
          : '.'}{' '}
        Reactivate to keep using Lantern Study, or export your data before it is removed.
      </Text>
      <View className="flex-row gap-2">
        <Button size="sm" variant="secondary" onPress={onExport} disabled={loading}>
          Export data
        </Button>
        <Button size="sm" variant="primary" onPress={onReactivate} loading={loading}>
          Reactivate account
        </Button>
      </View>
    </View>
  );
}

interface AccountLifecycleModalsProps {
  userId: string;
  deleteOpen: boolean;
  importOpen: boolean;
  onCloseDelete: () => void;
  onCloseImport: () => void;
  onSignedOut: () => void;
  onExport: () => void;
  onLifecycleChange?: (info: AccountLifecycleInfo) => void;
  renderPausedBanner?: boolean;
}

export function AccountLifecycleModals({
  userId,
  deleteOpen,
  importOpen,
  onCloseDelete,
  onCloseImport,
  onSignedOut,
  onExport,
  onLifecycleChange,
  renderPausedBanner = false,
}: AccountLifecycleModalsProps) {
  const [lifecycle, setLifecycle] = useState<AccountLifecycleInfo | null>(null);
  const [deleteStep, setDeleteStep] = useState<'warn' | 'choose' | 'confirm'>('warn');
  const [deleteChoice, setDeleteChoice] = useState<'pause' | 'immediate'>('pause');
  const [confirmText, setConfirmText] = useState('');
  const [password, setPassword] = useState('');
  const [importPassword, setImportPassword] = useState('');
  const [importDoc, setImportDoc] = useState<Record<string, unknown> | null>(null);
  const [importFileName, setImportFileName] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshLifecycle = useCallback(async () => {
    try {
      const info = await fetchAccountLifecycle(userId);
      setLifecycle(info);
      onLifecycleChange?.(info);
    } catch {
      const active = { status: 'active' as const };
      setLifecycle(active);
      onLifecycleChange?.(active);
    }
  }, [userId, onLifecycleChange]);

  useEffect(() => {
    void refreshLifecycle();
  }, [refreshLifecycle]);

  const resetDeleteModal = () => {
    setDeleteStep('warn');
    setDeleteChoice('pause');
    setConfirmText('');
    setPassword('');
    setError(null);
  };

  const handleCloseDelete = () => {
    onCloseDelete();
    resetDeleteModal();
  };

  const handlePause = async () => {
    setLoading(true);
    setError(null);
    try {
      await deactivateUserAccount(userId);
      await refreshLifecycle();
      handleCloseDelete();
      Alert.alert('Account paused', `Your account will be deleted in ${ACCOUNT_DELETION_GRACE_DAYS} days unless you reactivate.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to pause account.');
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteImmediate = async () => {
    setLoading(true);
    setError(null);
    try {
      await deleteUserAccountImmediate(userId, password);
      handleCloseDelete();
      onSignedOut();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to delete account.');
    } finally {
      setLoading(false);
    }
  };

  const pickImportFile = async () => {
    setError(null);
    const result = await DocumentPicker.getDocumentAsync({
      type: 'application/json',
      copyToCacheDirectory: true,
    });
    if (result.canceled || !result.assets?.[0]) return;

    try {
      const asset = result.assets[0];
      const response = await fetch(asset.uri);
      const text = await response.text();
      const parsed = JSON.parse(text) as Record<string, unknown>;
      const nested = parsed.data;
      const doc =
        nested && typeof nested === 'object' && isSignedExportV2(nested)
          ? (nested as Record<string, unknown>)
          : isSignedExportV2(parsed)
            ? parsed
            : null;

      if (!doc) {
        setError('Choose a valid Lantern Study JSON export from Settings → Export my data.');
        setImportDoc(null);
        setImportFileName(null);
        return;
      }

      setImportDoc(doc);
      setImportFileName(asset.name);
    } catch {
      setError('Could not read backup file.');
      setImportDoc(null);
      setImportFileName(null);
    }
  };

  const handleImport = async () => {
    if (!importDoc || importPassword.length < 8) return;
    setLoading(true);
    setError(null);
    try {
      const result = await importUserAccountBackup(userId, {
        archive: importDoc,
        password: importPassword,
      });
      onCloseImport();
      setImportDoc(null);
      setImportFileName(null);
      setImportPassword('');
      setError(null);
      Alert.alert('Import complete', result.message || 'Your backup was restored.');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Import failed.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Modal visible={deleteOpen} animationType="slide" transparent onRequestClose={handleCloseDelete}>
        <View className="flex-1 justify-end bg-black/50">
          <View className="bg-white dark:bg-slate-900 rounded-t-2xl max-h-[85%]">
            <ScrollView contentContainerClassName="p-5 pb-8">
              <Text className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">
                Delete or pause account
              </Text>
              {deleteStep === 'warn' ? (
                <>
                  <Text className="text-sm text-slate-600 dark:text-slate-400 mb-3">{ACCOUNT_EXPORT_COPY.summary}</Text>
                  <Text className="text-sm font-medium text-slate-800 dark:text-slate-200 mb-2">You will lose:</Text>
                  {ACCOUNT_DATA_LOSS_ITEMS.map((item) => (
                    <Text key={item} className="text-sm text-slate-600 dark:text-slate-400 mb-1">
                      • {item}
                    </Text>
                  ))}
                  <View className="flex-row gap-2 mt-4">
                    <Button variant="secondary" onPress={handleCloseDelete}>Cancel</Button>
                    <Button variant="primary" onPress={() => setDeleteStep('choose')}>Continue</Button>
                  </View>
                </>
              ) : null}
              {deleteStep === 'choose' ? (
                <>
                  <Pressable
                    onPress={() => setDeleteChoice('pause')}
                    className={`p-3 rounded-xl border mb-2 ${deleteChoice === 'pause' ? 'border-indigo-500 bg-indigo-50 dark:bg-indigo-950/30' : 'border-slate-200 dark:border-slate-700'}`}
                  >
                    <Text className="font-medium text-slate-900 dark:text-slate-100">Pause for {ACCOUNT_DELETION_GRACE_DAYS} days</Text>
                    <Text className="text-sm text-slate-500 mt-1">Reactivate anytime before permanent deletion.</Text>
                  </Pressable>
                  <Pressable
                    onPress={() => setDeleteChoice('immediate')}
                    className={`p-3 rounded-xl border mb-4 ${deleteChoice === 'immediate' ? 'border-red-500 bg-red-50 dark:bg-red-950/30' : 'border-slate-200 dark:border-slate-700'}`}
                  >
                    <Text className="font-medium text-slate-900 dark:text-slate-100">Delete immediately</Text>
                    <Text className="text-sm text-slate-500 mt-1">Requires password. Cannot be undone.</Text>
                  </Pressable>
                  <View className="flex-row gap-2">
                    <Button variant="secondary" onPress={() => setDeleteStep('warn')}>Back</Button>
                    <Button variant="primary" onPress={() => setDeleteStep('confirm')}>Continue</Button>
                  </View>
                </>
              ) : null}
              {deleteStep === 'confirm' ? (
                <>
                  {deleteChoice === 'immediate' ? (
                    <>
                      <Text className="text-sm text-slate-600 dark:text-slate-400 mb-2">
                        Type {ACCOUNT_DELETE_CONFIRM_TEXT} to confirm, then enter your password.
                      </Text>
                      <TextInput
                        value={confirmText}
                        onChangeText={setConfirmText}
                        placeholder={ACCOUNT_DELETE_CONFIRM_TEXT}
                        className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 mb-2 text-slate-900 dark:text-slate-100"
                        autoCapitalize="characters"
                      />
                      <TextInput
                        value={password}
                        onChangeText={setPassword}
                        placeholder="Account password"
                        secureTextEntry
                        className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 mb-3 text-slate-900 dark:text-slate-100"
                      />
                    </>
                  ) : (
                    <Text className="text-sm text-slate-600 dark:text-slate-400 mb-4">
                      Your account will be paused and scheduled for deletion in {ACCOUNT_DELETION_GRACE_DAYS} days.
                    </Text>
                  )}
                  {error ? <Text className="text-sm text-red-500 mb-2">{error}</Text> : null}
                  <View className="flex-row gap-2">
                    <Button variant="secondary" onPress={() => setDeleteStep('choose')}>Back</Button>
                    <Button
                      variant="danger"
                      loading={loading}
                      disabled={
                        deleteChoice === 'immediate' &&
                        (confirmText !== ACCOUNT_DELETE_CONFIRM_TEXT || password.length < 8)
                      }
                      onPress={() =>
                        void (deleteChoice === 'pause' ? handlePause() : handleDeleteImmediate())
                      }
                    >
                      {deleteChoice === 'pause' ? 'Pause account' : 'Delete permanently'}
                    </Button>
                  </View>
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>

      <Modal visible={importOpen} animationType="slide" transparent onRequestClose={onCloseImport}>
        <View className="flex-1 justify-end bg-black/50">
          <View className="bg-white dark:bg-slate-900 rounded-t-2xl p-5 pb-8">
            <Text className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-2">Import backup</Text>
            <Text className="text-sm text-slate-600 dark:text-slate-400 mb-3">{ACCOUNT_EXPORT_COPY.restoreHint}</Text>
            <Button variant="secondary" onPress={() => void pickImportFile()} className="mb-2">
              {importFileName ? importFileName : 'Choose JSON backup'}
            </Button>
            <TextInput
              value={importPassword}
              onChangeText={setImportPassword}
              placeholder="Account password"
              secureTextEntry
              className="border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 mb-3 text-slate-900 dark:text-slate-100"
            />
            {error ? <Text className="text-sm text-red-500 mb-2">{error}</Text> : null}
            <View className="flex-row gap-2">
              <Button variant="secondary" onPress={onCloseImport}>Cancel</Button>
              <Button
                variant="primary"
                loading={loading}
                disabled={!importDoc || importPassword.length < 8}
                onPress={() => void handleImport()}
              >
                Import
              </Button>
            </View>
          </View>
        </View>
      </Modal>

      {renderPausedBanner && lifecycle?.status === 'deactivated' ? (
        <AccountPausedBannerMobile
          lifecycle={lifecycle}
          onReactivate={async () => {
            setLoading(true);
            try {
              await reactivateUserAccount(userId);
              await refreshLifecycle();
              Alert.alert('Account reactivated', 'Welcome back to Lantern Study.');
            } catch (e) {
              Alert.alert('Error', e instanceof Error ? e.message : 'Failed to reactivate account.');
            } finally {
              setLoading(false);
            }
          }}
          onExport={onExport}
          loading={loading}
        />
      ) : null}
    </>
  );
}
