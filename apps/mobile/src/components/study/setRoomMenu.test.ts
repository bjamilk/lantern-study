import { setRoomMenuRows } from './setRoomMenu';

describe('setRoomMenuRows', () => {
  it('opens on Set settings and ends on the only destructive row', () => {
    const rows = setRoomMenuRows();
    expect(rows.map((row) => row.action)).toEqual([
      'settings',
      'add-materials',
      'library',
      'delete',
    ]);
    expect(rows[0].label).toBe('Set settings');
    expect(rows.filter((row) => row.destructive).map((row) => row.action)).toEqual(['delete']);
  });

  it('gives every row a label and an icon, so no row renders as a blank strip', () => {
    for (const row of setRoomMenuRows()) {
      expect(row.label.trim().length).toBeGreaterThan(0);
      expect(row.icon.trim().length).toBeGreaterThan(0);
    }
  });
});
