import React, { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SCREEN_KEYBOARD_BEHAVIOR, useScreenInsets } from '../../../components/layout';
import { sendSellerCampaign } from '../../../services/api';
import type { SellerCustomerSegment } from '@lantern/shared/types';
import { Button } from '../../../components/ui';

const SEGMENTS: Array<{ id: SellerCustomerSegment | ''; label: string }> = [
  { id: '', label: 'All customers' },
  { id: 'repeat_buyer', label: 'Repeat buyers' },
  { id: 'top_spender', label: 'Top spenders' },
  { id: 'open_order', label: 'Open orders' },
  { id: 'open_inquiry', label: 'Open inquiries' },
  { id: 'lead', label: 'Leads (no purchase yet)' },
];

interface Props {
  visible: boolean;
  onClose: () => void;
  defaultBuyerIds?: string[];
}

export function SellerCampaignModal({ visible, onClose, defaultBuyerIds }: Props) {
  const [segment, setSegment] = useState<SellerCustomerSegment | ''>('');
  const insets = useScreenInsets();
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleSend = async () => {
    setError('');
    setResult(null);
    setSending(true);
    try {
      const data = await sendSellerCampaign({
        message,
        segment: segment || undefined,
        buyerIds: defaultBuyerIds,
      });
      setResult(`Sent to ${data.sent} customer${data.sent === 1 ? '' : 's'}${data.skipped ? ` (${data.skipped} skipped)` : ''}.`);
      setMessage('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Campaign failed');
    } finally {
      setSending(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* A bottom-anchored sheet occupies exactly the band the keyboard
          replaces, so its inputs and its submit button were covered. Lifting
          the sheet with the KAV also makes the percentage max-height resolve
          against the keyboard-free box, so the sheet self-limits. */}
      <KeyboardAvoidingView
        behavior={SCREEN_KEYBOARD_BEHAVIOR}
        className="flex-1 justify-end bg-black/40"
      >
        <View className="bg-lantern-surface rounded-t-3xl max-h-[85%]">
          <View className="flex-row items-center justify-between p-4 border-b border-lantern-border">
            <Text className="text-lg font-bold">Message customers</Text>
            <Pressable onPress={onClose}><Text className="text-lantern-primary font-semibold">Close</Text></Pressable>
          </View>
          <ScrollView
            className="p-4"
            contentContainerStyle={{ paddingBottom: insets.bottom + 24 }}
            keyboardShouldPersistTaps="handled"
          >
            <Text className="text-sm text-lantern-text-secondary mb-3">
              Sends an in-app notification and DM to up to 25 customers.
            </Text>
            {!defaultBuyerIds?.length ? (
              <View className="flex-row flex-wrap gap-2 mb-3">
                {SEGMENTS.map(s => (
                  <Pressable
                    key={s.id || 'all'}
                    onPress={() => setSegment(s.id)}
                    className={`px-3 py-1.5 rounded-full border ${
                      segment === s.id ? 'bg-lantern-primary border-lantern-primary' : 'border-lantern-border'
                    }`}
                  >
                    <Text className={`text-xs ${segment === s.id ? 'text-white font-semibold' : 'text-lantern-text-secondary'}`}>
                      {s.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
            <TextInput
              value={message}
              onChangeText={setMessage}
              placeholder="New arrivals, price drops, exam-season bundles..."
              multiline
              numberOfLines={4}
              className="border border-lantern-border rounded-xl px-3 py-2 mb-3 min-h-[100px] text-lantern-text"
              placeholderTextColor="#94a3b8"
              textAlignVertical="top"
            />
            {error ? <Text className="text-sm text-red-600 mb-2">{error}</Text> : null}
            {result ? <Text className="text-sm text-emerald-600 mb-2">{result}</Text> : null}
            <Button loading={sending} disabled={!message.trim()} onPress={() => void handleSend()}>
              Send campaign
            </Button>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}
