import { parseChatAudioUrl, parseChatImageUrl } from '../utils/chatMedia';

export type ChatGalleryKind = 'photo' | 'voice';

export interface ChatGalleryItem {
  id: string;
  kind: ChatGalleryKind;
  url: string;
  timestamp?: string | Date;
}

export function collectChatGalleryItems(
  messages: Array<{
    id?: string;
    text?: string | null;
    timestamp?: string | Date;
    isRemoved?: boolean;
  }>,
): ChatGalleryItem[] {
  const items: ChatGalleryItem[] = [];
  for (const message of messages) {
    if (!message?.id || message.isRemoved) continue;
    const image = parseChatImageUrl(message.text);
    if (image) {
      items.push({ id: message.id, kind: 'photo', url: image, timestamp: message.timestamp });
      continue;
    }
    const audio = parseChatAudioUrl(message.text);
    if (audio) {
      items.push({ id: message.id, kind: 'voice', url: audio, timestamp: message.timestamp });
    }
  }
  return items;
}
