import React, { useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
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
      <View className="flex-1 justify-end bg-black/40">
        <View className="bg-white dark:bg-slate-900 rounded-t-3xl max-h-[85%]">
          <View className="flex-row items-center justify-between p-4 border-b border-slate-200 dark:border-slate-700">
            <Text className="text-lg font-bold">Message customers</Text>
            <Pressable onPress={onClose}><Text className="text-indigo-600 font-semibold">Close</Text></Pressable>
          </View>
          <ScrollView className="p-4" contentContainerStyle={{ paddingBottom: 24 }}>
            <Text className="text-sm text-slate-500 mb-3">
              Sends an in-app notification and DM to up to 25 customers.
            </Text>
            {!defaultBuyerIds?.length ? (
              <View className="flex-row flex-wrap gap-2 mb-3">
                {SEGMENTS.map(s => (
                  <Pressable
                    key={s.id || 'all'}
                    onPress={() => setSegment(s.id)}
                    className={`px-3 py-1.5 rounded-full border ${
                      segment === s.id ? 'bg-indigo-600 border-indigo-600' : 'border-slate-300 dark:border-slate-600'
                    }`}
                  >
                    <Text className={`text-xs ${segment === s.id ? 'text-white font-semibold' : 'text-slate-600'}`}>
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
              className="border border-slate-200 dark:border-slate-600 rounded-xl px-3 py-2 mb-3 min-h-[100px] text-slate-900 dark:text-slate-100"
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
      </View>
    </Modal>
  );
}
