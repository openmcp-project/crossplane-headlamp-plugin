import type { XYPosition } from '@xyflow/react';
import type { groupGraph, ViewNode } from './groupGraph';
import type { EdgeRoute, GraphLayout, GraphLayoutInput } from './layoutGraph';

export type TransitionGraph = GraphLayout & {
  input: GraphLayoutInput;
  viewGraph: ReturnType<typeof groupGraph>;
};

export function planGroupTransition(
  previous: TransitionGraph,
  next: TransitionGraph,
  anchorNodeId?: string
): { gathered: GraphLayout; nextStartLayout: GraphLayout; hasGather: boolean } {
  const previousSizes = new Map(previous.input.nodes.map(node => [node.id, node]));
  const nextSizes = new Map(next.input.nodes.map(node => [node.id, node]));
  const previousRepresentative = new Map(
    previous.viewGraph.nodes.flatMap(node => memberIds(node).map(id => [id, node.id] as const))
  );
  const previousIdsByNextId = new Map<string, string[]>();
  const nextIdsByPreviousId = new Map<string, Set<string>>();
  for (const node of next.viewGraph.nodes) {
    const sources = [
      ...new Set(
        memberIds(node)
          .map(id => previousRepresentative.get(id))
          .filter((id): id is string => !!id && previous.positions.has(id))
      ),
    ];
    previousIdsByNextId.set(node.id, sources);
    for (const id of sources) {
      if (!nextIdsByPreviousId.has(id)) nextIdsByPreviousId.set(id, new Set());
      nextIdsByPreviousId.get(id)!.add(node.id);
    }
  }

  const gatheredPositions = new Map(previous.positions);
  const anchors = new Map<string, XYPosition>();
  let hasGather = false;
  for (const node of next.viewGraph.nodes) {
    const sources = previousIdsByNextId.get(node.id)!;
    if (node.type !== 'aggregated' || previous.positions.has(node.id) || sources.length < 2) {
      continue;
    }
    // A representative split between several new groups cannot converge to several anchors.
    if (sources.some(id => nextIdsByPreviousId.get(id)!.size > 1)) continue;
    const centers = sources.map(id => center(previous.positions.get(id)!, previousSizes.get(id)!));
    const anchorIndex = anchorNodeId ? sources.indexOf(anchorNodeId) : -1;
    const anchor = anchorIndex >= 0 ? centers[anchorIndex] : mean(centers);
    anchors.set(node.id, anchor);
    for (const id of sources) {
      const position = fromCenter(anchor, previousSizes.get(id)!);
      const original = previous.positions.get(id)!;
      if (position.x !== original.x || position.y !== original.y) hasGather = true;
      gatheredPositions.set(id, position);
    }
  }
  const gathered: GraphLayout = {
    positions: gatheredPositions,
    routes: new Map(
      [...previous.routes].map(([id, route]) => [
        id,
        displaceRoute(
          route,
          difference(gatheredPositions.get(route.source)!, previous.positions.get(route.source)!),
          difference(gatheredPositions.get(route.target)!, previous.positions.get(route.target)!)
        ),
      ])
    ),
  };

  const nextStartPositions = new Map<string, XYPosition>();
  for (const [id, target] of next.positions) {
    const unchanged = previous.positions.get(id);
    const sources = previousIdsByNextId.get(id) ?? [];
    const origin =
      anchors.get(id) ??
      (sources.length
        ? mean(
            sources.map(source =>
              center(gatheredPositions.get(source)!, previousSizes.get(source)!)
            )
          )
        : undefined);
    // Keep the clicked card's top-left corner stable when the aggregate replaces it.
    const clickedPosition =
      anchorNodeId && sources.includes(anchorNodeId) && anchors.has(id)
        ? previous.positions.get(anchorNodeId)
        : undefined;
    nextStartPositions.set(
      id,
      unchanged ?? clickedPosition ?? (origin ? fromCenter(origin, nextSizes.get(id)!) : target)
    );
  }

  const previousRoutesBySource = new Map<string, EdgeRoute[]>();
  const previousRoutesByTarget = new Map<string, EdgeRoute[]>();
  for (const route of [...gathered.routes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
    if (!previousRoutesBySource.has(route.source)) previousRoutesBySource.set(route.source, []);
    previousRoutesBySource.get(route.source)!.push(route);
    if (!previousRoutesByTarget.has(route.target)) previousRoutesByTarget.set(route.target, []);
    previousRoutesByTarget.get(route.target)!.push(route);
  }
  // Reuse adjacency buckets across splits without expanding member pairs or recounting per edge.
  const previousRouteCandidatesByNextId = new Map(
    [...previousIdsByNextId].map(([id, previousIds]) => {
      const outgoing = previousIds.flatMap(id => {
        const routes = previousRoutesBySource.get(id);
        return routes ? [routes] : [];
      });
      const incoming = previousIds.flatMap(id => {
        const routes = previousRoutesByTarget.get(id);
        return routes ? [routes] : [];
      });
      return [
        id,
        {
          outgoing,
          incoming,
          outgoingCount: outgoing.reduce((sum, routes) => sum + routes.length, 0),
          incomingCount: incoming.reduce((sum, routes) => sum + routes.length, 0),
        },
      ] as const;
    })
  );
  const nextStartRoutes = new Map<string, EdgeRoute>();
  for (const [id, route] of next.routes) {
    const sourceDelta = difference(
      nextStartPositions.get(route.source)!,
      next.positions.get(route.source)!
    );
    const targetDelta = difference(
      nextStartPositions.get(route.target)!,
      next.positions.get(route.target)!
    );
    const fallback = displaceRoute(route, sourceDelta, targetDelta);
    const sourceCandidates = previousRouteCandidatesByNextId.get(route.source)!;
    const targetCandidates = previousRouteCandidatesByNextId.get(route.target)!;
    const inherited = findInheritedRoute(
      route,
      gathered.routes.get(id),
      sourceCandidates.outgoingCount <= targetCandidates.incomingCount
        ? sourceCandidates.outgoing
        : targetCandidates.incoming,
      nextIdsByPreviousId
    );
    if (!inherited?.points.length || !fallback.points.length) {
      nextStartRoutes.set(id, fallback);
      continue;
    }
    const moved = displaceRoute(
      inherited,
      difference(fallback.points[0], inherited.points[0]),
      difference(
        fallback.points[fallback.points.length - 1],
        inherited.points[inherited.points.length - 1]
      )
    );
    nextStartRoutes.set(id, {
      ...route,
      points: moved.points,
      labelPosition: moved.labelPosition ?? fallback.labelPosition,
    });
  }

  return {
    gathered,
    nextStartLayout: { positions: nextStartPositions, routes: nextStartRoutes },
    hasGather,
  };
}

function findInheritedRoute(
  route: EdgeRoute,
  sameId: EdgeRoute | undefined,
  candidateBuckets: EdgeRoute[][],
  nextIdsByPreviousId: Map<string, Set<string>>
): EdgeRoute | undefined {
  const matches = (previousRoute: EdgeRoute) =>
    nextIdsByPreviousId.get(previousRoute.source)?.has(route.source) &&
    nextIdsByPreviousId.get(previousRoute.target)?.has(route.target) &&
    !!previousRoute.aux === !!route.aux;
  if (sameId && matches(sameId)) return sameId;
  let inherited: EdgeRoute | undefined;
  for (const routes of candidateBuckets) {
    const candidate = routes.find(matches);
    if (candidate && (!inherited || candidate.id.localeCompare(inherited.id) < 0)) {
      inherited = candidate;
    }
  }
  return inherited;
}

export function createLayoutInterpolator(
  from: GraphLayout,
  to: GraphLayout,
  { preserveRoutePointCorrespondence = false }: { preserveRoutePointCorrespondence?: boolean } = {}
) {
  const positions = [...to.positions].map(([id, end]) => ({
    id,
    start: from.positions.get(id) ?? end,
    end,
  }));
  const routes = [...to.routes].map(([id, end]) => {
    const start = from.routes.get(id) ?? end;
    let starts = start.points;
    let ends = end.points;
    // Gathering displaces existing points; resampling them would multiply samples on interruption.
    if (!preserveRoutePointCorrespondence || starts.length !== ends.length || starts.length < 2) {
      const startFractions = pathFractions(starts);
      const endFractions = pathFractions(ends);
      // Keep every original corner: index matching alone cuts across unequal polylines.
      const fractions = [...new Set([0, ...startFractions, ...endFractions, 1])].sort(
        (a, b) => a - b
      );
      starts = samplePath(starts, startFractions, fractions);
      ends = samplePath(ends, endFractions, fractions);
    }
    return {
      id,
      end,
      starts,
      ends,
      labelStart: start.labelPosition ?? end.labelPosition,
      labelEnd: end.labelPosition ?? start.labelPosition,
    };
  });

  return (progress: number): GraphLayout => {
    if (!(progress > 0)) return from;
    if (progress >= 1) return to;
    return {
      positions: new Map(
        positions.map(({ id, start, end }) => [id, interpolate(start, end, progress)])
      ),
      routes: new Map(
        routes.map(({ id, end, starts, ends, labelStart, labelEnd }) => [
          id,
          {
            ...end,
            points: starts.map((point, index) => interpolate(point, ends[index], progress)),
            labelPosition:
              labelStart && labelEnd ? interpolate(labelStart, labelEnd, progress) : undefined,
          },
        ])
      ),
    };
  };
}

function memberIds(node: ViewNode): string[] {
  return node.type === 'resource' ? [node.id] : node.members.map(member => member.id);
}

function center(position: XYPosition, size: { width: number; height: number }): XYPosition {
  return { x: position.x + size.width / 2, y: position.y + size.height / 2 };
}

function fromCenter(position: XYPosition, size: { width: number; height: number }): XYPosition {
  return { x: position.x - size.width / 2, y: position.y - size.height / 2 };
}

function mean(points: XYPosition[]): XYPosition {
  return {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };
}

function difference(a: XYPosition, b: XYPosition): XYPosition {
  return { x: a.x - b.x, y: a.y - b.y };
}

function interpolate(a: XYPosition, b: XYPosition, progress: number): XYPosition {
  return { x: a.x + (b.x - a.x) * progress, y: a.y + (b.y - a.y) * progress };
}

function pathFractions(points: XYPosition[]): number[] {
  let length = 0;
  const distances = points.map((point, index) => {
    if (index) length += Math.hypot(point.x - points[index - 1].x, point.y - points[index - 1].y);
    return length;
  });
  return distances.map((distance, index) =>
    length ? distance / length : index / Math.max(1, points.length - 1)
  );
}

function samplePath(points: XYPosition[], fractions: number[], samples: number[]): XYPosition[] {
  let end = 0;
  return samples.map(fraction => {
    if (!points.length) return { x: 0, y: 0 };
    // Both fractions and samples are ordered, so each segment is visited only once.
    while (end < fractions.length && fractions[end] < fraction) end++;
    if (end === 0) return points[0];
    if (end === fractions.length) return points[points.length - 1];
    const span = fractions[end] - fractions[end - 1];
    return interpolate(
      points[end - 1],
      points[end],
      span ? (fraction - fractions[end - 1]) / span : 0
    );
  });
}

function labelFraction(points: XYPosition[], fractions: number[], label: XYPosition): number {
  let closestDistance = Infinity;
  let closestFraction = 0.5;
  for (let i = 1; i < points.length; i++) {
    const start = points[i - 1];
    const delta = difference(points[i], start);
    const squaredLength = delta.x ** 2 + delta.y ** 2;
    if (!squaredLength) continue;
    const progress = Math.max(
      0,
      Math.min(1, ((label.x - start.x) * delta.x + (label.y - start.y) * delta.y) / squaredLength)
    );
    const projection = interpolate(start, points[i], progress);
    const distance = (label.x - projection.x) ** 2 + (label.y - projection.y) ** 2;
    if (distance < closestDistance) {
      closestDistance = distance;
      closestFraction = fractions[i - 1] + (fractions[i] - fractions[i - 1]) * progress;
    }
  }
  return closestFraction;
}

function displaceRoute(
  route: EdgeRoute,
  sourceDelta: XYPosition,
  targetDelta: XYPosition
): EdgeRoute {
  if (!sourceDelta.x && !sourceDelta.y && !targetDelta.x && !targetDelta.y) return route;
  const points = route.points.length === 1 ? [route.points[0], route.points[0]] : route.points;
  const fractions = pathFractions(points);
  const move = (point: XYPosition, fraction: number) => {
    const delta = interpolate(sourceDelta, targetDelta, fraction);
    return { x: point.x + delta.x, y: point.y + delta.y };
  };
  return {
    ...route,
    points: points.map((point, index) => move(point, fractions[index])),
    labelPosition: route.labelPosition
      ? move(route.labelPosition, labelFraction(points, fractions, route.labelPosition))
      : undefined,
  };
}
