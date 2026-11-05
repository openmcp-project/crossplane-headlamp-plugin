import type { XYPosition } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import type { GraphEdge, GraphNode } from '../common/types';
import { collectAllGroups, groupGraph, ResourceGroup } from './groupGraph';
import { createLayoutInterpolator, planGroupTransition, TransitionGraph } from './groupTransition';
import type { EdgeRoute, GraphLayout } from './layoutGraph';
import { layoutGraph } from './layoutGraph';
import { AGGREGATED_NODE_HEIGHT, NODE_WIDTH, RESOURCE_NODE_LAYOUT_HEIGHT } from './styles';

function resource(id: string): GraphNode {
  return { id, kubeObject: { kind: id[0], apiVersion: 'example.org/v1' }, status: 'success' };
}

function edge(source: string, target: string, aux = false): GraphEdge {
  return { id: `${source}-${target}-${aux}`, source, target, ...(aux ? { aux } : {}) };
}

function graph(
  ids: string[],
  edges: GraphEdge[],
  groups: ResourceGroup[],
  locations: Record<string, XYPosition>
): TransitionGraph {
  const viewGraph = groupGraph(ids.map(resource), edges, groups);
  const input = {
    nodes: viewGraph.nodes.map(node => ({
      id: node.id,
      width: 100,
      height: node.type === 'aggregated' ? 60 : 40,
    })),
    edges: viewGraph.edges,
  };
  const positions = new Map(
    viewGraph.nodes.map(node => [
      node.id,
      locations[
        node.type === 'resource' ? node.id : node.members.map(member => member.id).join('+')
      ],
    ])
  );
  const routes = new Map(
    input.edges.map((relationship): [string, EdgeRoute] => {
      const source = positions.get(relationship.source)!;
      const target = positions.get(relationship.target)!;
      const sourceHeight = input.nodes.find(node => node.id === relationship.source)!.height;
      const start = { x: source.x + 50 + (relationship.aux ? 20 : 0), y: source.y + sourceHeight };
      const end = { x: target.x + 50 + (relationship.aux ? 20 : 0), y: target.y };
      const middleY = (start.y + end.y) / 2;
      return [
        relationship.id,
        {
          ...relationship,
          points: [start, { x: start.x, y: middleY }, { x: end.x, y: middleY }, end],
          ...(relationship.aux ? { labelPosition: { x: (start.x + end.x) / 2, y: middleY } } : {}),
        },
      ];
    })
  );
  return { input, viewGraph, positions, routes };
}

function aggregateId(layout: TransitionGraph, members: string[]): string {
  return layout.viewGraph.nodes.find(
    node =>
      node.type === 'aggregated' &&
      node.members.map(member => member.id).join('+') === members.join('+')
  )!.id;
}

function transitionPair() {
  const ids = ['A1', 'A2', 'B1', 'B2'];
  const edges = [edge('A1', 'B1'), edge('A2', 'B2')];
  const previous = graph(ids, edges, [], {
    A1: { x: 10, y: 20 },
    A2: { x: 310, y: 120 },
    B1: { x: 10, y: 400 },
    B2: { x: 310, y: 400 },
  });
  const next = graph(ids, edges, [['A1', 'A2']], {
    'A1+A2': { x: 700, y: 500 },
    B1: { x: 500, y: 800 },
    B2: { x: 900, y: 800 },
  });
  return { previous, next };
}

describe('group transition planning', () => {
  it('converges at the clicked node center and keeps unrelated children fixed', () => {
    const { previous, next } = transitionPair();
    const plan = planGroupTransition(previous, next, 'A1');
    expect(plan.hasGather).toBe(true);
    expect([...plan.gathered.positions.keys()]).toEqual([...previous.positions.keys()]);
    expect(plan.gathered.positions.get('A1')).toEqual({ x: 10, y: 20 });
    expect(plan.gathered.positions.get('A2')).toEqual({ x: 10, y: 20 });
    expect(plan.gathered.positions.get('B1')).toEqual(previous.positions.get('B1'));
    expect(plan.gathered.positions.get('B2')).toEqual(previous.positions.get('B2'));
    expect(plan.nextStartLayout.positions.get(aggregateId(next, ['A1', 'A2']))).toEqual({
      x: 10,
      y: 20,
    });
    expect(plan.nextStartLayout.positions.get('B1')).toEqual(previous.positions.get('B1'));
    expect(plan.nextStartLayout.positions.get('B2')).toEqual(previous.positions.get('B2'));
  });

  it('uses the mean visible-node center without an applicable clicked anchor', () => {
    const { previous, next } = transitionPair();
    for (const anchor of [undefined, 'B1']) {
      const plan = planGroupTransition(previous, next, anchor);
      expect(plan.gathered.positions.get('A1')).toEqual({ x: 160, y: 70 });
      expect(plan.gathered.positions.get('A2')).toEqual({ x: 160, y: 70 });
      expect(plan.nextStartLayout.positions.get(aggregateId(next, ['A1', 'A2']))).toEqual({
        x: 160,
        y: 60,
      });
    }
  });

  it('gathers multiple global groups at their own centroids', () => {
    const ids = ['A1', 'A2', 'B1', 'B2'];
    const previous = graph(ids, [], [], {
      A1: { x: 0, y: 0 },
      A2: { x: 200, y: 0 },
      B1: { x: 0, y: 300 },
      B2: { x: 600, y: 300 },
    });
    const next = graph(
      ids,
      [],
      [
        ['A1', 'A2'],
        ['B1', 'B2'],
      ],
      {
        'A1+A2': { x: 0, y: 0 },
        'B1+B2': { x: 400, y: 0 },
      }
    );
    const plan = planGroupTransition(previous, next);
    expect(plan.gathered.positions.get('A1')).toEqual({ x: 100, y: 0 });
    expect(plan.gathered.positions.get('B1')).toEqual({ x: 300, y: 300 });
    expect(plan.gathered.positions.get('B2')).toEqual({ x: 300, y: 300 });
  });

  it('merges an existing aggregate and singleton using their card centers, without member-count weighting', () => {
    const ids = ['A1', 'A2', 'A3'];
    const previous = graph(ids, [], [['A1', 'A2']], {
      'A1+A2': { x: 100, y: 200 },
      A3: { x: 500, y: 0 },
    });
    const next = graph(ids, [], [['A1', 'A2', 'A3']], { 'A1+A2+A3': { x: 0, y: 0 } });
    const oldAggregate = aggregateId(previous, ['A1', 'A2']);
    const plan = planGroupTransition(previous, next);
    expect(plan.gathered.positions.get(oldAggregate)).toEqual({ x: 300, y: 95 });
    expect(plan.gathered.positions.get('A3')).toEqual({ x: 300, y: 105 });
    expect(plan.nextStartLayout.positions.get(aggregateId(next, ids))).toEqual({ x: 300, y: 95 });

    const clicked = planGroupTransition(previous, next, oldAggregate);
    expect(clicked.gathered.positions.get(oldAggregate)).toEqual({ x: 100, y: 200 });
    expect(clicked.gathered.positions.get('A3')).toEqual({ x: 100, y: 210 });
  });

  it('starts ungrouped resources and indirectly split child groups at their old aggregate centers', () => {
    const ids = ['A1', 'A2', 'B1', 'B2', 'B3', 'B4'];
    const edges = [edge('A1', 'B1'), edge('A1', 'B2'), edge('A2', 'B3'), edge('A2', 'B4')];
    const previous = graph(
      ids,
      edges,
      [
        ['A1', 'A2'],
        ['B1', 'B2', 'B3', 'B4'],
      ],
      {
        'A1+A2': { x: 0, y: 0 },
        'B1+B2+B3+B4': { x: 100, y: 200 },
      }
    );
    const next = graph(
      ids,
      edges,
      [
        ['B1', 'B2'],
        ['B3', 'B4'],
      ],
      {
        A1: { x: 0, y: 0 },
        A2: { x: 300, y: 0 },
        'B1+B2': { x: 0, y: 200 },
        'B3+B4': { x: 300, y: 200 },
      }
    );
    const plan = planGroupTransition(previous, next);
    expect(plan.hasGather).toBe(false);
    expect(plan.gathered.positions).toEqual(previous.positions);
    expect(plan.nextStartLayout.positions.get('A1')).toEqual({ x: 0, y: 10 });
    expect(plan.nextStartLayout.positions.get('A2')).toEqual({ x: 0, y: 10 });
    expect(plan.nextStartLayout.positions.get(aggregateId(next, ['B1', 'B2']))).toEqual({
      x: 100,
      y: 200,
    });
    expect(plan.nextStartLayout.positions.get(aggregateId(next, ['B3', 'B4']))).toEqual({
      x: 100,
      y: 200,
    });
    for (const route of plan.nextStartLayout.routes.values()) {
      expect(route.points[0]).toEqual({ x: 50, y: 50 });
      expect(route.points.at(-1)).toEqual({ x: 150, y: 200 });
    }
  });

  it('moves bends and labels with their endpoints during gathering', () => {
    const { previous, next } = transitionPair();
    const id = edge('A2', 'B2').id;
    previous.routes.set(id, {
      ...previous.routes.get(id)!,
      points: [
        { x: 360, y: 160 },
        { x: 360, y: 280 },
        { x: 360, y: 400 },
      ],
      labelPosition: { x: 380, y: 280 },
    });
    const plan = planGroupTransition(previous, next, 'A1');
    expect(plan.gathered.routes.get(id)?.points).toEqual([
      { x: 60, y: 60 },
      { x: 210, y: 230 },
      { x: 360, y: 400 },
    ]);
    expect(plan.gathered.routes.get(id)?.labelPosition).toEqual({ x: 230, y: 230 });
    const remapped = [...plan.nextStartLayout.routes.values()].find(
      route => route.target === 'B2'
    )!;
    expect(remapped.source).toBe(aggregateId(next, ['A1', 'A2']));
    expect(remapped.points[0]).toEqual({ x: 60, y: 80 });
    expect(remapped.points.at(-1)).toEqual({ x: 360, y: 400 });
    expect(remapped.points).toHaveLength(3);
  });

  it('prefers an unchanged edge identity and keeps auxiliary routes separate', () => {
    const ids = ['A1', 'A2', 'B1'];
    const edges = [
      edge('A1', 'B1'),
      { ...edge('A1', 'B1'), id: 'another' },
      edge('A2', 'B1', true),
    ];
    const previous = graph(ids, edges, [], {
      A1: { x: 0, y: 0 },
      A2: { x: 200, y: 0 },
      B1: { x: 100, y: 300 },
    });
    previous.routes.get('another')!.points.splice(1, 0, { x: 1000, y: 1000 });
    const unchanged = graph(ids, edges, [], {
      A1: { x: 100, y: 100 },
      A2: { x: 300, y: 100 },
      B1: { x: 200, y: 400 },
    });
    const stable = planGroupTransition(previous, unchanged);
    expect(stable.nextStartLayout.routes.get('another')?.points).toEqual(
      previous.routes.get('another')!.points
    );
    expect(stable.nextStartLayout.routes.get(edge('A1', 'B1').id)?.points).toEqual(
      previous.routes.get(edge('A1', 'B1').id)!.points
    );

    const next = graph(ids, edges, [['A1', 'A2']], {
      'A1+A2': { x: 100, y: 100 },
      B1: { x: 100, y: 400 },
    });
    const merged = planGroupTransition(previous, next, 'A1');
    const aux = [...merged.nextStartLayout.routes.values()].find(route => route.aux)!;
    expect(aux.points[0]).toEqual({ x: 70, y: 60 });
    expect(aux.points.at(-1)).toEqual({ x: 170, y: 300 });
    expect(aux.labelPosition).toBeDefined();
    expect([...merged.nextStartLayout.routes.values()].filter(route => !route.aux)).toHaveLength(1);
  });

  it('inherits the first route by identity when several previous sources merge', () => {
    const ids = ['A1', 'A2', 'B1', 'B2'];
    const edges = [
      { ...edge('A1', 'B1'), id: 'z-route' },
      { ...edge('A2', 'B2'), id: 'a-route' },
    ];
    const previous = graph(ids, edges, [], {
      A1: { x: 0, y: 0 },
      A2: { x: 300, y: 0 },
      B1: { x: 0, y: 300 },
      B2: { x: 300, y: 300 },
    });
    previous.routes.get('a-route')!.points.splice(1, 0, { x: 500, y: 100 });
    const next = graph(
      ids,
      edges,
      [
        ['A1', 'A2'],
        ['B1', 'B2'],
      ],
      {
        'A1+A2': { x: 0, y: 0 },
        'B1+B2': { x: 0, y: 300 },
      }
    );
    const plan = planGroupTransition(previous, next);
    expect([...plan.nextStartLayout.routes.values()][0].points).toHaveLength(5);
  });

  it('keeps route planning storage linear when restoring sparse relationships between groups', () => {
    const mapWrites = [64, 128].map(count => {
      const sources = Array.from(
        { length: count },
        (_, index) => `A${String(index).padStart(3, '0')}`
      );
      const targets = sources.map(id => id.replace('A', 'B'));
      const ids = [...sources, ...targets];
      const edges = sources.map((source, index) => edge(source, targets[index]));
      const previous = graph(ids, edges, [sources, targets], {
        [sources.join('+')]: { x: 0, y: 0 },
        [targets.join('+')]: { x: 0, y: 300 },
      });
      const next = graph(
        ids,
        edges,
        [],
        Object.fromEntries(ids.map((id, index) => [id, { x: index * 200, y: 100 }]))
      );
      // Map writes expose pair expansion without machine-dependent timing thresholds.
      const writes = vi.spyOn(Map.prototype, 'set');
      let plan: ReturnType<typeof planGroupTransition>;
      let writeCount: number;
      try {
        plan = planGroupTransition(previous, next);
        writeCount = writes.mock.calls.length;
      } finally {
        writes.mockRestore();
      }
      expect(plan.nextStartLayout.routes.size).toBe(count);
      for (const route of plan.nextStartLayout.routes.values()) {
        expect(route.points[0]).toEqual({ x: 50, y: 50 });
        expect(route.points.at(-1)).toEqual({ x: 50, y: 310 });
      }
      return writeCount;
    });
    expect(mapWrites[1]).toBeLessThanOrEqual(mapWrites[0] * 2);
  });

  it.each(['sources', 'targets'])('keeps sparse %s merges linear in lookup work', endpoint => {
    const lookupCounts = [64, 128].map(count => {
      const sources = Array.from(
        { length: count },
        (_, index) => `A${String(index).padStart(3, '0')}`
      );
      const targets = sources.map(id => id.replace('A', 'B'));
      const ids = [...sources, ...targets];
      const edges = sources.map((source, index) => edge(source, targets[index], true));
      const locations = Object.fromEntries(
        ids.map((id, index) => [id, { x: index * 200, y: 100 }])
      );
      const members = endpoint === 'sources' ? sources : targets;
      const previous = graph(ids, edges, [], locations);
      const next = graph(ids, edges, [members], {
        ...locations,
        [members.join('+')]: { x: 0, y: 0 },
      });
      // Count reads as well as membership checks so recounting degrees cannot hide quadratic work.
      const gets = vi.spyOn(Map.prototype, 'get');
      const checks = vi.spyOn(Set.prototype, 'has');
      let plan: ReturnType<typeof planGroupTransition>;
      let lookupCount: number;
      try {
        plan = planGroupTransition(previous, next);
        lookupCount = gets.mock.calls.length + checks.mock.calls.length;
      } finally {
        gets.mockRestore();
        checks.mockRestore();
      }
      expect(plan.nextStartLayout.routes.size).toBe(count);
      expect([...plan.nextStartLayout.routes.values()].every(route => route.aux)).toBe(true);
      return lookupCount;
    });
    expect(lookupCounts[1]).toBeLessThanOrEqual(lookupCounts[0] * 2);
  });

  it('keeps bent routes growing at most linearly when global actions interrupt each other', async () => {
    const nodes = ['P', 'A1', 'A2', 'B1', 'B2'].map(id => ({
      ...resource(id),
      kubeObject: { kind: id.startsWith('A') ? 'A' : id, apiVersion: 'example.org/v1' },
    }));
    const edges = [edge('P', 'A1'), edge('P', 'A2'), edge('A1', 'B1'), edge('A2', 'B2')];
    const allGroups = collectAllGroups(nodes, edges);
    expect(allGroups).toEqual([['A1', 'A2']]);
    async function drawing(groups: ResourceGroup[]): Promise<TransitionGraph> {
      const viewGraph = groupGraph(nodes, edges, groups);
      const input = {
        nodes: viewGraph.nodes.map(node => ({
          id: node.id,
          width: NODE_WIDTH,
          height: node.type === 'aggregated' ? AGGREGATED_NODE_HEIGHT : RESOURCE_NODE_LAYOUT_HEIGHT,
        })),
        edges: viewGraph.edges,
      };
      return { ...(await layoutGraph(input)), input, viewGraph };
    }
    const original = await drawing([]);
    const grouped = await drawing(allGroups);
    expect([...original.routes.values()].some(route => route.points.length > 2)).toBe(true);
    let current = original;
    for (let cycle = 1; cycle <= 12; cycle++) {
      const groupPlan = planGroupTransition(current, grouped);
      expect(groupPlan.hasGather).toBe(true);
      const gather = createLayoutInterpolator(current, groupPlan.gathered, {
        preserveRoutePointCorrespondence: true,
      });
      current = { ...current, ...gather(0.5) };
      const ungroupPlan = planGroupTransition(current, original);
      expect(ungroupPlan.hasGather).toBe(false);
      current = {
        ...original,
        ...createLayoutInterpolator(ungroupPlan.nextStartLayout, original)(0.5),
      };
      for (const [id, route] of current.routes) {
        const originalPointCount = original.routes.get(id)!.points.length;
        expect(route.points.length).toBeLessThanOrEqual(
          originalPointCount + cycle * (originalPointCount - 2)
        );
      }
    }
  });

  it('preserves source and destination layouts while planning and interpolating', () => {
    const { previous, next } = transitionPair();
    const before = structuredClone(previous);
    const destination = structuredClone(next);
    for (const layout of [previous, next]) {
      for (const position of layout.positions.values()) Object.freeze(position);
      for (const route of layout.routes.values()) {
        route.points.forEach(Object.freeze);
        Object.freeze(route.points);
        if (route.labelPosition) Object.freeze(route.labelPosition);
        Object.freeze(route);
      }
    }
    const plan = planGroupTransition(previous, next);
    const gather = createLayoutInterpolator(previous, plan.gathered, {
      preserveRoutePointCorrespondence: true,
    });
    const expand = createLayoutInterpolator(plan.nextStartLayout, next);
    gather(0.4);
    expand(0.7);
    expect(previous).toEqual(before);
    expect(next).toEqual(destination);
    expect(expand(1)).toBe(next);
  });
});

function layout(points: XYPosition[], labelPosition?: XYPosition): GraphLayout {
  const route: EdgeRoute = {
    id: 'edge',
    source: 'source',
    target: 'target',
    points,
    labelPosition,
  };
  return {
    positions: new Map([
      ['source', points[0] ?? { x: 0, y: 0 }],
      ['target', points.at(-1) ?? { x: 0, y: 0 }],
    ]),
    routes: new Map([[route.id, route]]),
  };
}

describe('layout interpolation', () => {
  it('preserves known gathering correspondence without assuming equal-length layouts correspond', () => {
    const from = layout([
      { x: 0, y: 0 },
      { x: 0, y: 100 },
      { x: 100, y: 100 },
    ]);
    const to = layout([
      { x: 100, y: 0 },
      { x: 150, y: 0 },
      { x: 150, y: 150 },
    ]);
    expect(createLayoutInterpolator(from, to)(0.5).routes.get('edge')!.points).toHaveLength(4);
    const gather = createLayoutInterpolator(from, to, { preserveRoutePointCorrespondence: true });
    expect(gather(0)).toBe(from);
    expect(gather(1)).toBe(to);
    expect(gather(0.5).routes.get('edge')!.points).toEqual([
      { x: 50, y: 0 },
      { x: 75, y: 50 },
      { x: 125, y: 125 },
    ]);
  });

  it('retains exact endpoint layouts and interpolates differing bends with the same progress as labels and nodes', () => {
    const from = layout(
      [
        { x: 0, y: 0 },
        { x: 0, y: 100 },
        { x: 100, y: 100 },
      ],
      { x: 20, y: 60 }
    );
    const to = layout(
      [
        { x: 100, y: 0 },
        { x: 150, y: 0 },
        { x: 150, y: 150 },
        { x: 200, y: 150 },
      ],
      { x: 180, y: 100 }
    );
    const interpolate = createLayoutInterpolator(from, to);
    expect(interpolate(0)).toBe(from);
    expect(interpolate(1)).toBe(to);
    expect(interpolate(-1)).toBe(from);
    expect(interpolate(2)).toBe(to);
    const middle = interpolate(0.5);
    expect(middle.routes.get('edge')?.points).toEqual([
      { x: 50, y: 0 },
      { x: 75, y: 20 },
      { x: 75, y: 87.5 },
      { x: 105, y: 125 },
      { x: 150, y: 125 },
    ]);
    expect(middle.positions.get('source')).toEqual({ x: 50, y: 0 });
    expect(middle.positions.get('target')).toEqual({ x: 150, y: 125 });
    expect(middle.routes.get('edge')?.labelPosition).toEqual({ x: 100, y: 80 });
  });

  it.each([
    [],
    [{ x: 5, y: 5 }],
    [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 5 },
    ],
    [
      { x: 5, y: 5 },
      { x: 5, y: 5 },
      { x: 5, y: 100 },
      { x: 5, y: 100 },
    ],
  ])('keeps empty and degenerate paths finite: %j', (...points) => {
    const from = layout(points as XYPosition[]);
    const to = layout([
      { x: 20, y: 30 },
      { x: 60, y: 90 },
    ]);
    const interpolate = createLayoutInterpolator(from, to);
    for (const progress of [0.01, 0.5, 0.99]) {
      const result = interpolate(progress);
      expect(result.routes.get('edge')!.points.length).toBeGreaterThanOrEqual(2);
      for (const point of result.routes.get('edge')!.points) {
        expect(Number.isFinite(point.x)).toBe(true);
        expect(Number.isFinite(point.y)).toBe(true);
      }
    }
    expect(interpolate(0)).toBe(from);
  });
});
