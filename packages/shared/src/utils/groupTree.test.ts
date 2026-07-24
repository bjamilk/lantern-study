import { getGroupIdWithDescendants, groupHasChildren } from './groupTree';

describe('groupTree', () => {
  const groups = [
    { id: 'parent', name: 'Parent', parentId: null },
    { id: 'child-a', name: 'A', parentId: 'parent' },
    { id: 'child-b', name: 'B', parentId: 'parent' },
    { id: 'grandchild', name: 'G', parentId: 'child-a' },
    { id: 'archived', name: 'Arch', parentId: 'parent', isArchived: true },
  ];

  it('includes parent and all active descendants', () => {
    const ids = getGroupIdWithDescendants('parent', groups, { activeOnly: true });
    expect(ids.has('parent')).toBe(true);
    expect(ids.has('child-a')).toBe(true);
    expect(ids.has('child-b')).toBe(true);
    expect(ids.has('grandchild')).toBe(true);
    expect(ids.has('archived')).toBe(false);
  });

  it('includes archived when activeOnly is false', () => {
    const ids = getGroupIdWithDescendants('parent', groups, { activeOnly: false });
    expect(ids.has('archived')).toBe(true);
  });

  it('detects children', () => {
    expect(groupHasChildren('parent', groups)).toBe(true);
    expect(groupHasChildren('child-b', groups)).toBe(false);
  });
});
