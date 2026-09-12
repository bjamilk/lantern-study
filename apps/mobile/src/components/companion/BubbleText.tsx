/**
 * The chat-bubble renderer for companion answers.
 *
 * Layout rule this file exists to protect (the bug that sent it here):
 * the assistant bubble is `self-start` (alignSelf: 'flex-start') with a
 * max width, so Yoga sizes it to its children's INTRINSIC width. A child with
 * `flex-1` (flexGrow 1 / flexShrink 1 / flexBasis 0) reports an intrinsic
 * width of ZERO, so a bullet row built as `<Text>marker</Text><Text
 * className="flex-1">…` made the whole bubble as wide as the marker and the
 * answer wrapped one character per line. Inside an intrinsically sized parent,
 * text that must wrap uses flexShrink only (flexGrow 0, flexBasis 'auto'):
 * it reports its real width, the bubble's max-width caps it, and the shrink
 * lets it wrap. Never put `flex-1` on anything in here.
 */
import React from 'react';
import { Platform, ScrollView, View, type TextStyle, type ViewStyle } from 'react-native';
import { T } from '../ui';
import { bubbleBlocks, type BubbleBlock, type InlineRun } from './bubbleBlocks';

/** flexShrink-only: see the file comment. The one sizing idiom in this file. */
const SHRINKABLE: TextStyle = { flexShrink: 1, flexGrow: 0, flexBasis: 'auto' };
/** The same rule for a container (a table cell), typed as a view style. */
const SHRINKABLE_VIEW: ViewStyle = { flexShrink: 1, flexGrow: 0, flexBasis: 'auto' };

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
const MONO_STYLE: TextStyle = { fontFamily: MONO };

/** One indent step per nesting level, small enough to survive an 85% bubble. */
const INDENT_PER_DEPTH = 8;

function InlineRuns({ runs, keyPrefix }: { runs: InlineRun[]; keyPrefix: string }) {
  return (
    <>
      {runs.map((run, i) => {
        const key = `${keyPrefix}-${i}`;
        switch (run.kind) {
          case 'bold':
            return (
              <T.Body key={key} style={{ fontWeight: '700' }}>
                {run.text}
              </T.Body>
            );
          case 'italic':
            return (
              <T.Body key={key} style={{ fontStyle: 'italic' }}>
                {run.text}
              </T.Body>
            );
          case 'code':
            return (
              <T.Body key={key} style={MONO_STYLE}>
                {run.text}
              </T.Body>
            );
          case 'excerpt':
            // The citation chip is a later lane; until then the marker still
            // has to be readable, so it stays inline and merely stands out.
            return (
              <T.Body key={key} style={{ fontWeight: '600' }}>
                {run.text}
              </T.Body>
            );
          default:
            return <T.Body key={key}>{run.text}</T.Body>;
        }
      })}
    </>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <View className="my-1 rounded-lg bg-lantern-background-secondary px-2.5 py-2">
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <T.Caption style={MONO_STYLE}>{text}</T.Caption>
      </ScrollView>
    </View>
  );
}

function TableBlock({ block, keyPrefix }: { block: Extract<BubbleBlock, { kind: 'table' }>; keyPrefix: string }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      className="my-1"
      contentContainerStyle={{ flexDirection: 'column' }}
    >
      <View className="rounded-lg border border-lantern-border overflow-hidden">
        {block.rows.map((row, r) => (
          <View
            key={`${keyPrefix}-r${r}`}
            className={`flex-row ${r > 0 ? 'border-t border-lantern-border' : ''} ${
              row.isHeader ? 'bg-lantern-background-secondary' : ''
            }`}
          >
            {row.cells.map((cell, c) => (
              <View
                key={`${keyPrefix}-r${r}c${c}`}
                className={`px-2 py-1.5 ${c > 0 ? 'border-l border-lantern-border' : ''}`}
                style={{ minWidth: 72, maxWidth: 180, ...SHRINKABLE_VIEW }}
              >
                <T.Caption style={row.isHeader ? { fontWeight: '600' } : undefined}>
                  {cell.map((run, i) => (
                    <T.Caption
                      key={`${keyPrefix}-r${r}c${c}-${i}`}
                      style={run.kind === 'bold' ? { fontWeight: '700' } : run.kind === 'code' ? MONO_STYLE : undefined}
                    >
                      {run.text}
                    </T.Caption>
                  ))}
                </T.Caption>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Block({ block, keyPrefix }: { block: BubbleBlock; keyPrefix: string }) {
  switch (block.kind) {
    case 'gap':
      return <View className="h-2" />;
    case 'heading':
      // Level 3 is a run-in sub-head, not a third size: the six-step scale has
      // one heading step, so h3 is body weight-shifted instead.
      return block.level <= 2 ? (
        <T.Heading style={{ ...SHRINKABLE, marginTop: 2, marginBottom: 2 }}>
          <InlineRuns runs={block.runs} keyPrefix={keyPrefix} />
        </T.Heading>
      ) : (
        <T.Body style={{ ...SHRINKABLE, fontWeight: '600' }}>
          <InlineRuns runs={block.runs} keyPrefix={keyPrefix} />
        </T.Body>
      );
    case 'bullet':
      return (
        <View className="flex-row" style={{ paddingLeft: block.depth * INDENT_PER_DEPTH }}>
          {/* Marker takes its own colour from the same ink as the text. */}
          <T.Body style={{ flexShrink: 0, minWidth: 16 }}>{block.marker} </T.Body>
          <T.Body style={SHRINKABLE}>
            <InlineRuns runs={block.runs} keyPrefix={keyPrefix} />
          </T.Body>
        </View>
      );
    case 'code':
      return <CodeBlock text={block.text} />;
    case 'table':
      return <TableBlock block={block} keyPrefix={keyPrefix} />;
    default:
      return (
        <T.Body style={SHRINKABLE}>
          <InlineRuns runs={block.runs} keyPrefix={keyPrefix} />
        </T.Body>
      );
  }
}

export function FormattedBubbleText({ content }: { content: string }) {
  const blocks = React.useMemo(() => bubbleBlocks(content), [content]);
  return (
    <View>
      {blocks.map((block, i) => (
        <Block key={`b${i}`} block={block} keyPrefix={`b${i}`} />
      ))}
    </View>
  );
}

/** What the bubble shows while the answer is still streaming in. */
export function BubbleTypingIndicator() {
  return (
    <T.Caption tone="secondary" accessibilityLabel="Lantern AI is thinking">
      Thinking…
    </T.Caption>
  );
}

export default FormattedBubbleText;
