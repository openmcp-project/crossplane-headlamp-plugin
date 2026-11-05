export function getGraphCollapseState(
  nodes: ReadonlyArray<{ id: string }>,
  edges: ReadonlyArray<{ source: string; target: string; aux?: boolean }>,
  collapsedIds: ReadonlySet<string>
): { childrenById: Map<string, Set<string>>; hiddenIds: Set<string> } {
  const nodeIds = new Set(nodes.map(node => node.id));
  const childrenById = new Map<string, Set<string>>();

  for (const edge of edges) {
    // Additional references are cross-links, not containment: a resource can be
    // referenced by several others (e.g. one Entitlement ← many ServiceInstances),
    // so they must not drive child-count or collapse.
    if (edge.aux) continue;
    if (edge.source === edge.target) continue;
    if (!nodeIds.has(edge.source) || !nodeIds.has(edge.target)) continue;
    if (!childrenById.has(edge.source)) childrenById.set(edge.source, new Set());
    childrenById.get(edge.source)!.add(edge.target);
  }

  const hiddenIds = new Set<string>();
  for (const collapsedId of collapsedIds) {
    if (hiddenIds.has(collapsedId)) continue;
    // Keep the toggle reachable even when resource references contain a cycle.
    const visited = new Set([collapsedId]);
    const pending = [...(childrenById.get(collapsedId) ?? [])];
    while (pending.length > 0) {
      const id = pending.pop()!;
      if (visited.has(id)) continue;
      visited.add(id);
      hiddenIds.add(id);
      pending.push(...(childrenById.get(id) ?? []));
    }
  }

  return { childrenById, hiddenIds };
}
