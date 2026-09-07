import React, { useState } from 'react';
import { Text, TextInput, View } from 'react-native';
import { canonicalizeJoinCode, isValidJoinCode } from '@lantern/shared/academic';
import { useTheme } from '../../theme';
import { Button, Card } from '../ui';
import { joinClassByCode } from '../../services/api';

interface JoinClassCardProps {
  onJoined?: () => void;
}

export function JoinClassCard({ onJoined }: JoinClassCardProps) {
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const { colors } = useTheme();

  return (
    <Card className="mb-3">
      <Text className="text-body font-semibold text-lantern-text mb-2">Join a class</Text>
      <Text className="text-caption text-lantern-text-secondary mb-3">
        Enter the code from your lecturer. You do not need Canvas or Google Classroom.
      </Text>
      <View className="flex-row items-center gap-2">
        <TextInput
          value={code}
          onChangeText={(value) => setCode(canonicalizeJoinCode(value))}
          placeholder="ABC234"
          // Stated, not inherited. With no colour of our own, Android paints
          // the hint with the ACTIVITY's textColorHint, which follows the OS
          // night mode rather than the app's theme: after switching the app
          // from dark to light the hint stayed near-white on a white field and
          // the example code vanished (build 168, shots 41 vs 01). A token
          // from our own palette cannot drift away from our own surface.
          placeholderTextColor={colors.textTertiary}
          autoCapitalize="characters"
          autoCorrect={false}
          maxLength={8}
          className="flex-1 border border-lantern-border rounded-lantern px-3 py-2 font-mono text-body text-lantern-text"
        />
        <Button
          disabled={busy}
          onPress={async () => {
            const normalised = canonicalizeJoinCode(code);
            if (!isValidJoinCode(normalised)) {
              setError('Enter the 6-character code from your lecturer');
              return;
            }
            setBusy(true);
            setError(null);
            try {
              const joined = await joinClassByCode(normalised);
              setDone(joined.title);
              setCode('');
              onJoined?.();
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Could not join');
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy ? 'Joining…' : 'Join'}
        </Button>
      </View>
      {error ? <Text className="text-caption text-lantern-error mt-2">{error}</Text> : null}
      {done ? (
        <Text className="text-caption text-lantern-text-secondary mt-2">You joined {done}.</Text>
      ) : null}
    </Card>
  );
}
