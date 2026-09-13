import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useVisibleSetParams } from '../../stores/setRoomUiStore';
import {
  Animated,
  Keyboard,
  LayoutAnimation,
  Platform,
  Pressable,
  Text,
  View,
} from 'react-native';
import type { ThemePalette } from '@lantern/shared/design';
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
import { isLectureNote, resolveLectureStudioNote } from '@lantern/shared';
import { recorderDoorPrompt, shouldCreateLectureNote } from '../../screens/study/recorderDoor';
import { useLectureRecordingStore } from '../../stores/lectureRecordingStore';
import { AppIcon } from '../ui/AppIcon';
import { useChrome } from './ChromeContext';
import {
  CONTEXTUAL_BAR_CONTENT_HEIGHT,
  contextualBarTransitionMs,
  resolveContextualSpec,
} from './contextualBarLayout';
import {
  CONTEXTUAL_PILL_LABEL,
  planContextualRow,
  type ContextualPillPlan,
} from './contextualBarPresentation';
import {
  TAB_PILL_LABEL_MAX_FONT_SCALE,
  TAB_ROW_EDGE_PADDING,
  tabPillTransitionMs,
} from './tabPillLayout';
import { TAB_PILL } from '../../theme/surfaceMetrics';

/**
 * The contextual row (spec v3 §7.2, as amended by the founder 2026-09-08).
 *
 * A 44 dp strip carrying a few doors *within* the thing you are in. WHERE it
 * sits is the registry's to declare: directly above the global five-tab bar on
 * every row but one, and IN the bar's slot for the SET row, which is the only
 * row about one thing the student is inside and the only row carrying its own
 * `Home` door back out to the five (navigation/contextualBars.ts). This
 * component reports which of the two is on screen through `onPresence`; the bar
 * itself stands its tabs down.
 *
 * HOW an item is drawn — founder decision 4, amended by "label every door on a
 * no-selection surface" (build 176). One of two surfaces, chosen by
 * `planContextualRow` from the SELECTION alone:
 *
 * - A row WITH a selection: the selected door shows its label beside
 *   its icon inside a filled pill; every other item is its icon alone. The
 *   pill's fill is the theme's `primaryFill` ink and its label `textInverse` —
 *   the CONTROL pair, not a feature accent (see `Segment`). The word is a
 *   NAMED step and never a raw size — `text-label` (11 sp) since the pill went
 *   stacked, `text-body` (15 sp) while it was horizontal — one
 *   line, tail-ellipsised and font-capped so "Flashcards" (the worst case) stays
 *   inside the row even at a large accessibility text size.
 * - Every OTHER row — a pass-through row (deck, note, walk-through, community),
 *   or any row with NO selection (the Study hub, Notes, the Shop root): a
 *   small label UNDER every icon. Build 175 tried a leading section TITLE on the
 *   no-selection rows; build 176's device pass rejected it — it spent a
 *   third of the bar naming a section the app bar already names, and squeezed the
 *   five doors narrower. So a no-selection surface now shares the pass-through
 *   row's one code path: every door names itself, because a student there lacks
 *   what each icon DOES, not which section they are in.
 *
 * The hidden labels never leave the accessibility tree — every item keeps its
 * full label as an accessible name (see planContextualRow). The which-surface /
 * accessible-name / long-word decisions are pure in contextualBarPresentation.ts
 * (tested); this file is the untestable shell over them, because mobile jest is
 * node-env and cannot render a native component.
 *
 * The row carries no separate exit control: an `above` row's way out is the
 * global bar underneath it, and the set row's way out is `Home`, its own first
 * ITEM, which is drawn and labelled like every other door rather than being a
 * special chrome affordance beside them. While the keyboard is up the row stands
 * down entirely and the five tabs come back, so there is never a moment with no
 * bottom navigation at all.
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
  /** The live theme palette — this row's colours are CONTROL colours now. */
  colors: ThemePalette;
}

/**
 * The hugging pill's geometry, borrowed whole from the global bar so the set
 * row and the bar it stands in for are one object at two item lists. See
 * tabPillLayout.ts for where each number was measured.
 */
const HUGGED_PILL = {
  gap: 12,
  paddingLeading: 15,
  paddingTrailing: 18,
} as const;

function Segment({ item, plan, onPress, colors }: SegmentProps) {
  // A NAVIGATION SEGMENT IS A CONTROL, NOT A FEATURE (2026-09-12).
  //
  // This row used to paint each door in its own feature accent — the Study
  // row's "Ask" in the `ai` violet, the Shop row's Browse/Cart/You in the
  // `campus` violet — and the selected door's pill in that
  // feature's pastel tint. Build 198's device pass is what killed it: the Study
  // row read as four neutral glyphs plus one inexplicably violet one, and the
  // whole Shop sub-nav read as a violet island inside an otherwise ink-and-
  // cream app. A feature colour answers "what KIND of thing is this" — the
  // right question on a type tile or a FeatureDisc, where the pastels remain.
  // It is the wrong question on a row whose only job is "which door are you
  // standing in", and the answer to THAT is the same everywhere in the app:
  // the ink when you are on it, the muted outline when you are not.
  //
  // So: the selected door is a `primaryFill` pill under `textInverse`, the
  // same object the global bar's lit tab and every primary button draw; every
  // other door is `tabBarInactive`, the same muted the five tabs below use.
  const selectedInk = colors.textInverse;
  const selectedFill = colors.primaryFill;
  const restingInk = colors.tabBarInactive;
  const ink = plan.selected ? selectedInk : restingInk;

  return (
    <Pressable
      onPress={onPress}
      // 44 dp is the minimum target, and it is also the whole row: the
      // Pressable IS the segment, so there is no dead margin around it.
      // The selected pill takes a bigger share of the row than an icon-only one
      // — with five equal segments the promoted word has ~14 dp and ellipsises
      // to nothing. The shares are in contextualBarPresentation.ts, where the
      // worst real row is measured against the longest label.
      style={{
        flex: plan.flex,
        // A door that takes no flex share (the pill, and the two pinned ends
        // of a `replace` row) still may not fall below a touch target.
        minWidth: 44,
        minHeight: CONTEXTUAL_BAR_CONTENT_HEIGHT,
      }}
      className="items-center justify-center px-1"
      accessibilityRole="tab"
      accessibilityState={{ selected: plan.selected }}
      // The accessibility half: the word may be hidden on screen for an
      // icon-only item, but the accessible NAME is always its full label, so a
      // screen reader announces every item and its selected state.
      accessibilityLabel={plan.accessibleName}
    >
      {plan.variant === 'selectedPill' ? (
        // The SELECTED door: icon over label on the theme's ink pill, the
        // same object the global bar's lit tab and every primary button draw.
        // Icon and word share `textInverse`, which the palette pairs with
        // `primaryFill` at 15.6:1 (light) / 15.9:1 (dark).
        //
        // STACKED, not side by side — founder direction 2026-09-11, and the
        // same shape the global bar's lit tab now takes. A horizontal word cost
        // ~48 dp of chrome, which the row could only pay by taking three shares
        // of its width and leaving the four doors beside it with no room for a
        // label at all. Stacked, the pill needs exactly what its neighbours
        // need, so every door on the row keeps its name and this one still
        // reads as the place you are standing.
        //
        // `rounded-full`/`self-center` keep the pill tight around its content
        // and inside the 44 dp row; `max-w-full` plus the word's own tail
        // ellipsis let a long label truncate rather than push the pill past it.
        <View
          className={
            plan.hugged
              ? 'max-w-full flex-row items-center self-center rounded-full'
              : 'max-w-full items-center self-center rounded-full px-1.5 py-1'
          }
          style={{
            backgroundColor: selectedFill,
            ...(plan.hugged
              ? {
                  // TAB_PILL.height, not the ROW's height: the set bar's pill
                  // and the global bar's lit tab are one object, and the 44 dp
                  // it stands on must come from one constant so a future change
                  // to the row's strip cannot silently resize the pill. (They
                  // are equal today; the device pass measured 113 px against
                  // 116 only because the row's own bottom BORDER was eating a
                  // dp out of the content box — see the hairline below.)
                  height: TAB_PILL.height,
                  paddingLeft: HUGGED_PILL.paddingLeading,
                  paddingRight: HUGGED_PILL.paddingTrailing,
                  // On Android an over-wide child draws over its neighbour
                  // rather than clipping; the ceiling is the row planner's.
                  ...(plan.maxWidth !== null ? { maxWidth: plan.maxWidth } : null),
                }
              : null),
          }}
        >
          <AppIcon
            name={item.icon}
            size={18}
            color={ink}
            importantForAccessibility="no"
          />
          <Text
            numberOfLines={CONTEXTUAL_PILL_LABEL.numberOfLines}
            ellipsizeMode={CONTEXTUAL_PILL_LABEL.ellipsizeMode}
            maxFontSizeMultiplier={
              plan.hugged
                ? TAB_PILL_LABEL_MAX_FONT_SCALE
                : CONTEXTUAL_PILL_LABEL.maxFontSizeMultiplier
            }
            // HUGGED (a `replace` row — the set bar): `text-body`, the 15 sp
            // step, beside the glyph. That is the founder's 2026-09-13 ask and
            // the same word the global bar's lit tab now draws; the set row is
            // standing in that bar's slot, so it has the width for it.
            // STACKED (an `above` row): `text-label` (11 sp), unchanged — it
            // sits over a bar already drawing the bigger word.
            className={
              plan.hugged ? 'text-body font-semibold' : 'text-label text-center font-bold'
            }
            style={plan.hugged ? { color: ink, marginLeft: HUGGED_PILL.gap } : { color: ink }}
          >
            {plan.label}
          </Text>
        </View>
      ) : plan.variant === 'labeledIcon' ? (
        // A pass-through row's item, OR a door on a row with no selection (the
        // Study hub, the Shop root): icon with a small label UNDER it, no fill —
        // the same shape the global tab labels use (`text-label`, 11 sp), so a
        // pass-through toolbar and a section hub alike read as a labelled row
        // rather than nameless glyphs. Icon and word share `tabBarInactive` —
        // a resting door on this row is muted exactly as a resting tab is. The word is capped and
        // tail-ellipsised so a long one ("Flashcards" on the tight Study row)
        // stays on its single line inside the 44 dp row.
        <View className="items-center">
          <AppIcon
            name={item.icon}
            size={18}
            color={ink}
            importantForAccessibility="no"
          />
          <Text
            numberOfLines={CONTEXTUAL_PILL_LABEL.numberOfLines}
            ellipsizeMode={CONTEXTUAL_PILL_LABEL.ellipsizeMode}
            maxFontSizeMultiplier={CONTEXTUAL_PILL_LABEL.maxFontSizeMultiplier}
            className="text-label mt-0.5 text-center font-medium"
            style={{ color: ink }}
          >
            {plan.label}
          </Text>
        </View>
      ) : (
        // `iconOnly` — every non-selected door of a `replace` row since the
        // founder's 2026-09-13 direction. The word is not drawn; it is still
        // announced, through `accessibilityLabel={plan.accessibleName}` on the
        // Pressable above. That is the whole trade: a drawn word may go, a
        // spoken one may not.
        <AppIcon
          name={item.icon}
          size={18}
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
  onPresence,
}: {
  onNavigate: (route: RouteName, params?: Record<string, unknown>) => void;
  /**
   * Report whether a row is DRAWN right now and, if so, where it sits.
   *
   * The caller (RootNavigator's CustomTabBar) needs this to know whether to
   * stand the five global tabs down: a `replace` row is in their slot. It has to
   * come from here rather than from the registry, because presence is not the
   * registry's alone — the soft keyboard takes the row off screen, and a bar
   * that hid its tabs from the registry would leave a student typing inside a
   * set with no bottom navigation at all.
   */
  onPresence?: (mode: 'above' | 'replace' | null) => void;
}) {
  const {
    contextual,
    contextualRoute,
    contextualParams: routeParams,
    immersive,
    withinChrome,
    requestScrollToTop,
    runScreenAction,
  } = useChrome();
  const { colors, isDark, reduceMotion } = useTheme();
  // The store is the single writer of the visible set segment/shelf; params are
  // only an inbox, so the lit pill must follow the store, not the last ask.
  const contextualParams = useVisibleSetParams(routeParams);
  const openCompanion = useCompanionStore((s) => s.open);
  // Ask INSIDE a set says which set before the sheet mounts — SF2 §6 #14.
  const openCompanionForScope = useCompanionStore((s) => s.openForScope);
  const createNote = useNotesStore((s) => s.createNote);
  const showToast = useToastStore((s) => s.showToast);
  const [openingRecorder, setOpeningRecorder] = useState(false);
  /**
   * The row's measured width, so a hugged pill's ceiling is a real number
   * rather than a guess. Null until the first layout pass, which the planner
   * reads as "no ceiling yet" rather than as a ceiling of zero.
   */
  const [barWidth, setBarWidth] = useState<number | null>(null);

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

  // Tell the bar what is actually down here. `mode` and nothing else: the
  // caller only ever asks "are the five tabs mine to draw?".
  const presentMode = spec ? spec.mode ?? 'above' : null;
  useEffect(() => {
    onPresence?.(presentMode);
  }, [presentMode, onPresence]);
  // Which segment is the screen you are looking at. The registry owns the
  // answer — including `activeFor`, the rooms a door owns that are not the
  // door itself (Tests → TestBuilder), and the params that say which SEGMENT
  // of a route you are on (Campus → Shop). Comparing `target.route` here
  // instead is what turned the whole row grey the moment "+ New test" was
  // pressed.
  const current = activeItem(contextualRoute, contextualParams);

  /**
   * Re-flow the row when the SELECTED door changes, in the same ~180 ms the
   * global bar uses (tabPillLayout.ts owns the duration and why 180).
   *
   * Queued during render, not in an effect: LayoutAnimation configures the
   * NEXT commit, and an effect runs after that commit has already laid out. The
   * Android experimental flag is turned on once at BottomTabBar.tsx's module
   * load — both files are mounted by the same navigator, and setting it twice
   * would be the only alternative.
   *
   * Only on a selection change, never on a spec change: the row's own
   * appear/disappear is already an `Animated` height, and stacking a layout
   * animation on top of it makes the strip flicker as it grows.
   */
  const lastSelected = useRef(current?.id ?? null);
  if (lastSelected.current !== (current?.id ?? null)) {
    lastSelected.current = current?.id ?? null;
    const duration = tabPillTransitionMs(reduceMotion);
    if (duration > 0) {
      LayoutAnimation.configureNext({
        duration,
        create: { type: 'easeInEaseOut', property: 'opacity' },
        update: { type: 'easeInEaseOut' },
        delete: { type: 'easeInEaseOut', property: 'opacity' },
      });
    }
  }

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
  const openRecorder = useCallback(async (into?: Record<string, unknown>) => {
    if (openingRecorder) return;
    setOpeningRecorder(true);
    try {
      const lecture = useLectureRecordingStore.getState();
      if (lecture.status !== 'idle' && lecture.noteId) {
        onNavigate('NoteEditor', { noteId: lecture.noteId });
        return;
      }
      const notesState = useNotesStore.getState();
      const todayPrompt = recorderDoorPrompt();
      const decision = resolveLectureStudioNote({
        lectures: notesState.notes.filter(isLectureNote),
        recordingNoteId: lecture.noteId,
        todayTitle: todayPrompt.noteTitle,
      });
      const resumeTitle =
        decision.action === 'resume'
          ? notesState.notes.find((row) => row.id === decision.noteId)?.title || todayPrompt.noteTitle
          : null;
      const prompt = recorderDoorPrompt(new Date(), { resumeTitle });
      const confirmed = await confirmSheet({
        title: prompt.title,
        message: prompt.message,
        confirmLabel: prompt.confirmLabel,
        cancelLabel: prompt.cancelLabel,
      });
      if (!shouldCreateLectureNote(confirmed)) return;
      if (decision.action === 'resume') {
        onNavigate('NoteEditor', { noteId: decision.noteId, startRecording: true });
        return;
      }
      // `into` files the note INSIDE the set the row is standing in (the set
      // row's Record door carries `studySetId`). Undefined everywhere else, so
      // the loose-note behaviour is unchanged.
      const note = await createNote({ title: prompt.noteTitle, body: '', ...(into ?? {}) });
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
          // A door that knows its room states it; one that does not opens the
          // panel exactly as before and lets it infer the scope from the route.
          if (plan.scopeId) {
            openCompanionForScope({ scopeId: plan.scopeId, label: plan.scopeLabel ?? null });
            return;
          }
          openCompanion();
          return;
        case 'record':
          void openRecorder(plan.params);
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
      openCompanionForScope,
      openRecorder,
      runScreenAction,
    ]
  );

  // Nothing to draw and nothing animating out: render nothing at all, so the
  // shell with an empty registry is byte-for-byte today's shell.
  if (!rendered) return null;

  // The SELECTION decides the surface: the selected door's pill on a row that
  // has one, or a label under every icon on a row that is none of its own doors
  // (the Study hub, a deck, a note). Every item keeps its full label as an
  // accessible name.
  const rowPlan = planContextualRow({
    items: rendered.items,
    selectedId: current?.id,
    // A `replace` row IS the bottom bar while it is drawn, so it draws the
    // bar's object: icon-only doors and one hugging pill.
    mode: rendered.mode ?? 'above',
    barWidth,
  });
  const planById = new Map(rowPlan.items.map((p) => [p.id, p]));

  return (
    <Animated.View
      style={{
        height: progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, CONTEXTUAL_BAR_CONTENT_HEIGHT],
        }),
        opacity: progress,
        overflow: 'hidden',
      }}
    >
      <View
        accessibilityRole="tablist"
        className="flex-row items-center"
        style={{
          height: CONTEXTUAL_BAR_CONTENT_HEIGHT,
          paddingHorizontal: TAB_ROW_EDGE_PADDING,
        }}
        onLayout={(event) => setBarWidth(event.nativeEvent.layout.width)}
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
              colors={colors}
            />
          );
        })}
      </View>
      {/* THE HAIRLINE IS DRAWN, NOT BORDERED — SF3b device pass, item 2.
          It used to be `borderBottomWidth: 1` on this very box, and React
          Native's box model puts a border INSIDE the height: a 44 dp box with a
          1 dp bottom border leaves a 43 dp content area, `overflow: 'hidden'`
          clipped the 44 dp row inside it, and the set bar's pill measured
          113 px against the global bar's 116 (43 dp vs 44 at 420 dpi). The two
          bars draw the same object and must measure the same.
          As an absolutely-positioned child the rule costs the content nothing,
          so the row — and the pill in it — gets its full
          CONTEXTUAL_BAR_CONTENT_HEIGHT, and every clearance sum that already
          reserves exactly that height stays correct. */}
      <View
        style={{
          position: 'absolute',
          left: 0,
          right: 0,
          bottom: 0,
          height: 1,
          backgroundColor: colors.tabBarBorder,
        }}
        importantForAccessibility="no-hide-descendants"
        pointerEvents="none"
      />
    </Animated.View>
  );
}

export default ContextualBar;
