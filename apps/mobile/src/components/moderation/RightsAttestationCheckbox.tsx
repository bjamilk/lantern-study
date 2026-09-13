/**
 * The rights attestation row every publish flow shows (Phase 1 · E):
 * checkbox + RIGHTS_ATTESTATION_TEXT + a link to the Seller & Creator Terms.
 * Listing create/edit show it for academic categories (isAcademicListing);
 * the question-bank publish modal always does.
 */
import React from 'react';
import { Pressable, Text, View } from 'react-native';
import { RIGHTS_ATTESTATION_TEXT } from '@lantern/shared/moderation';
import { LEGAL_DOCUMENT_TITLES } from '@lantern/shared/legal';
import { navigate } from '../../navigation/navigationRef';
import { AppIcon } from '../ui/AppIcon';
import { brand } from '../../theme';

export function openSellerTerms(): void {
  navigate('LegalDocument', { document: 'seller-terms' });
}

interface Props {
  value: boolean;
  onChange: (next: boolean) => void;
  /** Shown in red under the text when the form was submitted without ticking. */
  error?: string | null;
  disabled?: boolean;
}

export function RightsAttestationCheckbox({ value, onChange, error, disabled }: Props) {
  return (
    <View
      className={`rounded-xl border p-3 mb-4 ${
        error ? 'border-red-400 bg-red-50 dark:bg-red-950/20' : 'border-lantern-border bg-lantern-surface'
      }`}
    >
      <Pressable
        onPress={() => !disabled && onChange(!value)}
        disabled={disabled}
        accessibilityRole="checkbox"
        accessibilityState={{ checked: value, disabled: !!disabled }}
        accessibilityLabel="Rights attestation"
        className="flex-row items-start gap-3"
      >
        <AppIcon
          name={value ? 'checkbox' : 'square'}
          size={22}
          color={value ? brand.text : '#94a3b8'}
          style={{ marginTop: 1 }}
        />
        <Text className="flex-1 text-xs leading-relaxed text-lantern-text">{RIGHTS_ATTESTATION_TEXT}</Text>
      </Pressable>
      <Pressable onPress={openSellerTerms} hitSlop={6} className="self-start mt-2 ml-8" accessibilityRole="link">
        <Text className="text-xs font-semibold text-lantern-primary-text">
          Read the {LEGAL_DOCUMENT_TITLES['seller-terms']}
        </Text>
      </Pressable>
      {error ? <Text className="text-xs text-red-600 dark:text-red-400 mt-2 ml-8">{error}</Text> : null}
    </View>
  );
}

export default RightsAttestationCheckbox;
