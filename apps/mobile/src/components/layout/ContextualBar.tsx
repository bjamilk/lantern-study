import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Pressable, Text, View } from 'react-native';
import {
  featureAccentsDark,
  featureAccentsLight,
  featureSmallTextInk,
} from '@lantern/shared/design';
import {
  planContextualPress,
  type ContextualBarItem,
  type ContextualBarSpec,
} from '../../navigation/contextualBars';
import type { RouteName } from '../../navigation/types';
import { useTheme } from '../../theme';
import { useCompanionStore } from '../../stores/companionStore';
import { useNotesStore } from '../../stores/notesStore';
import { useToastStore } from '../../stores/toastStore';
import { confirmSheet } from '../../stores/confirmStore';
import { recorderDoorPrompt, shouldCreateLectureNote } from '../../screens/study/recorderDoor';
import { AppIcon } from '../ui/AppIcon';
import { useChrome } from './ChromeContext';
import {
  CONTEXTUAL_BAR_CONTENT_HEIGHT,
  contextualBarTransitionMs,
  resolveContextualSpec,
} from './contextualBarLayout';

/**
 * The contextual row (spec v3 §7.2).
 *
 * A 44 dp segment strip drawn directly ABOVE the global bottom bar, inside the
 * same chrome view, carrying a few doors *within* the destination you are in —
 * so a student can go Library → Tests without climbing out to the hub. It never
 * replaces the global bar: the five destinations stay exactly where they are,
 * one tap away, which is the whole difference from StudyFetch's answer of
 * deleting its bar on every pushed screen (`inv #77`, `#169`).
 *
 * What it is a function of: THE FOCUSED ROUTE, and nothing else. Not scroll,
 * not the keyboard, not a selection — the same rule `immersive` already
 * follows. The registry lives in navigation/contextualBars.ts (pure, tested);
 * the arithmetic and the two suppressions live in contextualBarLayout.ts (pure,
 * tested); this file is the untestable shell over both, because mobile jest is
 * node-env and cannot render a native component.
 *
 * What it never does: open a modal or a sheet (the AI panel is the app's own
 * always-available surface, not a modal this row invents), cross into another
 * tab's stack, or emit `tabPress`. The last one matters — `tabPress` also pops
 * the stack to its root, so an item pressed while you are already on it would
 * throw away the screen you are looking at. It scrolls to top instead.
 */

/** Re-exported so a caller reaching for the row also finds its height. */
export { CONTEXTUAL_BAR_CONTENT_HEIGHT } from './contextualBarLayout';

interface SegmentProps {
  item: ContextualBarItem;
  active: boolean;
  onPress: () => void;
  isDark: boolean;
  neutralInk: string;
}

function Segment({ item, active, onPress, isDark, neutralInk }: SegmentProps) {
  const accents = isDark ? featureAccentsDark : featureAccentsLight;
  const ink = accents[item.feature].ink;
  // The label is 11 sp (`text-label`), which is below the 12 px line where a
  // feature ink is allowed to be used raw — featureSmallTextInk is the single
  // source for the darkened substitute (light lime is the one real case).
  const activeLabelInk = featureSmallTextInk(item.feature, isDark ? 'dark' : 'light');

  return (
    <Pressable
      onPress={onPress}
      // 44 dp is the minimum target, and it is also the whole row: the
      // Pressable IS the segment, so there is no dead margin around it.
      style={{ flex: 1, minHeight: CONTEXTUAL_BAR_CONTENT_HEIGHT }}
      className="items-center justify-center px-1"
      accessibilityRole="tab"
      accessibilityState={{ selected: active }}
      accessibilityLabel={item.label}
    >
      {/* `active` is the duotone form — ink stroke over a tint fill — so the
          current segment changes SHAPE and not only hue; `feature` is the
          at-rest form, the glyph stroked in its own identity. Both come from
          appIconTone.ts, which owns the rule. */}
      <AppIcon
        name={item.icon}
        size={18}
        tone={active ? 'active' : 'feature'}
        feature={item.feature}
        color={ink}
        importantForAccessibility="no"
      />
      <Text
        numberOfLines={1}
        // `label`: 11/16/+0.04em. The active segment's word carries the accent;
        // the rest stay neutral, so the row reads as one control with one
        // current item rather than five competing hues at full strength.
        className={`text-label mt-0.5 text-center ${active ? 'font-bold' : 'font-medium'}`}
        style={{ color: active ? activeLabelInk : neutralInk }}
      >
        {item.label}
      </Text>
    </Pressable>
  );
}

/**
 * @param onNavigate Navigate to a route INSIDE the focused tab's stack. Owned
 *   by the caller (RootNavigator's CustomTabBar) because only it holds the
 *   child navigator's state key; a plain `navigate('<Tab>', { screen })` from
 *   here would be exactly the nested navigate `nestedNavigateLint` forbids.
 */
export function ContextualBar({
  onNavigate,
}: {
  onNavigate: (route: RouteName, params?: Record<string, unknown>) => void;
}) {
  const { contextual, contextualRoute, immersive, withinChrome, requestScrollToTop } = useChrome();
  const { colors, isDark, reduceMotion } = useTheme();
  const openCompanion = useCompanionStore((s) => s.open);
  const createNote = useNotesStore((s) => s.createNote);
  const showToast = useToastStore((s) => s.showToast);
  const [openingRecorder, setOpeningRecorder] = useState(false);

  const spec = resolveContextualSpec({ spec: contextual, immersive, withinChrome });

  // What is currently PAINTED, which lags `spec` by one animation on the way
  // out: the row has to still be on screen while its height animates to 0.
  const [rendered, setRendered] = useState<ContextualBarSpec | null>(spec);
  const progress = useRef(new Animated.Value(spec ? 1 : 0)).current;

  useEffect(() => {
    const duration = contextualBarTransitionMs(reduceMotion);
    if (spec) {
      // Appearing, or swapping one registry for another. The content is put up
      // immediately and the strip grows into place; a spec→spec swap keeps the
      // same height, so it is a no-op animation and the row does not blink.
      setRendered(spec);
      Animated.timing(progress, {
        toValue: 1,
        duration,
        // Height cannot be driven natively; the global bar, which never
        // animates at all, is unaffected either way.
        useNativeDriver: false,
      }).start();
      return;
    }
    Animated.timing(progress, { toValue: 0, duration, useNativeDriver: false }).start(
      ({ finished }) => {
        // Only clear on a completed animation: an interrupted one means a new
        // spec arrived, and its own effect has already set the content.
        if (finished) setRendered(null);
      }
    );
  }, [spec, reduceMotion, progress]);

  /**
   * The Record door, identical in meaning to the Study hub's tile: ASK, then
   * create the note and land on the editor with the mic already running. The
   * prompt and the title come from recorderDoor.ts so the two doors cannot
   * drift; only the plumbing is repeated, because the store hooks cannot live
   * in a pure module.
   */
  const openRecorder = useCallback(async () => {
    if (openingRecorder) return;
    setOpeningRecorder(true);
    try {
      const prompt = recorderDoorPrompt();
      const confirmed = await confirmSheet({
        title: prompt.title,
        message: prompt.message,
        confirmLabel: prompt.confirmLabel,
        cancelLabel: prompt.cancelLabel,
      });
      if (!shouldCreateLectureNote(confirmed)) return;
      const note = await createNote({ title: prompt.noteTitle, body: '' });
      onNavigate('NoteEditor', { noteId: note.id, startRecording: true });
    } catch {
      showToast('Could not start a lecture note. Check your connection and try again.', 'error');
    } finally {
      setOpeningRecorder(false);
    }
  }, [openingRecorder, createNote, onNavigate, showToast]);

  const press = useCallback(
    (item: ContextualBarItem) => {
      const plan = planContextualPress({ focusedRoute: contextualRoute, item });
      switch (plan.kind) {
        case 'navigate':
          onNavigate(plan.route, plan.params);
          return;
        case 'scrollToTop':
          requestScrollToTop();
          return;
        case 'openAi':
          openCompanion();
          return;
        case 'record':
          void openRecorder();
          return;
      }
    },
    [contextualRoute, onNavigate, requestScrollToTop, openCompanion, openRecorder]
  );

  // Nothing to draw and nothing animating out: render nothing at all, so the
  // shell with an empty registry is byte-for-byte today's shell.
  if (!rendered) return null;

  return (
    <Animated.View
      style={{
        height: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, CONTEXTUAL_BAR_CONTENT_HEIGHT],
        }),
        opacity: progress,
        overflow: 'hidden',
        borderBottomWidth: 1,
        borderBottomColor: colors.tabBarBorder,
      }}
    >
      <View
        accessibilityRole="tablist"
        className="flex-row"
        style={{ height: CONTEXTUAL_BAR_CONTENT_HEIGHT }}
      >
        {rendered.items.map((item) => (
          <Segment
            key={item.id}
            item={item}
            active={item.target.kind === 'route' && item.target.route === contextualRoute}
            onPress={() => press(item)}
            isDark={isDark}
            neutralInk={colors.tabBarInactive}
          />
        ))}
      </View>
    </Animated.View>
  );
}

export default ContextualBar;
