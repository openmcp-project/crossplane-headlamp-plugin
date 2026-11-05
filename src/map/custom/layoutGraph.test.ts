import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GraphLayoutInput, layoutGraph } from './layoutGraph';
import * as labelPlacement from './placeEdgeLabels';
import { AUX_HANDLE_OFFSET } from './styles';

afterEach(() => vi.restoreAllMocks());

function crossesBox(
  a: { x: number; y: number },
  b: { x: number; y: number },
  box: { x: number; y: number; width: number; height: number }
) {
  return a.x === b.x
    ? a.x > box.x &&
        a.x < box.x + box.width &&
        Math.max(a.y, b.y) > box.y &&
        Math.min(a.y, b.y) < box.y + box.height
    : a.y > box.y &&
        a.y < box.y + box.height &&
        Math.max(a.x, b.x) > box.x &&
        Math.min(a.x, b.x) < box.x + box.width;
}

describe('managed graph routing', () => {
  it('keeps equal layer gaps while routing around intermediate cards and placing reference labels', async () => {
    const input: GraphLayoutInput = {
      nodes: ['subaccount', 'manager', 'instance', 'binding'].map(id => ({
        id,
        width: 264,
        height: id === 'instance' ? 176 : 156,
      })),
      edges: [
        { id: 'manager', source: 'subaccount', target: 'manager' },
        { id: 'instance', source: 'manager', target: 'instance' },
        { id: 'binding', source: 'subaccount', target: 'binding' },
        { id: 'reference', source: 'instance', target: 'binding', aux: true },
      ],
    };
    const { positions, routes } = await layoutGraph(input);
    const boxes = input.nodes.map(node => ({ ...node, ...positions.get(node.id)! }));
    expect(
      boxes.slice(1).map((node, index) => node.y - boxes[index].y - boxes[index].height)
    ).toEqual([96, 96, 96]);
    expect(routes.size).toBe(4);
    expect(routes.get('binding')!.points.length).toBeGreaterThan(2);
    for (const edge of input.edges) {
      const route = routes.get(edge.id)!;
      const source = boxes.find(node => node.id === edge.source)!;
      const target = boxes.find(node => node.id === edge.target)!;
      const offset = edge.aux ? AUX_HANDLE_OFFSET : 0;
      expect(route.points[0]).toEqual({
        x: source.x + source.width / 2 + offset,
        y: source.y + source.height,
      });
      expect(route.points[route.points.length - 1]).toEqual({
        x: target.x + target.width / 2 + offset,
        y: target.y,
      });
      for (let i = 1; i < route.points.length; i++) {
        const a = route.points[i - 1];
        const b = route.points[i];
        expect(a.x === b.x || a.y === b.y).toBe(true);
        for (const box of boxes) expect(crossesBox(a, b, box)).toBe(false);
      }
    }
    const label = routes.get('reference')!.labelPosition!;
    expect(label).toBeDefined();
    for (const box of boxes) {
      expect(
        label.x + 24 > box.x &&
          label.x - 24 < box.x + box.width &&
          label.y + 12 > box.y &&
          label.y - 12 < box.y + box.height
      ).toBe(false);
    }
  });

  it('keeps solid and inferred links between the same resources on distinct routes', async () => {
    const { routes } = await layoutGraph({
      nodes: ['parent', 'child'].map(id => ({ id, width: 264, height: 156 })),
      edges: [
        { id: 'parent', source: 'parent', target: 'child' },
        { id: 'reference', source: 'parent', target: 'child', aux: true },
      ],
    });
    const primary = routes.get('parent')!;
    const reference = routes.get('reference')!;
    expect(reference.points[0].x - primary.points[0].x).toBe(AUX_HANDLE_OFFSET);
    expect(
      reference.points[reference.points.length - 1].x - primary.points[primary.points.length - 1].x
    ).toBe(AUX_HANDLE_OFFSET);
    expect(reference.points).not.toEqual(primary.points);
  });

  it('retries ELK with labels when local placement cannot find space', async () => {
    const elkLayout = vi.spyOn(ELK.prototype, 'layout');
    // Force the fallback contract without depending on ELK's initial route geometry.
    const placeLabels = vi.spyOn(labelPlacement, 'placeEdgeLabels').mockReturnValueOnce(undefined);
    const { positions, routes } = await layoutGraph({
      nodes: ['parent', 'child'].map(id => ({ id, width: 264, height: 156 })),
      edges: [
        { id: 'first', source: 'parent', target: 'child', aux: true },
        { id: 'second', source: 'parent', target: 'child', aux: true },
      ],
    });
    expect(placeLabels).toHaveBeenCalledTimes(1);
    expect(elkLayout).toHaveBeenCalledTimes(2);
    const [firstInput, fallbackInput] = elkLayout.mock.calls.map(([input]) => input as ElkNode);
    expect(firstInput.edges!.every(edge => edge.labels === undefined)).toBe(true);
    for (const edge of fallbackInput.edges!) {
      expect(edge.labels).toEqual([
        expect.objectContaining({ text: 'infers', ...labelPlacement.EDGE_LABEL_SIZE }),
      ]);
    }
    expect(routes.size).toBe(2);
    const first = routes.get('first')!;
    const second = routes.get('second')!;
    for (const edge of [first, second]) {
      expect(edge.points[0].y).toBe(positions.get('parent')!.y + 156);
      expect(edge.points[edge.points.length - 1].y).toBe(positions.get('child')!.y);
      expect(edge.labelPosition).toBeDefined();
    }
    expect(
      Math.abs(first.labelPosition!.x - second.labelPosition!.x) >= 48 ||
        Math.abs(first.labelPosition!.y - second.labelPosition!.y) >= 24
    ).toBe(true);
  });
});
