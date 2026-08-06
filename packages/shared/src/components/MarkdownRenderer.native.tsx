import React from 'react';
import { Text } from 'react-native';

export interface MarkdownRendererProps {
  content?: string;
  className?: string;
  style?: Record<string, unknown>;
  /** Kept for API parity with the web renderer. */
  enableMath?: boolean;
}

/**
 * Native-only Markdown renderer. Kept in a `.native.tsx` file so Metro does not
 * resolve web-only packages (remark-math, rehype-katex, katex, react-markdown).
 */
export const MarkdownRenderer: React.FC<MarkdownRendererProps> = ({ content, style }) => {
  const safeContent = content ?? '';
  const segments: Array<{ type: 'text' | 'math'; value: string }> = [];
  const regex = /\$(.+?)\$/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(safeContent))) {
    const [full, expr] = match;
    const index = match.index;
    if (index > lastIndex) {
      segments.push({ type: 'text', value: safeContent.slice(lastIndex, index) });
    }
    segments.push({ type: 'math', value: expr ?? '' });
    lastIndex = index + full.length;
  }
  if (lastIndex < safeContent.length) {
    segments.push({ type: 'text', value: safeContent.slice(lastIndex) });
  }

  if (segments.length === 0) {
    return <Text style={style as any}>{safeContent}</Text>;
  }

  return (
    <Text style={style as any}>
      {segments.map((segment, idx) => (
        <Text
          key={idx}
          style={segment.type === 'math' ? { fontStyle: 'italic' } : undefined}
        >
          {segment.type === 'math' ? `$${segment.value}$` : segment.value}
        </Text>
      ))}
    </Text>
  );
};
