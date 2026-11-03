import { describe, expect, it } from 'vitest';
import { compactComponents } from './compactComponents';
import type { EdgeRoute, GraphLayout, GraphLayoutInput } from './layoutGraph';

function fixture(
  nodes: Array<{ id: string; x: number; y: number; width?: number; height?: number }>,
  routes: EdgeRoute[] = []
): { input: GraphLayoutInput; layout: GraphLayout } {
  return {
    input: {
      nodes: nodes.map(({ id, width = 264, height = 156 }) => ({ id, width, height })),
      edges: routes.map(({ id, source, target, aux }) => ({ id, source, target, aux })),
    },
    layout: {
      positions: new Map(nodes.map(({ id, x, y }) => [id, { x, y }])),
      routes: new Map(routes.map(route => [route.id, route])),
    },
  };
}

describe('component compaction', () => {
  it('lifts two lower groups beneath short cards without moving a tall group beside them', () => {
    const routes: EdgeRoute[] = [
      ...[0, 1, 2].map(index => ({
        id: `tall-${index}`,
        source: `tall-${index}`,
        target: `tall-${index + 1}`,
        points: [
          { x: 1932, y: 168 + index * 316 },
          { x: 1932, y: 328 + index * 316 },
        ],
      })),
      ...[12, 900].map((x, index) => ({
        id: `lower-${index}`,
        source: `root-${index}`,
        target: `child-${index}`,
        points: [
          { x: x + 132, y: 1432 },
          { x: x + 132, y: 1512 },
          { x: x + 516, y: 1512 },
          { x: x + 516, y: 1592 },
        ],
        labelPosition: { x: x + 324, y: 1512 },
      })),
    ];
    const { input, layout } = fixture(
      [
        ...[12, 900].flatMap((x, index) => [
          { id: `root-${index}`, x, y: 1276 },
          { id: `child-${index}`, x: x + 384, y: 1592 },
          { id: `single-${index}`, x, y: 12 },
        ]),
        ...[0, 1, 2, 3].map(index => ({ id: `tall-${index}`, x: 1800, y: 12 + index * 316 })),
      ],
      routes
    );
    const before = structuredClone(layout);

    compactComponents(input, layout);

    for (const index of [0, 1]) {
      expect(layout.positions.get(`root-${index}`)!.y).toBe(328);
      expect(layout.positions.get(`child-${index}`)!.y).toBe(644);
    }
    for (const [id, position] of before.positions) {
      const dy = id.startsWith('root-') || id.startsWith('child-') ? -948 : 0;
      expect(layout.positions.get(id)).toEqual({ x: position.x, y: position.y + dy });
    }
    for (const [id, route] of before.routes) {
      const dy = id.startsWith('lower-') ? -948 : 0;
      expect(layout.routes.get(id)!.points).toEqual(
        route.points.map(point => ({ x: point.x, y: point.y + dy }))
      );
      if (route.labelPosition) {
        expect(layout.routes.get(id)!.labelPosition).toEqual({
          x: route.labelPosition.x,
          y: route.labelPosition.y + dy,
        });
      }
    }
  });

  it.each([
    { obstacle: 'route detour', x: 480, labelPosition: undefined, expectedTop: 520 },
    { obstacle: 'label bounds', x: 520, labelPosition: { x: 350, y: 360 }, expectedTop: 532 },
  ])('reserves space for $obstacle outside the cards', ({ x, labelPosition, expectedTop }) => {
    const { input, layout } = fixture(
      [
        { id: 'source', x: 0, y: 20, width: 100, height: 100 },
        { id: 'target', x: 0, y: 200, width: 100, height: 100 },
        { id: 'lower', x, y: 1000, width: 100, height: 100 },
      ],
      [
        {
          id: 'reference',
          source: 'source',
          target: 'target',
          aux: true,
          points: [
            { x: 50, y: 120 },
            { x: 350, y: 120 },
            { x: 350, y: 360 },
            { x: 50, y: 360 },
            { x: 50, y: 200 },
          ],
          labelPosition,
        },
      ]
    );

    compactComponents(input, layout);

    expect(layout.positions.get('lower')).toEqual({ x, y: expectedTop });
  });

  it('keeps an auxiliary-only cycle together when lifting it', () => {
    const { input, layout } = fixture(
      [
        { id: 'a', x: 0, y: 500, width: 100, height: 100 },
        { id: 'b', x: 400, y: 800, width: 100, height: 100 },
        { id: 'c', x: 800, y: 500, width: 100, height: 100 },
        { id: 'anchor', x: 1600, y: 40 },
      ],
      [
        {
          id: 'ab',
          source: 'a',
          target: 'b',
          aux: true,
          points: [
            { x: 50, y: 600 },
            { x: 50, y: 700 },
            { x: 450, y: 700 },
            { x: 450, y: 800 },
          ],
          labelPosition: { x: 250, y: 700 },
        },
        {
          id: 'bc',
          source: 'b',
          target: 'c',
          aux: true,
          points: [
            { x: 450, y: 900 },
            { x: 850, y: 900 },
            { x: 850, y: 500 },
          ],
        },
        {
          id: 'ca',
          source: 'c',
          target: 'a',
          aux: true,
          points: [
            { x: 850, y: 600 },
            { x: 850, y: 660 },
            { x: 50, y: 660 },
            { x: 50, y: 500 },
          ],
        },
      ]
    );
    const before = structuredClone(layout);

    compactComponents(input, layout);

    expect([...layout.positions]).toEqual([
      ['a', { x: 0, y: 40 }],
      ['b', { x: 400, y: 340 }],
      ['c', { x: 800, y: 40 }],
      ['anchor', { x: 1600, y: 40 }],
    ]);
    for (const [id, route] of before.routes) {
      expect(layout.routes.get(id)!.points).toEqual(
        route.points.map(point => ({ x: point.x, y: point.y - 460 }))
      );
    }
    expect(layout.routes.get('ab')!.labelPosition).toEqual({ x: 250, y: 240 });
  });

  it.each([
    { gap: 160, expectedTop: 20 },
    { gap: 159, expectedTop: 280 },
  ])(
    'allows side-by-side placement only with sufficient horizontal spacing ($gap)',
    ({ gap, expectedTop }) => {
      const { input, layout } = fixture([
        { id: 'upper', x: 0, y: 20, width: 100, height: 100 },
        { id: 'lower', x: 100 + gap, y: 1000, width: 100, height: 100 },
      ]);

      compactComponents(input, layout);

      expect(layout.positions.get('lower')).toEqual({ x: 100 + gap, y: expectedTop });
    }
  );

  it('never pushes a component downward to enlarge an existing gap', () => {
    const { input, layout } = fixture([
      { id: 'upper', x: 0, y: 20, width: 100, height: 100 },
      { id: 'lower', x: 0, y: 200, width: 100, height: 100 },
    ]);
    const before = structuredClone(layout);

    compactComponents(input, layout);

    expect(layout).toEqual(before);
  });

  it.each([{ nodes: [] }, { nodes: [{ id: 'only', x: 120, y: 80 }] }])(
    'leaves empty and single-node layouts unchanged',
    ({ nodes }) => {
      const { input, layout } = fixture(nodes);
      const before = structuredClone(layout);

      compactComponents(input, layout);

      expect(layout).toEqual(before);
    }
  );
});
