/**
 * Group hierarchy helpers for dashboard rollups and hierarchical pickers.
 */

export interface GroupTreeNode {
  id: string;
  parentId?: string | null;
  isArchived?: boolean;
}

/** Return selected group id plus all descendant ids (optionally active-only). */
export function getGroupIdWithDescendants(
  groupId: string,
  groups: GroupTreeNode[],
  options?: { activeOnly?: boolean }
): Set<string> {
  const activeOnly = options?.activeOnly !== false;
  const byParent = new Map<string, string[]>();
  for (const group of groups) {
    if (activeOnly && group.isArchived) continue;
    const parentKey = group.parentId || '';
    const list = byParent.get(parentKey) || [];
    list.push(group.id);
    byParent.set(parentKey, list);
  }

  const ids = new Set<string>([groupId]);
  const stack = [groupId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    const children = byParent.get(current) || [];
    for (const childId of children) {
      if (ids.has(childId)) continue;
      ids.add(childId);
      stack.push(childId);
    }
  }
  return ids;
}

/** True when the group has at least one child in the provided set. */
export function groupHasChildren(
  groupId: string,
  groups: GroupTreeNode[],
  options?: { activeOnly?: boolean }
): boolean {
  const activeOnly = options?.activeOnly !== false;
  return groups.some(
    (g) => g.parentId === groupId && (!activeOnly || !g.isArchived)
  );
}
