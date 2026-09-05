import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { Audio, type AVPlaybackStatus } from 'expo-av';
import { useTheme } from '../../theme';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';
import { AppIcon } from '../ui/AppIcon';

export function formatChatAudioTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const secs = total % 60;
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Scrubbable voice-note player for chat bubbles.
 *
 * Lived inside MessageBubble until DMs needed it too — DmBubble had grown its
 * own Play/Pause pill with no duration, no seek and a different palette, which
 * is exactly the group-vs-DM divergence this component exists to prevent.
 * Colours come from the shared `chatBubble*` tokens, so it sits correctly on
 * either bubble without the caller passing anything but `isOwn`.
 */
export function VoiceNotePlayer({ url, isOwn }: { url: string; isOwn: boolean }) {
  const { colors } = useTheme();
  // Re-sign embedded storage URLs — chat messages keep a short-lived signed link.
  const resolvedUrl = useResolvedStorageUrl(url);
  const soundRef = useRef<Audio.Sound | null>(null);
  const trackWidthRef = useRef(0);
  const [playing, setPlaying] = useState(false);
  const [durationMs, setDurationMs] = useState(0);
  const [positionMs, setPositionMs] = useState(0);
  const [loadError, setLoadError] = useState(false);

  const onStatus = useCallback((status: AVPlaybackStatus) => {
    if (!status.isLoaded) return;
    if (typeof status.durationMillis === 'number' && status.durationMillis > 0) {
      setDurationMs(status.durationMillis);
    }
    if (status.didJustFinish) {
      setPlaying(false);
      setPositionMs(0);
      void soundRef.current?.setPositionAsync(0);
      return;
    }
    setPositionMs(status.positionMillis ?? 0);
    setPlaying(status.isPlaying);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    setPlaying(false);
    setDurationMs(0);
    setPositionMs(0);

    const previous = soundRef.current;
    soundRef.current = null;
    if (previous) void previous.unloadAsync();

    if (!resolvedUrl) {
      if (resolvedUrl === null) setLoadError(true);
      return;
    }

    const load = async () => {
      try {
        const { sound } = await Audio.Sound.createAsync(
          { uri: resolvedUrl },
          { shouldPlay: false, progressUpdateIntervalMillis: 100 },
          onStatus
        );
        if (cancelled) {
          await sound.unloadAsync();
          return;
        }
        soundRef.current = sound;
        const status = await sound.getStatusAsync();
        if (status.isLoaded && typeof status.durationMillis === 'number') {
          setDurationMs(status.durationMillis);
        }
      } catch {
        if (!cancelled) setLoadError(true);
      }
    };

    void load();

    return () => {
      cancelled = true;
      const sound = soundRef.current;
      soundRef.current = null;
      if (sound) void sound.unloadAsync();
    };
  }, [resolvedUrl, onStatus]);

  const ensureSound = async (): Promise<Audio.Sound | null> => {
    if (!resolvedUrl) return null;
    let sound = soundRef.current;
    if (sound) return sound;
    try {
      const created = await Audio.Sound.createAsync(
        { uri: resolvedUrl },
        { shouldPlay: false, progressUpdateIntervalMillis: 100 },
        onStatus
      );
      sound = created.sound;
      soundRef.current = sound;
      return sound;
    } catch {
      setLoadError(true);
      return null;
    }
  };

  const seekToRatio = async (ratio: number) => {
    const sound = await ensureSound();
    if (!sound) return;
    const status = await sound.getStatusAsync();
    if (!status.isLoaded) return;
    const total =
      (typeof status.durationMillis === 'number' && status.durationMillis > 0
        ? status.durationMillis
        : durationMs) || 0;
    if (!(total > 0)) return;
    const next = Math.max(0, Math.min(total, Math.floor(ratio * total)));
    // Avoid leaving the player stuck in the finished state after scrubbing to the tail.
    const clamped = next >= total - 40 ? Math.max(0, total - 40) : next;
    await sound.setPositionAsync(clamped);
    setPositionMs(clamped);
  };

  // Screen-reader increment/decrement: nudge the playhead by a few seconds,
  // reusing the same seek path as tap-to-seek.
  const nudgeSeconds = async (deltaSec: number) => {
    const total = durationMs;
    if (!(total > 0)) return;
    const nextMs = Math.max(0, Math.min(total, positionMs + deltaSec * 1000));
    await seekToRatio(nextMs / total);
  };

  const toggle = async () => {
    try {
      const sound = await ensureSound();
      if (!sound) return;
      const status = await sound.getStatusAsync();
      if (!status.isLoaded) return;
      if (status.isPlaying) {
        await sound.pauseAsync();
        return;
      }
      const total = status.durationMillis ?? durationMs;
      const atEnd =
        !!status.didJustFinish ||
        (typeof total === 'number' && total > 0 && (status.positionMillis ?? 0) >= total - 40);
      if (atEnd) {
        await sound.playFromPositionAsync(0);
      } else {
        await sound.playAsync();
      }
    } catch {
      setPlaying(false);
    }
  };

  const durationSec = durationMs / 1000;
  const positionSec = positionMs / 1000;
  const progress = durationMs > 0 ? Math.min(1, positionMs / durationMs) : 0;
  const iconColor = isOwn ? colors.chatBubbleText : colors.primary;
  const trackColor = isOwn ? `${colors.chatBubbleMeta}55` : colors.primaryBackground;
  const fillColor = isOwn ? colors.chatBubbleText : colors.primary;
  const timeColor = colors.chatBubbleMeta;

  if (loadError || resolvedUrl === null) {
    return (
      <Text className="text-xs py-1" style={{ color: timeColor }}>
        Voice note unavailable
      </Text>
    );
  }

  if (!resolvedUrl) {
    return (
      <Text className="text-xs py-1" style={{ color: timeColor }}>
        Loading voice note…
      </Text>
    );
  }

  return (
    <View className="flex-row items-center gap-2.5 py-1 min-w-0 w-full" style={{ maxWidth: 260 }}>
      <Pressable
        onPress={() => void toggle()}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
        className="items-center justify-center rounded-full"
        style={{
          width: 36,
          height: 36,
          backgroundColor: isOwn ? `${colors.chatBubbleMeta}33` : colors.primaryBackground,
        }}
      >
        <AppIcon
          name={playing ? 'pause' : 'play'}
          size={18}
          color={iconColor}
          style={playing ? undefined : { marginLeft: 2 }}
        />
      </Pressable>
      <View className="flex-1 min-w-0" style={{ gap: 6 }}>
        <Pressable
          onLayout={(e) => {
            trackWidthRef.current = e.nativeEvent.layout.width;
          }}
          onPress={(e) => {
            const width = trackWidthRef.current;
            if (!(width > 0)) return;
            const ratio = Math.max(0, Math.min(1, e.nativeEvent.locationX / width));
            void seekToRatio(ratio);
          }}
          style={{
            height: 16,
            justifyContent: 'center',
          }}
          accessibilityRole="adjustable"
          accessibilityLabel="Seek voice note"
          accessibilityValue={{
            min: 0,
            max: Math.round(durationSec),
            now: Math.round(positionSec),
          }}
          accessibilityActions={[
            { name: 'increment', label: 'Forward 5 seconds' },
            { name: 'decrement', label: 'Back 5 seconds' },
          ]}
          onAccessibilityAction={(event) => {
            if (event.nativeEvent.actionName === 'increment') void nudgeSeconds(5);
            else if (event.nativeEvent.actionName === 'decrement') void nudgeSeconds(-5);
          }}
        >
          <View
            style={{
              height: 6,
              borderRadius: 999,
              overflow: 'hidden',
              backgroundColor: trackColor,
            }}
          >
            <View
              style={{
                height: '100%',
                width: `${progress * 100}%`,
                borderRadius: 999,
                backgroundColor: fillColor,
              }}
            />
          </View>
        </Pressable>
        <View className="flex-row items-center justify-between">
          <Text style={{ color: timeColor, fontSize: 11, fontVariant: ['tabular-nums'] }}>
            {formatChatAudioTime(positionSec)}
          </Text>
          <Text style={{ color: timeColor, fontSize: 11, fontVariant: ['tabular-nums'] }}>
            {formatChatAudioTime(durationSec)}
          </Text>
        </View>
      </View>
    </View>
  );
}
