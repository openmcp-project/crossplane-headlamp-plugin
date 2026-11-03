import { describe, expect, it } from 'vitest';
import { GraphLayoutInput, layoutGraph } from './layoutGraph';
import { AUX_HANDLE_OFFSET } from './styles';

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
  it('routes the long Subaccount–Binding link around intermediate cards and reserves reference labels', async () => {
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
});
