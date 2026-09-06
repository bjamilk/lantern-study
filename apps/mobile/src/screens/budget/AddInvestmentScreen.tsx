import React, { useState, useCallback } from 'react';
import { toDateOnlyLocal } from '@lantern/shared/utils/dateOnly';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Alert,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useBudgetStore } from '../../stores/budgetStore';
import { useTheme } from '../../theme';
import { useAuthStore } from '../../stores/authStore';
import { Screen, useScreenBottomPadding } from '../../components/layout';
import { AppIcon } from '../../components/ui/AppIcon';

export default function AddInvestmentScreen() {
  const navigation = useNavigation<any>();
  const userId = useAuthStore(s => s.user?.id) || '';
  const { addTransaction, isLoading } = useBudgetStore();
  const { colors } = useTheme();
  // `padding: 20` left the description box under the absolute tab bar; this is
  // the bar's real clearance and it lives on the content container.
  const bottomPadding = useScreenBottomPadding();
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [date] = useState(new Date());

  const handleSubmit = useCallback(async () => {
    const amountNum = parseFloat(amount);
    if (!amount || amountNum <= 0) {
      Alert.alert('Invalid Amount', 'Please enter a valid positive amount.');
      return;
    }
    if (!description.trim()) {
      Alert.alert('Missing Description', 'Please describe this investment.');
      return;
    }
    try {
      await addTransaction({
        userId,
        type: 'INVESTMENT',
        amount: amountNum,
        category: 'other',
        description: description.trim(),
        date: toDateOnlyLocal(date),
      });
      Alert.alert('Success', 'Investment logged!', [
        { text: 'OK', onPress: () => navigation.goBack() },
      ]);
    } catch {
      Alert.alert('Error', 'Failed to add investment.');
    }
  }, [amount, description, date, addTransaction, navigation, userId]);

  return (
    <Screen keyboard bottom="none" className="flex-1" style={{ backgroundColor: colors.background }}>
      <View style={[styles.header, { backgroundColor: colors.card }]}>
        <TouchableOpacity style={styles.closeButton} onPress={() => navigation.goBack()}>
          <AppIcon name="close" size={24} color={colors.text} />
        </TouchableOpacity>
        <Text style={[styles.headerTitle, { color: colors.text }]}>Add Investment</Text>
        <TouchableOpacity style={[styles.saveButton, { backgroundColor: colors.primaryFill }]} onPress={() => void handleSubmit()} disabled={isLoading}>
          <Text style={styles.saveButtonText}>Save</Text>
        </TouchableOpacity>
      </View>
      <ScrollView
        contentContainerStyle={{ padding: 20, gap: 16, paddingBottom: bottomPadding }}
        keyboardShouldPersistTaps="handled"
      >
        <Text style={{ color: colors.textSecondary, fontSize: 14 }}>
          Log money put into savings, investments, or long-term funds.
        </Text>
        <View>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Amount</Text>
          <View style={[styles.inputRow, { backgroundColor: colors.card }]}>
            <Text style={styles.currency}>₦</Text>
            <TextInput
              style={[styles.input, { color: colors.text }]}
              value={amount}
              onChangeText={setAmount}
              keyboardType="decimal-pad"
              placeholder="0.00"
              placeholderTextColor={colors.textSecondary}
            />
          </View>
        </View>
        <View>
          <Text style={[styles.label, { color: colors.textSecondary }]}>Description</Text>
          <TextInput
            style={[styles.textArea, { backgroundColor: colors.card, color: colors.text }]}
            value={description}
            onChangeText={setDescription}
            placeholder="e.g. Mutual fund contribution"
            placeholderTextColor={colors.textSecondary}
            multiline
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  closeButton: { padding: 8 },
  headerTitle: { fontSize: 18, fontWeight: '700' },
  saveButton: {
    backgroundColor: '#6366f1',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
  },
  saveButtonText: { color: '#fff', fontWeight: '600' },
  label: { fontSize: 13, marginBottom: 8 },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  currency: { fontSize: 18, fontWeight: '700', color: '#6366f1', marginRight: 8 },
  input: { flex: 1, fontSize: 24, fontWeight: '700' },
  textArea: {
    borderRadius: 12,
    padding: 16,
    minHeight: 100,
    textAlignVertical: 'top',
  },
});
