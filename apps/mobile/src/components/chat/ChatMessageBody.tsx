import React, { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { normalizeStorageUrl, segmentMentions } from '@lantern/shared/utils';

const IMAGE_MARKDOWN = /!\[.*?\]\((https?:\/\/[^)]+)\)/;

export function MentionText({
  text,
  color,
  mentionColor,
}: {
  text: string;
  color: string;
  mentionColor: string;
}) {
  const segments = segmentMentions(text);
  return (
    // Not a TalkBack stop of its own: every caller sits inside a bubble whose
    // row Pressable already announces the message text, so leaving this
    // important made each message read out twice back to back.
    <Text
      importantForAccessibility="no"
      className="text-sm leading-relaxed"
      style={{ color }}
    >
      {segments.map((seg, i) =>
        seg.type === 'mention' ? (
          <Text key={i} style={{ color: mentionColor, fontWeight: '700' }}>
            {seg.value}
          </Text>
        ) : (
          <Text key={i}>{seg.value}</Text>
        )
      )}
    </Text>
  );
}

/**
 * The body of a plain chat message: an optional attached image followed by the
 * text with @mentions highlighted.
 *
 * Attachments are posted as `![image](url)` markdown by `useChatImageAttach`.
 * Only MessageBubble knew how to unwrap that, so once the attach button was
 * enabled in DMs and threads their bubbles rendered the raw markdown as text —
 * keeping this in one place is what stops that recurring.
 */
export function ChatTextBody({
  text,
  textColor,
  mentionColor,
}: {
  text?: string;
  textColor: string;
  mentionColor: string;
}) {
  const [imageFailed, setImageFailed] = useState(false);
  const imageUri = text?.match(IMAGE_MARKDOWN)?.[1];
  const normalizedUri = imageUri ? normalizeStorageUrl(imageUri) : undefined;
  const textWithoutImage = text?.replace(IMAGE_MARKDOWN, '').trim();

  return (
    <View className="gap-2">
      {normalizedUri && !imageFailed ? (
        <Image
          source={{ uri: normalizedUri }}
          accessibilityLabel="Shared image"
          resizeMode="cover"
          onError={() => setImageFailed(true)}
          style={{ width: 220, height: 180, borderRadius: 10 }}
        />
      ) : null}
      {textWithoutImage ? (
        <MentionText text={textWithoutImage} color={textColor} mentionColor={mentionColor} />
      ) : null}
    </View>
  );
}
