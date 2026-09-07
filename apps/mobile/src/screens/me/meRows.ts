/**
 * What lives on the Me tab, in order.
 *
 * Me is ME and nothing else: who I am, the two personal ledgers (Budget,
 * Downloads), the two switches that change how the app behaves for me, then
 * Settings and Log out. Nothing here is a shared destination, and nothing that
 * belongs on another tab is duplicated here.
 *
 * Pure on purpose so jest's node environment can test the row list —
 * MeScreen.tsx is then a thin render over this. The only import is a TYPE, so
 * nothing is pulled in at runtime and an icon name that does not exist is a
 * compile error rather than a blank row.
 */
import type { FeatureKey } from '@lantern/shared/design';
import type { AppIconName } from '../../components/ui/appIconMap';

export type MeRowId =
  | 'academic'
  | 'joinClass'
  | 'budget'
  | 'credits'
  | 'downloads'
  | 'darkMode'
  | 'lowData'
  | 'settings'
  | 'logout';

/**
 * `link` pushes or opens something. `switch` flips a setting in place — it is
 * a mode, so it must never be a destination. `readout` is a figure to read and
 * nothing more: it is not pressable, because a row that looks like a door and
 * opens nothing is worse than a row that never claimed to. `destructive` is
 * Log out.
 */
export type MeRowKind = 'link' | 'switch' | 'readout' | 'destructive';

export interface MeRow {
  id: MeRowId;
  /** The printed name. One name per feature, shared with the web Me page. */
  label: string;
  /** Second line, when the name alone does not say what is behind the row. */
  hint?: string;
  /** Name from APP_ICONS — see components/ui/appIconMap.ts. */
  icon: AppIconName;
  /**
   * Spec v3 §5.7: Me stays neutral, with exactly TWO accented rows — Downloads
   * on amber and Credits on indigo. A row with no `feature` draws a plain
   * glyph in the secondary ink, which is what the other seven do. A loud Me
   * screen is a Me screen that is selling.
   */
  feature?: FeatureKey;
  kind: MeRowKind;
  /** Present only on `switch` rows: the current state. */
  value?: boolean;
  /**
   * What a screen reader announces. Constant for a switch — the on/off state
   * rides on `accessibilityState.checked`, never on the label or the colour.
   */
  accessibilityLabel: string;
}

export interface MeSection {
  id: 'account' | 'mine' | 'preferences' | 'app' | 'session';
  rows: MeRow[];
}

export interface MeState {
  /** True when the app is currently in dark mode. */
  darkMode: boolean;
  lowDataMode: boolean;
}

export function buildMeSections({ darkMode, lowDataMode }: MeState): MeSection[] {
  return [
    {
      id: 'account',
      rows: [
        {
          id: 'academic',
          label: 'Academic details',
          hint: 'University, programme, level and your courses',
          icon: 'school',
          kind: 'link',
          accessibilityLabel: 'Academic details',
        },
        {
          id: 'joinClass',
          label: 'Join a class',
          hint: 'Code from your lecturer — no LMS needed',
          icon: 'people',
          kind: 'link',
          accessibilityLabel: 'Join a class',
        },
      ],
    },
    {
      id: 'mine',
      rows: [
        {
          id: 'budget',
          label: 'Budget',
          hint: 'Spending, savings goals and your wallet',
          icon: 'wallet',
          kind: 'link',
          accessibilityLabel: 'Budget',
        },
        {
          id: 'downloads',
          label: 'Downloads',
          // The two things a student on a metered plan needs to know, said
          // before they tap rather than after: it is on the phone, and reading
          // it costs nothing.
          hint: 'Saved on this phone only — costs no data',
          icon: 'cloud-download',
          feature: 'budget',
          kind: 'link',
          accessibilityLabel: 'Downloads',
        },
        {
          id: 'credits',
          // "AI uses" is the one word for this unit across the app — the
          // badge, the price on every button, and this row. It used to be
          // "credits" here and "AI uses" three taps away, which reads as two
          // different currencies.
          label: 'AI uses',
          hint: 'What you have left today, and what each action costs',
          icon: 'sparkles',
          feature: 'ai',
          // It was a readout while there was nowhere to go. Usage & limits is
          // now that somewhere: the counter, the whole price list, and what
          // still works at zero.
          kind: 'link',
          accessibilityLabel: 'AI uses, usage and limits',
        },
      ],
    },
    {
      id: 'preferences',
      rows: [
        {
          id: 'darkMode',
          label: 'Dark mode',
          icon: 'moon',
          kind: 'switch',
          value: darkMode,
          accessibilityLabel: 'Dark mode',
        },
        {
          id: 'lowData',
          label: 'Low-data mode',
          hint: 'Skip images and heavy downloads on mobile data',
          icon: 'cellular',
          kind: 'switch',
          value: lowDataMode,
          accessibilityLabel: 'Low-data mode',
        },
      ],
    },
    {
      id: 'app',
      rows: [
        {
          id: 'settings',
          label: 'Settings',
          icon: 'settings',
          kind: 'link',
          accessibilityLabel: 'Settings',
        },
      ],
    },
    {
      id: 'session',
      rows: [
        {
          id: 'logout',
          label: 'Log out',
          icon: 'log-out',
          kind: 'destructive',
          accessibilityLabel: 'Log out',
        },
      ],
    },
  ];
}

/** Flattened row list, for tests and for anything that wants the ids in order. */
export function meRowIds(sections: readonly MeSection[]): MeRowId[] {
  return sections.flatMap((section) => section.rows.map((row) => row.id));
}
