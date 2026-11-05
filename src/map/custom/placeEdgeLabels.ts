import type { XYPosition } from '@xyflow/react';
import type { EdgeRoute } from './layoutGraph';
import { EDGE_LABEL_BG_PADDING } from './styles';

// Conservative text bounds for the fixed English label plus the shared background padding.
export const EDGE_LABEL_SIZE = {
  width: 32 + 2 * EDGE_LABEL_BG_PADDING[0],
  height: 16 + 2 * EDGE_LABEL_BG_PADDING[1],
};
const CLEARANCE = 8;

type Box = XYPosition & { width: number; height: number };

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.width && a.x + a.width > b.x && a.y < b.y + b.height && a.y + a.height > b.y;
}

/** Places labels on free straight segments, returning undefined when the layout needs more room. */
export function placeEdgeLabels(
  nodes: readonly Box[],
  routes: readonly EdgeRoute[]
): Map<string, XYPosition> | undefined {
  const segments = routes.flatMap(route =>
    route.points.slice(1).map((end, index) => {
      const start = route.points[index];
      return {
        edgeId: route.id,
        start,
        end,
        length: Math.hypot(end.x - start.x, end.y - start.y),
        x: Math.min(start.x, end.x),
        y: Math.min(start.y, end.y),
        width: Math.abs(end.x - start.x),
        height: Math.abs(end.y - start.y),
      };
    })
  );
  const placed: Box[] = [];
  const positions = new Map<string, XYPosition>();
  for (const route of routes.filter(route => route.aux)) {
    const routeSegments = segments.filter(segment => segment.edgeId === route.id);
    const middle = routeSegments.reduce((sum, segment) => sum + segment.length, 0) / 2;
    const candidates: { position: XYPosition; distance: number }[] = [];
    let traversed = 0;
    for (const segment of routeSegments) {
      const horizontal = segment.start.y === segment.end.y;
      const axis = horizontal ? 'x' : 'y';
      const across = horizontal ? 'y' : 'x';
      const size = horizontal ? 'width' : 'height';
      const acrossSize = horizontal ? 'height' : 'width';
      const half = EDGE_LABEL_SIZE[size] / 2 + CLEARANCE;
      const halfAcross = EDGE_LABEL_SIZE[acrossSize] / 2 + CLEARANCE;
      const low = segment[axis] + half;
      const high = segment[axis] + segment[size] - half;
      if (low <= high) {
        // The chosen segment passes behind its label; all other segments remain obstacles.
        const obstacles = [...nodes, ...placed, ...segments.filter(other => other !== segment)];
        const direction = Math.sign(segment.end[axis] - segment.start[axis]);
        const preferred = segment.start[axis] + direction * (middle - traversed);
        const coordinates = new Set([Math.max(low, Math.min(high, preferred)), low, high]);
        // Free intervals begin/end at obstacle boundaries, so no pixel-by-pixel search is needed.
        for (const obstacle of obstacles) {
          if (
            obstacle[across] < segment.start[across] + halfAcross &&
            obstacle[across] + obstacle[acrossSize] > segment.start[across] - halfAcross
          ) {
            coordinates.add(obstacle[axis] - half);
            coordinates.add(obstacle[axis] + obstacle[size] + half);
          }
        }
        for (const coordinate of coordinates) {
          if (coordinate < low || coordinate > high) continue;
          const position = { ...segment.start, [axis]: coordinate };
          const box = {
            x: position.x - EDGE_LABEL_SIZE.width / 2 - CLEARANCE,
            y: position.y - EDGE_LABEL_SIZE.height / 2 - CLEARANCE,
            width: EDGE_LABEL_SIZE.width + 2 * CLEARANCE,
            height: EDGE_LABEL_SIZE.height + 2 * CLEARANCE,
          };
          if (!obstacles.some(obstacle => overlaps(box, obstacle))) {
            candidates.push({
              position,
              distance: Math.abs(traversed + Math.abs(coordinate - segment.start[axis]) - middle),
            });
          }
        }
      }
      traversed += segment.length;
    }
    const best = candidates.sort((a, b) => a.distance - b.distance)[0];
    if (!best) return undefined;
    positions.set(route.id, best.position);
    placed.push({
      x: best.position.x - EDGE_LABEL_SIZE.width / 2,
      y: best.position.y - EDGE_LABEL_SIZE.height / 2,
      ...EDGE_LABEL_SIZE,
    });
  }
  return positions;
}
