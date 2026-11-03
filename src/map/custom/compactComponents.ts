import type { EdgeRoute, GraphLayout, GraphLayoutInput } from './layoutGraph';
import { EDGE_LABEL_SIZE } from './placeEdgeLabels';

export const COMPONENT_SPACING = 64;

/** Moves whole components upward into free space while preserving their horizontal placement. */
export function compactComponents(input: GraphLayoutInput, layout: GraphLayout): void {
  const neighbors = new Map(input.nodes.map(node => [node.id, [] as string[]]));
  for (const edge of input.edges) {
    neighbors.get(edge.source)!.push(edge.target);
    neighbors.get(edge.target)!.push(edge.source);
  }

  type Component = {
    nodeIds: string[];
    routes: EdgeRoute[];
    left: number;
    right: number;
    top: number;
    bottom: number;
  };
  const components: Component[] = [];
  const componentByNode = new Map<string, Component>();
  for (const node of input.nodes) {
    if (componentByNode.has(node.id)) continue;
    const component: Component = {
      nodeIds: [],
      routes: [],
      left: Infinity,
      right: -Infinity,
      top: Infinity,
      bottom: -Infinity,
    };
    const pending = [node.id];
    componentByNode.set(node.id, component);
    while (pending.length) {
      const id = pending.pop()!;
      component.nodeIds.push(id);
      for (const neighbor of neighbors.get(id)!) {
        if (componentByNode.has(neighbor)) continue;
        componentByNode.set(neighbor, component);
        pending.push(neighbor);
      }
    }
    components.push(component);
  }

  function include(component: Component, x: number, y: number, width = 0, height = 0) {
    component.left = Math.min(component.left, x);
    component.right = Math.max(component.right, x + width);
    component.top = Math.min(component.top, y);
    component.bottom = Math.max(component.bottom, y + height);
  }
  for (const node of input.nodes) {
    const position = layout.positions.get(node.id)!;
    include(componentByNode.get(node.id)!, position.x, position.y, node.width, node.height);
  }
  for (const route of layout.routes.values()) {
    const component = componentByNode.get(route.source)!;
    component.routes.push(route);
    for (const point of route.points) include(component, point.x, point.y);
    if (route.labelPosition) {
      include(
        component,
        route.labelPosition.x - EDGE_LABEL_SIZE.width / 2,
        route.labelPosition.y - EDGE_LABEL_SIZE.height / 2,
        EDGE_LABEL_SIZE.width,
        EDGE_LABEL_SIZE.height
      );
    }
  }

  // ELK packs components into separate rectangles; retain their order when closing vertical gaps.
  components.sort((a, b) => a.top - b.top || a.left - b.left);
  const top = components[0]?.top ?? 0;
  for (let i = 0; i < components.length; i++) {
    const component = components[i];
    let targetTop = top;
    for (let j = 0; j < i; j++) {
      const previous = components[j];
      if (
        previous.left < component.right + COMPONENT_SPACING &&
        previous.right + COMPONENT_SPACING > component.left
      ) {
        targetTop = Math.max(targetTop, previous.bottom + COMPONENT_SPACING);
      }
    }
    // Existing routing can extend past a component's cards; never push a component downward.
    const offset = Math.min(0, targetTop - component.top);
    if (!offset) continue;
    for (const id of component.nodeIds) {
      const position = layout.positions.get(id)!;
      layout.positions.set(id, { x: position.x, y: position.y + offset });
    }
    for (const route of component.routes) {
      route.points = route.points.map(point => ({ x: point.x, y: point.y + offset }));
      if (route.labelPosition) {
        route.labelPosition = {
          x: route.labelPosition.x,
          y: route.labelPosition.y + offset,
        };
      }
    }
    component.top += offset;
    component.bottom += offset;
  }
}
