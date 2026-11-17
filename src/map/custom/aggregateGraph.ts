import type { GraphEdge, GraphNode } from '../common/types';

export type ViewNode =
  | { id: string; type: 'resource'; resource: GraphNode }
  | { id: string; type: 'aggregated'; kind: string; members: GraphNode[] };

export type ResourceAggregate = ReadonlyArray<string>;
export type AggregationCandidate = { viewNodeIds: string[]; members: GraphNode[] };

export function aggregateGraph(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  aggregates: ReadonlyArray<ResourceAggregate>,
  matchingIds?: ReadonlySet<string>,
  reaggregateHistory: ReadonlyArray<ResourceAggregate> = []
): { nodes: ViewNode[]; edges: GraphEdge[]; candidates: Map<string, AggregationCandidate> } {
  const resourcesById = new Map(nodes.map(node => [node.id, node]));
  const resourceTypeById = new Map(
    nodes.map(resource => {
      const item = resource.kubeObject?.jsonData ?? resource.kubeObject;
      const kind: string = item?.kind ?? resource.kubeObject?._kind ?? '';
      const apiVersion: string = item?.apiVersion ?? '';
      const apiGroup = apiVersion.includes('/') ? apiVersion.split('/')[0] : '';
      return [resource.id, { kind, key: kind ? JSON.stringify([apiGroup, kind]) : null }];
    })
  );
  const matchingReaggregateMembers = reaggregateHistory
    .map(
      expanded =>
        new Set(
          expanded.filter(id => resourcesById.has(id) && (!matchingIds || matchingIds.has(id)))
        )
    )
    .filter(members => members.size > 1);
  const aggregateByResourceId = new Map<string, number>();
  aggregates.forEach((members, index) => {
    for (const id of members) {
      if (!aggregateByResourceId.has(id)) aggregateByResourceId.set(id, index);
    }
  });
  const childrenById = new Map<string, Set<string>>();
  const hasParent = new Set<string>();
  for (const edge of edges) {
    if (edge.aux || edge.source === edge.target) continue;
    if (!resourcesById.has(edge.source) || !resourcesById.has(edge.target)) continue;
    if (!childrenById.has(edge.source)) childrenById.set(edge.source, new Set());
    childrenById.get(edge.source)!.add(edge.target);
    hasParent.add(edge.target);
  }

  const visitedIds = new Set<string>();
  const visibleByResourceId = new Map<string, ViewNode>();
  const candidates = new Map<string, AggregationCandidate>();

  function visitSiblings(ids: Iterable<string>) {
    const structuralBuckets: GraphNode[][] = [];
    const bucketByAggregateAndType = new Map<string, GraphNode[]>();
    for (const id of new Set(ids)) {
      if (visitedIds.has(id)) continue;
      visitedIds.add(id);
      const resource = resourcesById.get(id)!;
      const resourceType = resourceTypeById.get(id)!;
      const aggregate = aggregateByResourceId.get(id);
      if (aggregate === undefined || !resourceType.key) {
        structuralBuckets.push([resource]);
        continue;
      }
      // Separate explicit aggregates stay separate when their parents are merged.
      const key = JSON.stringify([aggregate, resourceType.key]);
      let bucket = bucketByAggregateAndType.get(key);
      if (!bucket) {
        bucket = [];
        bucketByAggregateAndType.set(key, bucket);
        structuralBuckets.push(bucket);
      }
      bucket.push(resource);
    }

    const visibleSiblings: ViewNode[] = structuralBuckets.flatMap(bucket => {
      const visibleMembers = matchingIds
        ? bucket.filter(member => matchingIds.has(member.id))
        : bucket;
      if (!visibleMembers.length) return [];
      let node: ViewNode;
      if (visibleMembers.length === 1) {
        node = { id: visibleMembers[0].id, type: 'resource', resource: visibleMembers[0] };
      } else {
        visibleMembers.sort((a, b) => a.id.localeCompare(b.id));
        node = {
          id: `aggregated:${encodeURIComponent(
            JSON.stringify(visibleMembers.map(member => member.id))
          )}`,
          type: 'aggregated',
          kind: resourceTypeById.get(visibleMembers[0].id)!.kind,
          members: visibleMembers,
        };
      }
      for (const member of visibleMembers) visibleByResourceId.set(member.id, node);
      return [node];
    });

    const siblingsByType = new Map<string, ViewNode[]>();
    for (const node of visibleSiblings) {
      const first = node.type === 'resource' ? node.resource : node.members[0];
      const typeKey = resourceTypeById.get(first.id)!.key;
      if (!typeKey) continue;
      if (!siblingsByType.has(typeKey)) siblingsByType.set(typeKey, []);
      siblingsByType.get(typeKey)!.push(node);
    }
    for (const sameType of siblingsByType.values()) {
      if (sameType.length < 2) continue;
      const candidate = {
        viewNodeIds: sameType.map(node => node.id).sort(),
        members: sameType
          .flatMap(node => (node.type === 'resource' ? [node.resource] : node.members))
          .sort((a, b) => a.id.localeCompare(b.id)),
      };
      for (const node of sameType) candidates.set(node.id, candidate);

      for (const matchingMembers of matchingReaggregateMembers) {
        const representatives = sameType.filter(node =>
          node.type === 'resource'
            ? matchingMembers.has(node.id)
            : node.members.every(member => matchingMembers.has(member.id))
        );
        if (representatives.length < 2) continue;
        const members = representatives
          .flatMap(node => (node.type === 'resource' ? [node.resource] : node.members))
          .sort((a, b) => a.id.localeCompare(b.id));
        if (members.length !== matchingMembers.size) continue;
        // A local round trip restores the expanded aggregate without absorbing newer siblings.
        const reaggregate = { viewNodeIds: representatives.map(node => node.id).sort(), members };
        for (const node of representatives) candidates.set(node.id, reaggregate);
      }
    }

    for (const members of structuralBuckets) {
      // Hidden members retain their structural place; filtering cannot create new siblings.
      visitSiblings(members.flatMap(member => [...(childrenById.get(member.id) ?? [])]));
    }
  }

  visitSiblings([...resourcesById.keys()].filter(id => !hasParent.has(id)));
  // Rootless reference cycles have no top-down aggregation order; retain their resources.
  for (const resource of resourcesById.values()) {
    if (!visitedIds.has(resource.id) && (!matchingIds || matchingIds.has(resource.id))) {
      visibleByResourceId.set(resource.id, { id: resource.id, type: 'resource', resource });
    }
  }
  // Keep the original order when no resources are aggregated.
  const aggregatedNodes = [
    ...new Set(nodes.flatMap(node => visibleByResourceId.get(node.id) ?? [])),
  ];

  return { nodes: aggregatedNodes, edges: remapEdges(edges, visibleByResourceId), candidates };
}

function remapEdges(
  edges: ReadonlyArray<GraphEdge>,
  visibleByResourceId: ReadonlyMap<string, ViewNode>
): GraphEdge[] {
  const aggregatedEdges: GraphEdge[] = [];
  const remappedEdgeIds = new Set<string>();
  for (const edge of edges) {
    const source = visibleByResourceId.get(edge.source)?.id;
    const target = visibleByResourceId.get(edge.target)?.id;
    if (!source || !target) continue;
    if (source === edge.source && target === edge.target) {
      aggregatedEdges.push(edge);
      continue;
    }
    if (source === target) continue;
    const id = `aggregated-edge:${encodeURIComponent(
      JSON.stringify([source, target, !!edge.aux])
    )}`;
    if (remappedEdgeIds.has(id)) continue;
    remappedEdgeIds.add(id);
    aggregatedEdges.push({ id, source, target, ...(edge.aux ? { aux: true } : {}) });
  }

  return aggregatedEdges;
}

export function collectAllAggregates(
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  matchingIds?: ReadonlySet<string>,
  aggregates: ReadonlyArray<ResourceAggregate> = []
): ResourceAggregate[] {
  let nextAggregates = [...aggregates];
  while (true) {
    const candidates = new Set(
      aggregateGraph(nodes, edges, nextAggregates, matchingIds).candidates.values()
    );
    if (!candidates.size) return nextAggregates;
    const additions = [...candidates].map(candidate => candidate.members.map(member => member.id));
    const aggregatedIds = new Set(additions.flat());
    nextAggregates = [
      ...nextAggregates
        .map(aggregate => aggregate.filter(id => !aggregatedIds.has(id)))
        .filter(aggregate => aggregate.length > 1),
      ...additions,
    ];
  }
}
