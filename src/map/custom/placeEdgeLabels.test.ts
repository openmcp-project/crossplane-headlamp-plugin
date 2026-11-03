import { describe, expect, it } from 'vitest';
import type { EdgeRoute } from './layoutGraph';
import { placeEdgeLabels } from './placeEdgeLabels';

function route(id: string, points: EdgeRoute['points'], aux = true): EdgeRoute {
  return { id, source: 'source', target: 'target', points, aux };
}

const vertical = route('reference', [
  { x: 0, y: 0 },
  { x: 0, y: 200 },
]);

describe('edge label placement', () => {
  it('centers a label in the free gap between cards', () => {
    const labels = placeEdgeLabels(
      [
        { x: -32, y: -40, width: 64, height: 40 },
        { x: -32, y: 200, width: 64, height: 40 },
      ],
      [vertical]
    );
    expect(labels?.get('reference')).toEqual({ x: 0, y: 100 });
  });

  it('slides a label away from a card while keeping it on its route', () => {
    const labels = placeEdgeLabels([{ x: -40, y: 80, width: 80, height: 40 }], [vertical]);
    expect(labels?.get('reference')).toEqual({ x: 0, y: 60 });
  });

  it('leaves clearance around a crossing edge', () => {
    const crossing = route(
      'parent',
      [
        { x: -80, y: 100 },
        { x: 80, y: 100 },
      ],
      false
    );
    const labels = placeEdgeLabels([], [vertical, crossing]);
    expect(labels?.get('reference')).toEqual({ x: 0, y: 80 });
    expect(labels?.has('parent')).toBe(false);
  });

  it('separates labels on nearby parallel edges', () => {
    const neighbor = route('neighbor', [
      { x: 40, y: 0 },
      { x: 40, y: 200 },
    ]);
    const labels = placeEdgeLabels([], [vertical, neighbor]);
    expect(labels?.get('reference')).toEqual({ x: 0, y: 100 });
    expect(labels?.get('neighbor')).toEqual({ x: 40, y: 68 });
  });

  it.each([false, true])(
    'uses a horizontal section clear of the bends (reversed: %s)',
    reversed => {
      const points = [
        { x: 0, y: 0 },
        { x: 0, y: 40 },
        { x: 200, y: 40 },
        { x: 200, y: 80 },
      ];
      const labels = placeEdgeLabels(
        [],
        [route('reference', reversed ? points.reverse() : points)]
      );
      expect(labels?.get('reference')).toEqual({ x: 100, y: 40 });
    }
  );

  it('requests more space when a foreign edge occupies the whole label route', () => {
    expect(
      placeEdgeLabels([], [vertical, { ...vertical, id: 'parent', aux: false }])
    ).toBeUndefined();
  });

  it('requests more space when no straight section fits the label and its clearance', () => {
    const short = route('reference', [
      { x: 0, y: 0 },
      { x: 0, y: 0 },
      { x: 0, y: 30 },
      { x: 30, y: 30 },
    ]);
    expect(placeEdgeLabels([], [short])).toBeUndefined();
  });
});
