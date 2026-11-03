import type { XYPosition } from '@xyflow/react';
import ELK from 'elkjs/lib/elk.bundled.js';
import type { ElkNode } from 'elkjs/lib/elk-api';
import type { GraphEdge } from '../common/types';
import { compactComponents, COMPONENT_SPACING } from './compactComponents';
import { EDGE_LABEL_SIZE, placeEdgeLabels } from './placeEdgeLabels';
import { AUX_HANDLE_OFFSET } from './styles';

export type GraphLayoutInput = {
  nodes: ReadonlyArray<{ id: string; width: number; height: number }>;
  edges: ReadonlyArray<GraphEdge>;
};

const elk = new ELK();

export type EdgeRoute = GraphEdge & {
  points: XYPosition[];
  labelPosition?: XYPosition;
};

export type GraphLayout = {
  positions: Map<string, XYPosition>;
  routes: Map<string, EdgeRoute>;
};

/** Routes relationships around cards and fits labels into the available space when possible. */
export async function layoutGraph(input: GraphLayoutInput): Promise<GraphLayout> {
  let layout = await routeGraph(input, false);
  const labels = placeEdgeLabels(
    input.nodes.map(node => ({ ...node, ...layout.positions.get(node.id)! })),
    [...layout.routes.values()]
  );
  // Dense routes may leave no free label position; let ELK reserve space for every label instead.
  if (!labels) layout = await routeGraph(input, true);
  else for (const [id, position] of labels) layout.routes.get(id)!.labelPosition = position;
  compactComponents(input, layout);
  return layout;
}

async function routeGraph(
  { nodes, edges }: GraphLayoutInput,
  includeLabels: boolean
): Promise<GraphLayout> {
  const layout = await elk.layout<ElkNode>({
    id: 'root',
    layoutOptions: {
      'elk.algorithm': 'layered',
      'elk.direction': 'DOWN',
      'elk.edgeRouting': 'ORTHOGONAL',
      'elk.layered.spacing.nodeNodeBetweenLayers': '160',
      'elk.spacing.nodeNode': '120',
      'elk.spacing.componentComponent': String(COMPONENT_SPACING),
      'elk.spacing.edgeNode': '24',
      'elk.spacing.edgeEdge': '16',
      'elk.layered.spacing.edgeNodeBetweenLayers': '24',
      'elk.layered.spacing.edgeEdgeBetweenLayers': '16',
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
    },
    children: nodes.map(node => ({
      ...node,
      layoutOptions: { 'elk.portConstraints': 'FIXED_POS' },
      ports: [
        { id: 'source', x: node.width / 2, y: node.height, side: 'SOUTH' },
        { id: 'target', x: node.width / 2, y: 0, side: 'NORTH' },
        { id: 'aux-source', x: node.width / 2 + AUX_HANDLE_OFFSET, y: node.height, side: 'SOUTH' },
        { id: 'aux-target', x: node.width / 2 + AUX_HANDLE_OFFSET, y: 0, side: 'NORTH' },
      ].map(port => ({
        id: `${node.id}:${port.id}`,
        x: port.x,
        y: port.y,
        width: 0,
        height: 0,
        layoutOptions: { 'elk.port.side': port.side },
      })),
    })),
    // Include additional references even when collapsed so visibility does not move the graph.
    edges: edges.map(edge => ({
      id: edge.id,
      sources: [`${edge.source}:${edge.aux ? 'aux-source' : 'source'}`],
      targets: [`${edge.target}:${edge.aux ? 'aux-target' : 'target'}`],
      layoutOptions: { 'elk.priority': edge.aux ? '0' : '10' },
      labels: includeLabels && edge.aux ? [{ text: 'infers', ...EDGE_LABEL_SIZE }] : undefined,
    })),
  });

  const positions = new Map((layout.children ?? []).map(c => [c.id, { x: c.x ?? 0, y: c.y ?? 0 }]));

  const routedEdges = new Map((layout.edges ?? []).map(edge => [edge.id, edge]));
  const routes = new Map<string, EdgeRoute>();
  for (const edge of edges) {
    const routed = routedEdges.get(edge.id);
    const section = routed?.sections?.[0];
    if (!section) throw new Error(`Could not route relationship ${edge.id}.`);
    const label = routed?.labels?.[0];
    routes.set(edge.id, {
      ...edge,
      points: [section.startPoint, ...(section.bendPoints ?? []), section.endPoint],
      labelPosition:
        label?.x !== undefined && label.y !== undefined
          ? { x: label.x + (label.width ?? 0) / 2, y: label.y + (label.height ?? 0) / 2 }
          : undefined,
    });
  }

  return { positions, routes };
}
