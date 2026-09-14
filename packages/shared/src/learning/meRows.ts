/**
 * What lives on the Profile menu, in order.
 *
 * Profile is the account half of the fifth destination: who I am, the personal
 * ledgers, Settings and Log out. Dark mode and Low-data mode are switches,
 * so they live once, in Settings → Appearance, not here. Progress is the
 * other peer section — it is not a row here.
 *
 * Pure so web, the phone and jest share one list. Icon names are the subset
 * both AppIcon maps already ship.
 */
import type { FeatureKey } from '../design';

export type MeRowId =
  | 'academic'
  | 'joinClass'
  | 'budget'
  | 'downloads'
  | 'credits'
  | 'teach'
  | 'invite'
  | 'settings'
  | 'admin'
  | 'logout';

export type MeRowIcon =
  | 'school'
  | 'people'
  | 'wallet'
  | 'cloud-download'
  | 'sparkles'
  | 'gift'
  | 'moon'
  | 'cellular'
  | 'settings'
  | 'log-out';

/**
 * `link` pushes or opens something. `switch` flips a setting in place — it is
 * a mode, so it must never be a destination. `destructive` is Log out.
 */
export type MeRowKind = 'link' | 'switch' | 'destructive';

export interface MeRow {
  id: MeRowId;
  label: string;
  hint?: string;
  icon: MeRowIcon;
  /**
   * Exactly two accented rows — Downloads on amber and AI uses on indigo.
   * Everything else is a plain glyph.
   */
  feature?: FeatureKey;
  kind: MeRowKind;
  value?: boolean;
  accessibilityLabel: string;
}

export interface MeSection {
  id: 'account' | 'mine' | 'app' | 'session';
  rows: MeRow[];
}

export interface MeState {
  /** Web-only: the admin console sits with Log out, last. */
  includeAdmin?: boolean;
}

export function buildMeSections({ includeAdmin = false }: MeState = {}): MeSection[] {
  const sessionRows: MeRow[] = [];
  if (includeAdmin) {
    sessionRows.push({
      id: 'admin',
      label: 'Admin console',
      icon: 'people',
      kind: 'link',
      accessibilityLabel: 'Admin console',
    });
  }
  sessionRows.push({
    id: 'logout',
    label: 'Log out',
    icon: 'log-out',
    kind: 'destructive',
    accessibilityLabel: 'Log out',
  });

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
          hint: 'Saved on this device — costs no data',
          icon: 'cloud-download',
          feature: 'budget',
          kind: 'link',
          accessibilityLabel: 'Downloads',
        },
        {
          id: 'credits',
          label: 'AI uses',
          hint: 'What you have left today, and what each action costs',
          icon: 'sparkles',
          feature: 'ai',
          kind: 'link',
          accessibilityLabel: 'AI uses, usage and limits',
        },
        {
          id: 'teach',
          label: 'Teach',
          hint: 'Classes, roster, join codes',
          icon: 'people',
          kind: 'link',
          accessibilityLabel: 'Teach',
        },
        {
          id: 'invite',
          label: 'Invite friends',
          hint: 'Share Lantern with your campus',
          icon: 'gift',
          kind: 'link',
          accessibilityLabel: 'Invite friends',
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
      rows: sessionRows,
    },
  ];
}

/**
 * Blocks on the Profile section, top to bottom. Progress is the other tab.
 */
export type MeProfileBlockId = 'identity' | MeSection['id'];

export function meProfileBlockOrder(sections: readonly MeSection[]): MeProfileBlockId[] {
  return ['identity', ...sections.map((section) => section.id)];
}

export function meRowIds(sections: readonly MeSection[]): MeRowId[] {
  return sections.flatMap((section) => section.rows.map((row) => row.id));
}
