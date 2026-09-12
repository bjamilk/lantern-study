/**
 * The reading state for a note body on mobile.
 *
 * The studios used to put `note.body` in a single `T.Body`, so `## Overview`,
 * `**term**` and the Smart Notes sentinels appeared literally, all at one
 * size. This renders the parsed blocks (`@lantern/shared/utils/noteBlocks`) on
 * four steps: `T.Display` (28/34, serif) for the note's own `#`, `T.Title`
 * (22/28, serif) for a `##` section, `T.Heading` (17/24) for a `###`
 * sub-section, `T.Body` (15/22) for prose and bullets, `T.Caption` (13) for a
 * transcript timestamp. The first draft sat one step lower — `##` at 17 over a
 * 15 body — which on a phone reads as one flat size, so each heading role moved
 * up a step and the two top ones took the Bitter serif. Size is what carries
 * the hierarchy here, not weight.
 *
 * The two serif steps deliberately set NO `fontWeight`: the face carries its
 * own weight in the family name (theme/fonts.ts), and a '600' against a
 * single-weight custom family is a smeared faux-bold on iOS.
 *
 * Bullets indent 24 px per level; a heading gets 20 px of air above it;
 * paragraphs 12 px apart.
 *
 * Layout rule this file inherits from the companion bubble bug: inside an
 * intrinsically sized container, text that must wrap uses flexShrink only
 * (flexGrow 0, flexBasis 'auto'). `flex-1` reports an intrinsic width of ZERO
 * and wraps the note one character per line. Never put `flex-1` in here.
 *
 * The web twin is `components/study/NoteReadingView.tsx`.
 */
import React from 'react';
import { Platform, ScrollView, Text, View, type TextStyle, type ViewStyle } from 'react-native';
import {
  noteBlocks,
  type NoteBlock,
  type NoteInlineRun,
} from '@lantern/shared/utils/noteBlocks';
import { T } from './ui';
import { HEADING_STEPS, SPACE_BEFORE_HEADING } from './noteBodySteps';

/** flexShrink-only: see the file comment. The one sizing idiom in this file. */
const SHRINKABLE: TextStyle = { flexShrink: 1, flexGrow: 0, flexBasis: 'auto' };
/** The same rule for a container (a table cell), typed as a view style. */
const SHRINKABLE_VIEW: ViewStyle = { flexShrink: 1, flexGrow: 0, flexBasis: 'auto' };

const MONO = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' });
const MONO_STYLE: TextStyle = { fontFamily: MONO };

/** StudyFetch indents a bullet column by ~24 px; one step per nesting level. */
const INDENT_PER_DEPTH = 24;
/** Air between paragraphs. The heading rhythm lives in ./noteBodySteps. */
const SPACE_AFTER_PARAGRAPH = 12;

/**
 * The inline spans of one block, as children of whatever step wraps them.
 *
 * These are plain `Text`, NOT `T.Body`. A `T.*` step sets an explicit
 * `fontSize` on itself, and in React Native a nested `Text` with its own
 * `fontSize` overrides the parent's — so wrapping every run in `T.Body` (what
 * this did first) silently reset each heading back to the 15 sp body step and
 * made `## Overview` render at body size however large its wrapper was. The
 * runs carry weight, slant and family only; the size and colour are inherited
 * from the `T.Display` / `T.Title` / `T.Heading` / `T.Body` around them.
 *
 * `serif` is set by the two display steps. Their face carries its own weight
 * in the family name, so a `**bold**` run inside one must NOT add a numeric
 * `fontWeight` — on iOS that synthesises a smeared faux-bold over a face that
 * is already semibold. Inside a heading, a bold run is simply the heading.
 */
function InlineRuns({
  runs,
  keyPrefix,
  serif = false,
}: {
  runs: NoteInlineRun[];
  keyPrefix: string;
  serif?: boolean;
}) {
  return (
    <>
      {runs.map((run, i) => {
        const key = `${keyPrefix}-${i}`;
        switch (run.kind) {
          case 'bold':
            return (
              <Text key={key} style={serif ? undefined : { fontWeight: '700' }}>
                {run.text}
              </Text>
            );
          case 'italic':
            return (
              <Text key={key} style={{ fontStyle: 'italic' }}>
                {run.text}
              </Text>
            );
          case 'code':
            return (
              <Text key={key} style={MONO_STYLE}>
                {run.text}
              </Text>
            );
          default:
            return <Text key={key}>{run.text}</Text>;
        }
      })}
    </>
  );
}

function CodeBlock({ text }: { text: string }) {
  return (
    <View
      className="rounded-lg bg-lantern-background-secondary px-2.5 py-2"
      style={{ marginBottom: SPACE_AFTER_PARAGRAPH }}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <T.Caption style={MONO_STYLE}>{text}</T.Caption>
      </ScrollView>
    </View>
  );
}

function TableBlock({
  block,
  keyPrefix,
}: {
  block: Extract<NoteBlock, { kind: 'table' }>;
  keyPrefix: string;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={{ marginBottom: SPACE_AFTER_PARAGRAPH }}
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
                style={{ minWidth: 88, maxWidth: 220, ...SHRINKABLE_VIEW }}
              >
                <T.Body style={row.isHeader ? { fontWeight: '600' } : undefined}>
                  {cell.map((run, i) => (
                    <Text
                      key={`${keyPrefix}-r${r}c${c}-${i}`}
                      style={
                        run.kind === 'bold'
                          ? { fontWeight: '700' }
                          : run.kind === 'code'
                            ? MONO_STYLE
                            : undefined
                      }
                    >
                      {run.text}
                    </Text>
                  ))}
                </T.Body>
              </View>
            ))}
          </View>
        ))}
      </View>
    </ScrollView>
  );
}

function Block({ block, keyPrefix }: { block: NoteBlock; keyPrefix: string }) {
  switch (block.kind) {
    case 'gap':
      return <View style={{ height: 8 }} />;
    case 'title':
    case 'heading':
    case 'subheading': {
      const { step, serif, marginTop, marginBottom } = HEADING_STEPS[block.kind];
      const Step = T[step];
      return (
        <Step
          style={{
            ...SHRINKABLE,
            // The serif faces carry their weight in the family name; only the
            // sans step may be asked for one. See HEADING_STEPS.
            ...(serif ? null : { fontWeight: '600' as const }),
            marginTop,
            marginBottom,
          }}
        >
          <InlineRuns runs={block.runs} keyPrefix={keyPrefix} serif={serif} />
        </Step>
      );
    }
    case 'bullet':
      return (
        <View
          className="flex-row"
          style={{ paddingLeft: block.depth * INDENT_PER_DEPTH, marginBottom: 4 }}
        >
          {/* The marker takes the same ink as the text it belongs to. */}
          <T.Body style={{ flexShrink: 0, minWidth: 20 }}>{block.marker} </T.Body>
          <T.Body style={SHRINKABLE}>
            <InlineRuns runs={block.runs} keyPrefix={keyPrefix} />
          </T.Body>
        </View>
      );
    case 'quote':
      return (
        <View
          className="border-l-2 border-lantern-border pl-3"
          style={{ marginBottom: SPACE_AFTER_PARAGRAPH }}
        >
          <T.Body tone="secondary" style={SHRINKABLE}>
            <InlineRuns runs={block.runs} keyPrefix={keyPrefix} />
          </T.Body>
        </View>
      );
    case 'timestamp':
      return (
        <View className="flex-row" style={{ marginBottom: SPACE_AFTER_PARAGRAPH }}>
          <T.Caption tone="secondary" style={{ flexShrink: 0, marginRight: 8 }}>
            {block.time}
          </T.Caption>
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
        <T.Body style={{ ...SHRINKABLE, marginBottom: SPACE_AFTER_PARAGRAPH }}>
          <InlineRuns runs={block.runs} keyPrefix={keyPrefix} />
        </T.Body>
      );
  }
}

export interface NoteBodyProps {
  body: string | null | undefined;
  /** Shown when the note has nothing in it yet. */
  emptyLine?: string;
}

export function NoteBody({
  body,
  emptyLine = 'This note is empty. Edit it to add study content.',
}: NoteBodyProps) {
  const blocks = React.useMemo(() => noteBlocks(body), [body]);
  if (blocks.length === 0) {
    return <T.Body tone="tertiary">{emptyLine}</T.Body>;
  }
  return (
    <View>
      {blocks.map((block, i) => (
        <Block key={`n${i}`} block={block} keyPrefix={`n${i}`} />
      ))}
    </View>
  );
}

export default NoteBody;
