import React from 'react';
import { Image, Modal, Pressable, ScrollView, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { ChatGalleryItem } from '@lantern/shared/chat';
import { useResolvedStorageUrl } from '../../hooks/useResolvedStorageUrl';
import { useTheme } from '../../theme';
import { AppIcon } from '../ui/AppIcon';

function GalleryThumb({ item, onPress }: { item: ChatGalleryItem; onPress: () => void }) {
  const { colors } = useTheme();
  const uri = useResolvedStorageUrl(item.url);
  return (
    <Pressable
      onPress={onPress}
      className="w-[30%] aspect-square rounded-lg overflow-hidden items-center justify-center"
      style={{ backgroundColor: colors.backgroundSecondary }}
      accessibilityLabel={item.kind === 'photo' ? 'Open photo' : 'Open voice note'}
    >
      {item.kind === 'photo' && uri ? (
        <Image source={{ uri }} className="w-full h-full" resizeMode="cover" />
      ) : (
        <AppIcon name="mic" size={22} color={colors.primaryText} />
      )}
    </Pressable>
  );
}

export function ChatGallerySheet({
  visible,
  onClose,
  items,
  onOpenItem,
}: {
  visible: boolean;
  onClose: () => void;
  items: ChatGalleryItem[];
  onOpenItem?: (id: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const { colors } = useTheme();

  return (
    <Modal transparent animationType="slide" visible={visible} onRequestClose={onClose}>
      <Pressable className="flex-1 bg-black/50 justify-end" onPress={onClose}>
        <Pressable
          onPress={(e) => e.stopPropagation?.()}
          className="rounded-t-3xl overflow-hidden"
          style={{ backgroundColor: colors.modalBackground, paddingBottom: insets.bottom + 16 }}
        >
          <View className="flex-row items-center justify-between px-4 pt-4 pb-2">
            <Text className="text-base font-semibold" style={{ color: colors.text }}>
              Photos and voice
            </Text>
            <Pressable onPress={onClose} hitSlop={8} accessibilityLabel="Close">
              <AppIcon name="close" size={20} color={colors.textSecondary} />
            </Pressable>
          </View>
          {items.length === 0 ? (
            <Text className="px-4 py-6 text-sm" style={{ color: colors.textSecondary }}>
              No photos or voice notes in this chat yet.
            </Text>
          ) : (
            <ScrollView contentContainerStyle={{ padding: 16, flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {items.map((item) => (
                <GalleryThumb
                  key={item.id}
                  item={item}
                  onPress={() => {
                    onOpenItem?.(item.id);
                    onClose();
                  }}
                />
              ))}
            </ScrollView>
          )}
        </Pressable>
      </Pressable>
    </Modal>
  );
}
