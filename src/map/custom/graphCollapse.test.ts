import { describe, expect, it } from 'vitest';
import { getGraphCollapseState } from './graphCollapse';

describe('getGraphCollapseState', () => {
  const nodes = [
    'root',
    'branch',
    'child',
    'grandchild',
    'sibling',
    'other-root',
    'other-child',
  ].map(id => ({ id }));
  const edges = [
    { source: 'root', target: 'branch' },
    { source: 'branch', target: 'child' },
    { source: 'child', target: 'grandchild' },
    { source: 'root', target: 'sibling' },
    { source: 'other-root', target: 'other-child' },
  ];

  it('starts fully expanded and counts only direct children', () => {
    const { childrenById, hiddenIds } = getGraphCollapseState(nodes, edges, new Set());

    expect(hiddenIds.size).toBe(0);
    expect(childrenById.get('root')).toEqual(new Set(['branch', 'sibling']));
    expect(childrenById.get('branch')).toEqual(new Set(['child']));
    expect(childrenById.has('grandchild')).toBe(false);
  });

  it('hides the entire subtree while keeping the collapsed node, siblings and other roots visible', () => {
    const { hiddenIds } = getGraphCollapseState(nodes, edges, new Set(['branch']));

    expect(hiddenIds).toEqual(new Set(['child', 'grandchild']));
    expect(nodes.filter(node => !hiddenIds.has(node.id)).map(node => node.id)).toEqual([
      'root',
      'branch',
      'sibling',
      'other-root',
      'other-child',
    ]);
  });

  it.each([
    ['branch', 'child'],
    ['child', 'branch'],
  ])(
    'preserves nested collapse after expanding the ancestor with %s collapsed first',
    (first, second) => {
      const collapsedIds = new Set([first, second]);
      const collapsed = getGraphCollapseState(nodes, edges, collapsedIds);

      expect(collapsed.hiddenIds).toEqual(new Set(['child', 'grandchild']));
      expect(collapsedIds).toEqual(new Set(['branch', 'child']));

      collapsedIds.delete('branch');
      const expanded = getGraphCollapseState(nodes, edges, collapsedIds);

      expect(expanded.hiddenIds).toEqual(new Set(['grandchild']));
      expect(expanded.childrenById.get('child')).toEqual(new Set(['grandchild']));
    }
  );

  it('ignores dashed connections for child-count and collapse', () => {
    const referenceNodes = ['entitlement', 'instance', 'binding'].map(id => ({ id }));
    const referenceEdges = [
      { source: 'entitlement', target: 'instance', aux: true },
      { source: 'instance', target: 'binding' },
    ];
    const { childrenById, hiddenIds } = getGraphCollapseState(
      referenceNodes,
      referenceEdges,
      new Set(['entitlement'])
    );

    // The aux link to 'instance' is not a child, so collapsing 'entitlement'
    // hides nothing and the dashed target stays visible.
    expect(childrenById.has('entitlement')).toBe(false);
    expect(hiddenIds.size).toBe(0);
    expect(childrenById.get('instance')).toEqual(new Set(['binding']));
  });

  it('does not follow dashed connections below a solid child connection', () => {
    const referenceEdges = [...edges, { source: 'child', target: 'other-root', aux: true }];
    const { hiddenIds } = getGraphCollapseState(nodes, referenceEdges, new Set(['branch']));

    // The aux edge child → other-root must not drag other-root's subtree into
    // the collapsed set; only the solid descendants of 'branch' are hidden.
    expect(hiddenIds).toEqual(new Set(['child', 'grandchild']));
  });

  it('deduplicates child links and ignores self-links or missing endpoints', () => {
    const invalidEdges = [
      ...edges,
      { source: 'branch', target: 'child' },
      { source: 'branch', target: 'child', aux: true },
      { source: 'branch', target: 'branch' },
      { source: 'branch', target: 'missing' },
      { source: 'missing', target: 'other-root' },
    ];
    const { childrenById, hiddenIds } = getGraphCollapseState(
      nodes,
      invalidEdges,
      new Set(['branch', 'missing'])
    );

    expect(hiddenIds).toEqual(new Set(['child', 'grandchild']));
    expect(childrenById.get('branch')).toEqual(new Set(['child']));
    expect(childrenById.has('missing')).toBe(false);
  });

  it('keeps a collapsed node visible and terminates when its descendants form a cycle', () => {
    const cyclicEdges = [...edges, { source: 'grandchild', target: 'branch' }];
    const { hiddenIds } = getGraphCollapseState(nodes, cyclicEdges, new Set(['branch']));

    expect(hiddenIds).toEqual(new Set(['child', 'grandchild']));
  });

  it.each([
    ['branch', 'child'],
    ['child', 'branch'],
  ])(
    'keeps one toggle visible in a cycle with %s collapsed first and hides downstream branches',
    (first, second) => {
      const cyclicNodes = [...nodes, { id: 'downstream' }, { id: 'downstream-leaf' }];
      const cyclicEdges = [
        ...edges,
        { source: 'grandchild', target: 'branch' },
        { source: 'grandchild', target: 'downstream' },
        { source: 'downstream', target: 'downstream-leaf' },
      ];
      const { hiddenIds } = getGraphCollapseState(
        cyclicNodes,
        cyclicEdges,
        new Set([first, second])
      );

      expect(['branch', 'child', 'grandchild'].filter(id => !hiddenIds.has(id))).toEqual([first]);
      expect(hiddenIds.has('downstream')).toBe(true);
      expect(hiddenIds.has('downstream-leaf')).toBe(true);
    }
  );

  it('does not hide resources for leaves or stale collapsed IDs', () => {
    const { hiddenIds } = getGraphCollapseState(
      nodes,
      edges,
      new Set(['grandchild', 'removed-resource'])
    );

    expect(hiddenIds.size).toBe(0);
    expect(getGraphCollapseState([], [], new Set(['removed-resource'])).childrenById.size).toBe(0);
  });
});
