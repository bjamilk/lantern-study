import { COMPOSER_KEYBOARD_BEHAVIOR } from './chat/composerKeyboardBehavior';
import React, { useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import {
  CONTACT_CATEGORIES,
  CONTACT_CATEGORY_LABELS,
  CONTACT_FORM_LIMITS,
  type ContactCategory,
} from '@lantern/shared/contactForm';
import { submitContactForm } from '../services/contact';

interface ContactSupportModalProps {
  visible: boolean;
  onClose: () => void;
  defaultName?: string;
  defaultEmail?: string;
  colors: {
    background: string;
    card: string;
    text: string;
    textSecondary: string;
    border: string;
    primary: string;
    primaryText: string;
  };
}

export function ContactSupportModal({
  visible,
  onClose,
  defaultName = '',
  defaultEmail = '',
  colors,
}: ContactSupportModalProps) {
  // pageSheet is full-screen on Android (edge-to-edge): the title sat under
  // the status bar and the Send button under the nav bar without these.
  const insets = useSafeAreaInsets();
  const [name, setName] = useState(defaultName);
  const [email, setEmail] = useState(defaultEmail);
  const [category, setCategory] = useState<ContactCategory>('general');
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const handleSubmit = async () => {
    setError(null);
    setSuccess(null);
    setLoading(true);
    try {
      const result = await submitContactForm({
        name,
        email,
        category,
        subject,
        message,
        source: 'mobile',
        // The `_hp` honeypot is injected by submitContactForm itself; its input
        // type deliberately omits it so callers can't accidentally trip it.
      });
      setSuccess(result);
      setSubject('');
      setMessage('');
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Failed to send message.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Modal visible={visible} animationType="slide" presentationStyle="pageSheet" onRequestClose={onClose}>
      <KeyboardAvoidingView
        style={[styles.flex, { backgroundColor: colors.background }]}
        behavior={COMPOSER_KEYBOARD_BEHAVIOR}
      >
        <ScrollView
          contentContainerStyle={[
            styles.container,
            {
              paddingTop: Platform.OS === 'ios' ? 20 : insets.top + 16,
              paddingBottom: insets.bottom + 40,
            },
          ]}
          keyboardShouldPersistTaps="handled"
        >
          <Text style={[styles.title, { color: colors.text }]}>Contact support</Text>
          <Text style={[styles.subtitle, { color: colors.textSecondary }]}>
            We reply by email. Do not include passwords or card numbers.
          </Text>

          <Text style={[styles.label, { color: colors.text }]}>Name</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
            value={name}
            onChangeText={setName}
            maxLength={CONTACT_FORM_LIMITS.nameMax}
            autoCapitalize="words"
          />

          <Text style={[styles.label, { color: colors.text }]}>Email</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
            value={email}
            onChangeText={setEmail}
            keyboardType="email-address"
            autoCapitalize="none"
            maxLength={254}
          />

          <Text style={[styles.label, { color: colors.text }]}>Category</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chipRow}>
            {CONTACT_CATEGORIES.map((key) => (
              <TouchableOpacity
                key={key}
                style={[
                  styles.chip,
                  {
                    backgroundColor: category === key ? colors.primary : colors.card,
                    borderColor: colors.border,
                  },
                ]}
                onPress={() => setCategory(key)}
              >
                <Text style={{ color: category === key ? colors.primaryText : colors.text, fontSize: 13 }}>
                  {CONTACT_CATEGORY_LABELS[key]}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          <Text style={[styles.label, { color: colors.text }]}>Subject</Text>
          <TextInput
            style={[styles.input, { backgroundColor: colors.card, color: colors.text, borderColor: colors.border }]}
            value={subject}
            onChangeText={setSubject}
            maxLength={CONTACT_FORM_LIMITS.subjectMax}
          />

          <Text style={[styles.label, { color: colors.text }]}>Message</Text>
          <TextInput
            style={[
              styles.input,
              styles.textArea,
              { backgroundColor: colors.card, color: colors.text, borderColor: colors.border },
            ]}
            value={message}
            onChangeText={setMessage}
            multiline
            numberOfLines={6}
            maxLength={CONTACT_FORM_LIMITS.messageMax}
            placeholder={`At least ${CONTACT_FORM_LIMITS.messageMin} characters`}
            placeholderTextColor={colors.textSecondary}
          />
          <Text style={[styles.counter, { color: colors.textSecondary }]}>
            {message.length}/{CONTACT_FORM_LIMITS.messageMax}
          </Text>

          {error ? <Text style={styles.error}>{error}</Text> : null}
          {success ? <Text style={styles.success}>{success}</Text> : null}

          <TouchableOpacity
            style={[styles.submit, { backgroundColor: colors.primary, opacity: loading ? 0.7 : 1 }]}
            onPress={() => void handleSubmit()}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={colors.primaryText} />
            ) : (
              <Text style={[styles.submitText, { color: colors.primaryText }]}>Send message</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity style={styles.cancel} onPress={onClose}>
            <Text style={{ color: colors.textSecondary }}>Close</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  container: { padding: 20, paddingBottom: 40 },
  title: { fontSize: 22, fontWeight: '700', marginBottom: 8 },
  subtitle: { fontSize: 14, marginBottom: 20 },
  label: { fontSize: 14, fontWeight: '600', marginBottom: 6, marginTop: 12 },
  input: {
    borderWidth: 1,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  textArea: { minHeight: 120, textAlignVertical: 'top' },
  chipRow: { marginBottom: 4 },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginRight: 8,
  },
  counter: { fontSize: 12, marginTop: 4 },
  error: { color: '#dc2626', marginTop: 12 },
  success: { color: '#16a34a', marginTop: 12 },
  submit: {
    marginTop: 20,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
  },
  submitText: { fontSize: 16, fontWeight: '600' },
  cancel: { marginTop: 16, alignItems: 'center', padding: 8 },
});

export default ContactSupportModal;
