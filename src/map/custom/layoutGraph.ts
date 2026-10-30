import type { XYPosition } from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { GraphEdge } from '../common/types';

export type GraphLayoutInput = {
  nodes: ReadonlyArray<{ id: string; width: number; height: number }>;
  edges: ReadonlyArray<GraphEdge>;
};

const elk = new ELK();

/** Positions resource cards without retaining their current data or presentation. */
export async function layoutGraph({
  nodes,
  edges,
}: GraphLayoutInput): Promise<Map<string, XYPosition>> {
  const layout = await elk.layout({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '160',
      'elk.spacing.nodeNode': '120',
      'elk.spacing.componentComponent': '160',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: nodes.map(node => ({ ...node })),
    // Parent edges drive the layering; aux edges get a low priority so they
    // don't pull nodes out of the parent hierarchy (ui-frontend parity). Aux
    // edges stay in the layout even when hidden, so toggling them never shifts
    // node positions.
    edges: edges.map(e => ({
      id: e.id,
      sources: [e.source],
      targets: [e.target],
      layoutOptions: { 'elk.priority': e.aux ? '0' : '10' },
    })),
  });

  const positions = new Map((layout.children ?? []).map(c => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));

  return new Map(nodes.map(node => [node.id, positions.get(node.id) ?? { x: 0, y: 0 }]));
}
