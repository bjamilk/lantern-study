/**
 * The set room kebab's menu, as data.
 *
 * WHY IT IS A LIST AND NOT JSX. The room's `⋮` used to open an inline `Card`
 * rendered into the room's own `ScrollView`, below the segment row rather than
 * under the kebab that opened it — a menu drawn as page content, sitting in
 * the band the shell's scroll-away chrome occupies. On device every touch
 * inside it closed the menu without running the row: `Set settings` failed 6
 * out of 6 through four different injection methods, while the identical
 * `navigate('StudySetSettings')` from the hub card's `⋮` — which uses the
 * shared `ActionSheet` — worked immediately before and after (SF5a device
 * pass, check 4).
 *
 * The fix is not another guess at which layer ate the touch: it is to stop
 * having two kinds of kebab menu. The room now opens the same `ActionSheet`
 * the hub does — a `Modal`, above every overlay and outside every scroll
 * container — and this module is the rows, so their identity and order can be
 * tested without a renderer.
 */
export type SetRoomMenuAction = 'settings' | 'add-materials' | 'library' | 'delete';

export interface SetRoomMenuRow {
  action: SetRoomMenuAction;
  label: string;
  icon: 'settings' | 'add' | 'library' | 'trash';
  destructive?: boolean;
}

/**
 * Settings first, because renaming a set and changing its tile is what the
 * kebab is opened for; delete last and alone, because it is the only row that
 * cannot be undone.
 */
export function setRoomMenuRows(): SetRoomMenuRow[] {
  return [
    { action: 'settings', label: 'Set settings', icon: 'settings' },
    { action: 'add-materials', label: 'Add materials', icon: 'add' },
    { action: 'library', label: 'Everything in this set', icon: 'library' },
    { action: 'delete', label: 'Delete set', icon: 'trash', destructive: true },
  ];
}
