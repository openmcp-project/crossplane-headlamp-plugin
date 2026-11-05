import { BaseEdge, Edge, EdgeProps, XYPosition } from '@xyflow/react';
import type { EdgeRoute } from './layoutGraph';

export function RoutedEdge({
  data,
  sourceX,
  sourceY,
  targetX,
  targetY,
  markerStart,
  markerEnd,
  style,
  label,
  labelShowBg,
  labelBgPadding,
  labelBgBorderRadius,
}: EdgeProps<Edge<EdgeRoute>>) {
  if (!data) return null;
  // Fixed-width cards fit the reserved height; NORTH/SOUTH ports keep terminal adjustments vertical.
  const points = [
    { x: sourceX, y: sourceY },
    ...data.points.slice(1, -1),
    { x: targetX, y: targetY },
  ];
  return (
    <BaseEdge
      path={roundedPath(points)}
      markerStart={markerStart}
      markerEnd={markerEnd}
      style={style}
      label={label}
      labelX={data.labelPosition?.x}
      labelY={data.labelPosition?.y}
      labelShowBg={labelShowBg}
      labelBgPadding={labelBgPadding}
      labelBgBorderRadius={labelBgBorderRadius}
    />
  );
}

function roundedPath(points: XYPosition[]) {
  let path = `M ${points[0].x} ${points[0].y}`;
  for (let i = 1; i < points.length - 1; i++) {
    const previous = points[i - 1];
    const point = points[i];
    const next = points[i + 1];
    const incoming = Math.hypot(point.x - previous.x, point.y - previous.y);
    const outgoing = Math.hypot(next.x - point.x, next.y - point.y);
    if (!incoming || !outgoing) {
      path += ` L ${point.x} ${point.y}`;
      continue;
    }
    // Keep rounding inside the clearance reserved by ELK, including short segments.
    const radius = Math.min(8, incoming / 2, outgoing / 2);
    const before = {
      x: point.x + ((previous.x - point.x) * radius) / incoming,
      y: point.y + ((previous.y - point.y) * radius) / incoming,
    };
    const after = {
      x: point.x + ((next.x - point.x) * radius) / outgoing,
      y: point.y + ((next.y - point.y) * radius) / outgoing,
    };
    path += ` L ${before.x} ${before.y} Q ${point.x} ${point.y} ${after.x} ${after.y}`;
  }
  const end = points[points.length - 1];
  return `${path} L ${end.x} ${end.y}`;
}
