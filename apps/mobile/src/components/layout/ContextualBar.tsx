import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Keyboard, Platform, Pressable, Text, View } from 'react-native';
import { featureAccentsDark, featureAccentsLight } from '@lantern/shared/design';
import {
  activeItem,
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
import {
  CONTEXTUAL_PILL_LABEL,
  planContextualPills,
  type ContextualPillPlan,
} from './contextualBarPresentation';

/**
 * The contextual row (spec v3 §7.2, as amended by the founder 2026-09-08).
 *
 * A 44 dp strip carrying a few doors *within* the destination you are in — so a
 * student can go Library → Tests without climbing out to the hub. WHERE it sits
 * is the registry's `mode` (navigation/contextualBars.ts): a `replace`-mode row
 * (Study, Shop) stands IN the global bar's slot, and an `above`-mode row (deck,
 * note, walk-through, community) sits above an unchanged global bar. This file
 * draws both.
 *
 * HOW an item is drawn — founder decision 4. The SELECTED item (the one whose
 * target is the focused route) shows its label beside its icon inside a filled
 * pill; every other item is its icon alone. The pill's fill is the selected
 * feature's own `tint` ground and its label the feature's `ink` — the pair the
 * contrast gate (scripts/design/contrast.mjs) already asserts clears 4.5:1 in
 * BOTH themes, so "selected" means the feature's own chip: a soft saturated fill
 * that lifts off the near-white bar in light, a saturated dark ground that reads
 * as filled against the elevated bar in dark. The word is `text-body` (15 sp), a
 * scale step, one line, tail-ellipsised and font-capped so "Flashcards" (the
 * worst case) stays inside the row even at a large accessibility text size. The
 * hidden labels never leave the accessibility tree — every item keeps its full
 * label as an accessible name (see planContextualPills). The label/accessible-
 * name/long-label decisions are pure in contextualBarPresentation.ts (tested);
 * this file is the untestable shell over them, because mobile jest is node-env
 * and cannot render a native component.
 *
 * A `replace`-mode row also carries ONE leading exit control (founder decision
 * 2): Back when the focused stack can pop, Home at the section root — never
 * inert, one position, and the way out now that the global bar is gone. That
 * control is NOT drawn here, and deliberately so. BottomTabBar draws it, because
 * it owns the whole bottom slot and OUTLIVES this component: the row unmounts
 * while the keyboard is up, and an exit that went with it would leave a
 * replace-mode section with no way out at all. One exit, in one file.
 *
 * What its CONTENTS are a function of: THE FOCUSED ROUTE (and, for a route that
 * hosts more than one destination, the segment its params name). Not scroll, not
 * a selection — the same rule `immersive` already follows. The one thing outside
 * the route that touches the row is the soft keyboard, which removes it entirely
 * rather than moving it: the IME is drawn over the bottom of the window, so the
 * row was buried and unpressable while typing.
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
  plan: ContextualPillPlan;
  onPress: () => void;
  isDark: boolean;
}

function Segment({ item, plan, onPress, isDark }: SegmentProps) {
  const accents = isDark ? featureAccentsDark : featureAccentsLight;
  const ink = accents[item.feature].ink;
  const tint = accents[item.feature].tint;

  return (
    <Pressable
      onPress={onPress}
      // 44 dp is the minimum target, and it is also the whole row: the
      // Pressable IS the segment, so there is no dead margin around it.
      // The labelled segment takes a bigger share of the row than an icon-only
      // one — with five equal segments the promoted word has ~14 dp and
      // ellipsises to nothing. The shares are in contextualBarPresentation.ts,
      // where the worst real row is measured against the longest label.
      style={{ flex: plan.flex, minHeight: CONTEXTUAL_BAR_CONTENT_HEIGHT }}
      className="items-center justify-center px-1"
      accessibilityRole="tab"
      accessibilityState={{ selected: plan.selected }}
      // Decision 4's accessibility half: the word may be hidden on screen for an
      // icon-only item, but the accessible NAME is always its full label, so a
      // screen reader announces every item and its selected state.
      accessibilityLabel={plan.accessibleName}
    >
      {plan.showLabel ? (
        // The SELECTED item: icon + label on the feature's own tint chip. Icon
        // and word share the feature `ink`, the pair contrast.mjs gates ≥4.5:1
        // on this tint in both themes. `rounded-full`/`self-center` keep the
        // pill tight around its content and inside the 44 dp row; `flex-shrink`
        // lets a long word ellipsise rather than push the pill past the row.
        <View
          className="max-w-full flex-row items-center self-center rounded-full px-2.5 py-1"
          style={{ backgroundColor: tint }}
        >
          <AppIcon
            name={item.icon}
            size={18}
            tone="feature"
            feature={item.feature}
            color={ink}
            importantForAccessibility="no"
          />
          <Text
            numberOfLines={CONTEXTUAL_PILL_LABEL.numberOfLines}
            ellipsizeMode={CONTEXTUAL_PILL_LABEL.ellipsizeMode}
            maxFontSizeMultiplier={CONTEXTUAL_PILL_LABEL.maxFontSizeMultiplier}
            // `text-body` (15 sp) is a scale step; the pill promotes the word
            // from the old unreadable 11 sp. `shrink` pairs with the pill's
            // `max-w-full` so "Flashcards" truncates instead of overflowing.
            className="text-body ml-1.5 shrink font-semibold"
            style={{ color: ink }}
          >
            {plan.label}
          </Text>
        </View>
      ) : (
        // Every other item: its icon alone, stroked in its own identity. No
        // label on screen — but the accessible name above still carries it.
        <AppIcon
          name={item.icon}
          size={18}
          tone="feature"
          feature={item.feature}
          color={ink}
          importantForAccessibility="no"
        />
      )}
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
  const {
    contextual,
    contextualRoute,
    contextualParams,
    immersive,
    withinChrome,
    requestScrollToTop,
    runScreenAction,
  } = useChrome();
  const { colors, isDark, reduceMotion } = useTheme();
  const openCompanion = useCompanionStore((s) => s.open);
  const createNote = useNotesStore((s) => s.createNote);
  const showToast = useToastStore((s) => s.showToast);
  const [openingRecorder, setOpeningRecorder] = useState(false);

  /**
   * Is the soft keyboard up? The row stands down while it is
   * (contextualBarLayout.ts owns the decision and why).
   *
   * `keyboardDidShow`/`Hide` on Android — the `will*` pair is never emitted
   * there — and the `will*` pair on iOS, where it exists and fires early
   * enough that the row is gone before the IME slides over its place.
   */
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const subs = [
      Keyboard.addListener(showEvent, () => setKeyboardVisible(true)),
      Keyboard.addListener(hideEvent, () => setKeyboardVisible(false)),
    ];
    return () => subs.forEach((sub) => sub.remove());
  }, []);

  const spec = resolveContextualSpec({ spec: contextual, immersive, withinChrome, keyboardVisible });
  // Which segment is the screen you are looking at. The registry owns the
  // answer — including `activeFor`, the rooms a door owns that are not the
  // door itself (Tests → TestBuilder), and the params that say which SEGMENT
  // of a route you are on (Campus → Shop). Comparing `target.route` here
  // instead is what turned the whole row grey the moment "+ New test" was
  // pressed.
  const current = activeItem(contextualRoute, contextualParams);

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
      /**
       * `focusedParams` is how a row below Study says WHICH thing it is about:
       * Deck detail's four modes are modes of the deck in the current route's
       * params, and the note editor's Test is a test of the note in its own.
       * A registry entry is a static description of a row and cannot carry an
       * id, so the params travel with the focused route and the registry says
       * which of them an item inherits. The cast is the seam with lane A: the
       * field is ignored by a planner that does not read it.
       */
      const plan = planContextualPress({
        focusedRoute: contextualRoute,
        focusedParams: contextualParams,
        item,
      });
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
        case 'screenAction':
          // Addressed to the focused route, and silent when that screen has
          // not registered it: a press in the frame between one screen going
          // and the next arriving must do nothing rather than guess.
          runScreenAction(contextualRoute, plan.action);
          return;
        case 'unavailable':
          // The item needs a param the focused route did not supply — a deck
          // mode with no deck. The registry has already decided the honest
          // answer is nothing at all, rather than a session opened over an
          // empty deck.
          return;
      }
    },
    [
      contextualRoute,
      contextualParams,
      onNavigate,
      requestScrollToTop,
      openCompanion,
      openRecorder,
      runScreenAction,
    ]
  );

  // Nothing to draw and nothing animating out: render nothing at all, so the
  // shell with an empty registry is byte-for-byte today's shell.
  if (!rendered) return null;

  // Decision 4: the label goes on the selected item only, and every item keeps
  // its full label as an accessible name. (Decision 2's exit control is drawn by
  // BottomTabBar — see this file's header for why it cannot live here.)
  const pills = planContextualPills(rendered.items, current?.id);
  const planById = new Map(pills.map((p) => [p.id, p]));

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
        {rendered.items.map((item) => {
          const plan = planById.get(item.id);
          if (!plan) return null;
          return (
            <Segment
              key={item.id}
              item={item}
              plan={plan}
              onPress={() => press(item)}
              isDark={isDark}
            />
          );
        })}
      </View>
    </Animated.View>
  );
}

export default ContextualBar;
