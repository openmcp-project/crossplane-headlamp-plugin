import type { XYPosition } from '@xyflow/react';
import type { aggregateGraph, ViewNode } from './aggregateGraph';
import type { EdgeRoute, GraphLayout, GraphLayoutInput } from './layoutGraph';

export type TransitionGraph = GraphLayout & {
  input: GraphLayoutInput;
  viewGraph: ReturnType<typeof aggregateGraph>;
};

type AggregateTransitionPlan = { start: TransitionGraph; target: GraphLayout } & (
  | {
      replacement: 'crossfade';
      incomingSources: Array<{ node: ViewNode; sourceIds: string[] }>;
    }
  | { replacement: 'immediate' }
);

export function planAggregateTransition(
  previous: TransitionGraph,
  next: TransitionGraph,
  anchorNodeId?: string
): AggregateTransitionPlan {
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

  const hasMerges = next.viewGraph.nodes.some(
    node => node.type === 'aggregated' && previousIdsByNextId.get(node.id)!.length > 1
  );
  const hasSplits = [...nextIdsByPreviousId.values()].some(ids => ids.size > 1);
  if (hasMerges && !hasSplits) {
    const nextIdByPreviousId = new Map(
      [...nextIdsByPreviousId].map(([id, ids]) => [id, ids.values().next().value])
    );
    const clickedRepresentative = anchorNodeId && nextIdByPreviousId.get(anchorNodeId);
    const clickedSize = anchorNodeId && previousSizes.get(anchorNodeId);
    const positions = new Map(
      [...previous.positions].map(([id, position]) => {
        const representative = nextIdByPreviousId.get(id);
        const target = representative && next.positions.get(representative);
        if (!target || !representative) return [id, position];
        // Local replacement keeps the clicked card's top-left corner stable on screen.
        const size =
          (representative === clickedRepresentative && clickedSize) ||
          nextSizes.get(representative)!;
        return [
          id,
          representative === id ? target : fromCenter(center(target, size), previousSizes.get(id)!),
        ];
      })
    );
    const routeKey = (source: string | undefined, target: string | undefined, aux?: boolean) =>
      JSON.stringify([source, target, !!aux]);
    const nextRoutes = new Map(
      [...next.routes.values()].map(route => [
        routeKey(route.source, route.target, route.aux),
        route,
      ])
    );
    const routes = new Map(
      [...previous.routes].map(([id, route]) => {
        const target =
          next.routes.get(id) ??
          nextRoutes.get(
            routeKey(
              nextIdByPreviousId.get(route.source),
              nextIdByPreviousId.get(route.target),
              route.aux
            )
          );
        return [
          id,
          // Keep member cards and their edge identities until they reach the aggregate layout.
          target
            ? { ...route, points: target.points, labelPosition: target.labelPosition }
            : displaceRoute(
                route,
                difference(positions.get(route.source)!, previous.positions.get(route.source)!),
                difference(positions.get(route.target)!, previous.positions.get(route.target)!)
              ),
        ];
      })
    );
    return {
      start: previous,
      target: { positions, routes },
      replacement: 'crossfade',
      incomingSources: next.viewGraph.nodes
        .filter(node => !previous.positions.has(node.id))
        .map(node => ({ node, sourceIds: previousIdsByNextId.get(node.id)! })),
    };
  }

  const nextStartPositions = new Map<string, XYPosition>();
  for (const [id, target] of next.positions) {
    const unchanged = previous.positions.get(id);
    const sources = previousIdsByNextId.get(id) ?? [];
    const origin = sources.length
      ? mean(
          sources.map(source => center(previous.positions.get(source)!, previousSizes.get(source)!))
        )
      : undefined;
    const clickedPosition =
      anchorNodeId && sources.includes(anchorNodeId)
        ? previous.positions.get(anchorNodeId)
        : undefined;
    nextStartPositions.set(
      id,
      unchanged ?? clickedPosition ?? (origin ? fromCenter(origin, nextSizes.get(id)!) : target)
    );
  }

  const previousRoutesBySource = new Map<string, EdgeRoute[]>();
  const previousRoutesByTarget = new Map<string, EdgeRoute[]>();
  for (const route of [...previous.routes.values()].sort((a, b) => a.id.localeCompare(b.id))) {
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
      previous.routes.get(id),
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
    start: { ...next, positions: nextStartPositions, routes: nextStartRoutes },
    target: next,
    replacement: 'immediate',
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

export function createLayoutInterpolator(from: GraphLayout, to: GraphLayout) {
  const positions = [...to.positions].map(([id, end]) => ({
    id,
    start: from.positions.get(id) ?? end,
    end,
  }));
  const routes = [...to.routes].map(([id, end]) => {
    const start = from.routes.get(id) ?? end;
    const startFractions = pathFractions(start.points);
    const endFractions = pathFractions(end.points);
    // Keep every original corner: index matching alone cuts across unequal polylines.
    const fractions = [...new Set([0, ...startFractions, ...endFractions, 1])].sort(
      (a, b) => a - b
    );
    const starts = samplePath(start.points, startFractions, fractions);
    const ends = samplePath(end.points, endFractions, fractions);
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
