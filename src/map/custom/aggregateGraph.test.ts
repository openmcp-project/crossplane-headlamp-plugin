import { describe, expect, it } from 'vitest';
import type { GraphEdge, GraphNode } from '../common/types';
import { aggregateGraph, collectAllAggregates } from './aggregateGraph';

function resource(id: string, kind = id[0], apiVersion = 'example.org/v1'): GraphNode {
  return {
    id,
    kubeObject: { jsonData: { kind, apiVersion, metadata: { name: id } } },
    status: 'success',
  };
}

function edge(source: string, target: string, aux = false): GraphEdge {
  return { id: `${source}-${target}-${aux}`, source, target, ...(aux ? { aux } : {}) };
}

function summarize(graph: ReturnType<typeof aggregateGraph>) {
  const names = new Map(
    graph.nodes.map(node => [
      node.id,
      node.type === 'aggregated' ? `(${node.members.map(member => member.id).join(',')})` : node.id,
    ])
  );
  return {
    nodes: [...names.values()].sort(),
    edges: graph.edges
      .map(edge => `${names.get(edge.source)}${edge.aux ? '~>' : '->'}${names.get(edge.target)}`)
      .sort(),
  };
}

function activeAggregates(graph: ReturnType<typeof aggregateGraph>) {
  return graph.nodes.flatMap(node =>
    node.type === 'aggregated' ? [node.members.map(member => member.id)] : []
  );
}

function candidateMembers(graph: ReturnType<typeof aggregateGraph>, id: string) {
  return graph.candidates.get(id)?.members.map(member => member.id);
}

const splitNodes = ['A1', 'A2', 'B1', 'B2', 'B3', 'B4'].map(id => resource(id));
const splitEdges = [edge('A1', 'B1'), edge('A1', 'B2'), edge('A2', 'B3'), edge('A2', 'B4')];

describe('aggregateGraph', () => {
  const nodes = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2', 'D2'].map(id => resource(id));
  const edges = [
    edge('A1', 'B1'),
    edge('A1', 'C1'),
    edge('A2', 'B2'),
    edge('A2', 'C2'),
    edge('A2', 'D2'),
  ];

  it('starts with the original resources, node order and edge identities', () => {
    const relationships = [
      ...edges,
      edge('B1', 'C1', true),
      edge('D2', 'D2'),
      { ...edges[0], id: 'another-relationship' },
    ];
    const graph = aggregateGraph(nodes, relationships, []);
    expect(graph.nodes).toEqual(
      nodes.map(node => ({ id: node.id, type: 'resource', resource: node }))
    );
    graph.nodes.forEach((node, index) => {
      expect(node.type === 'resource' && node.resource).toBe(nodes[index]);
    });
    expect(graph.edges).toEqual(relationships);
    graph.edges.forEach((relationship, index) => expect(relationship).toBe(relationships[index]));
    expect(candidateMembers(graph, 'A1')).toEqual(['A1', 'A2']);
    expect(graph.candidates.get('A1')).toBe(graph.candidates.get('A2'));
    expect(graph.candidates.has('B1')).toBe(false);
  });

  it('aggregates only the clicked candidate and exposes newly eligible children as candidates', () => {
    const parentAggregated = aggregateGraph(nodes, edges, [['A1', 'A2']]);
    expect(summarize(parentAggregated)).toEqual({
      nodes: ['(A1,A2)', 'B1', 'B2', 'C1', 'C2', 'D2'],
      edges: ['(A1,A2)->B1', '(A1,A2)->B2', '(A1,A2)->C1', '(A1,A2)->C2', '(A1,A2)->D2'],
    });
    expect(candidateMembers(parentAggregated, 'B1')).toEqual(['B1', 'B2']);
    expect(candidateMembers(parentAggregated, 'C1')).toEqual(['C1', 'C2']);
    const childAggregated = aggregateGraph(nodes, edges, [
      ...activeAggregates(parentAggregated),
      candidateMembers(parentAggregated, 'B1')!,
    ]);
    expect(summarize(childAggregated).nodes).toEqual(['(A1,A2)', '(B1,B2)', 'C1', 'C2', 'D2']);
    const child = childAggregated.nodes.find(
      node => node.type === 'aggregated' && node.kind === 'B'
    )!;
    expect(childAggregated.candidates.has(child.id)).toBe(false);
  });

  it('aggregates all eligible roots and descendants only for the global action', () => {
    const aggregates = collectAllAggregates(nodes, edges);
    expect(aggregates).toEqual([
      ['A1', 'A2'],
      ['B1', 'B2'],
      ['C1', 'C2'],
    ]);
    const graph = aggregateGraph(nodes, edges, aggregates);
    expect(summarize(graph)).toEqual({
      nodes: ['(A1,A2)', '(B1,B2)', '(C1,C2)', 'D2'],
      edges: ['(A1,A2)->(B1,B2)', '(A1,A2)->(C1,C2)', '(A1,A2)->D2'],
    });
    expect(graph.nodes[0]).toMatchObject({
      type: 'aggregated',
      kind: 'A',
      members: nodes.slice(0, 2),
    });
    expect(graph.nodes[0]).not.toHaveProperty('status');
    expect(graph.nodes[0]).not.toHaveProperty('kubeObject');
    expect(graph.candidates.size).toBe(0);
  });

  it('dissolves one child aggregate without changing its parent or sibling aggregates', () => {
    expect(
      summarize(
        aggregateGraph(nodes, edges, [
          ['A1', 'A2'],
          ['C1', 'C2'],
        ])
      )
    ).toEqual({
      nodes: ['(A1,A2)', '(C1,C2)', 'B1', 'B2', 'D2'],
      edges: ['(A1,A2)->(C1,C2)', '(A1,A2)->B1', '(A1,A2)->B2', '(A1,A2)->D2'],
    });
  });

  it('splits existing child aggregates by visible parent when their parent aggregate is dissolved', () => {
    const graph = aggregateGraph(splitNodes, splitEdges, [['B1', 'B2', 'B3', 'B4']]);
    expect(summarize(graph)).toEqual({
      nodes: ['(B1,B2)', '(B3,B4)', 'A1', 'A2'],
      edges: ['A1->(B1,B2)', 'A2->(B3,B4)'],
    });
    expect(activeAggregates(graph)).toEqual([
      ['B1', 'B2'],
      ['B3', 'B4'],
    ]);
    expect(graph.candidates.size).toBe(2);
    expect(candidateMembers(graph, 'A1')).toEqual(['A1', 'A2']);
  });

  it('keeps separate child aggregates separate when their parents are subsequently aggregated', () => {
    const split = aggregateGraph(splitNodes, splitEdges, [['B1', 'B2', 'B3', 'B4']]);
    const joined = aggregateGraph(splitNodes, splitEdges, [
      ...activeAggregates(split),
      candidateMembers(split, 'A1')!,
    ]);
    expect(summarize(joined)).toEqual({
      nodes: ['(A1,A2)', '(B1,B2)', '(B3,B4)'],
      edges: ['(A1,A2)->(B1,B2)', '(A1,A2)->(B3,B4)'],
    });
    const children = joined.nodes.filter(node => node.type === 'aggregated' && node.kind === 'B');
    expect(candidateMembers(joined, children[0].id)).toEqual(['B1', 'B2', 'B3', 'B4']);
    expect(joined.candidates.get(children[0].id)).toBe(joined.candidates.get(children[1].id));
    expect(joined.candidates.get(children[0].id)?.viewNodeIds).toEqual(
      children.map(node => node.id).sort()
    );
  });

  it('recomputes the hovered candidate after a parent is dissolved', () => {
    const before = aggregateGraph(splitNodes, splitEdges, [['A1', 'A2']]);
    expect(candidateMembers(before, 'B1')).toEqual(['B1', 'B2', 'B3', 'B4']);
    const after = aggregateGraph(splitNodes, splitEdges, []);
    expect(candidateMembers(after, 'B1')).toEqual(['B1', 'B2']);
    expect(candidateMembers(after, 'B3')).toEqual(['B3', 'B4']);
    expect(after.candidates.get('B1')).not.toBe(after.candidates.get('B3'));
  });

  it('retains an unchanged child aggregate identity after dissolving its parent aggregate', () => {
    const resources = ['X1', 'X2', 'Y1', 'Y2', 'Z'].map(id => resource(id));
    const relationships = [edge('X1', 'Y1'), edge('X1', 'Y2'), edge('X2', 'Z')];
    const aggregated = aggregateGraph(
      resources,
      relationships,
      collectAllAggregates(resources, relationships)
    );
    const dissolved = aggregateGraph(resources, relationships, [['Y1', 'Y2']]);
    expect(summarize(dissolved)).toEqual({
      nodes: ['(Y1,Y2)', 'X1', 'X2', 'Z'],
      edges: ['X1->(Y1,Y2)', 'X2->Z'],
    });
    expect(dissolved.nodes.find(node => node.type === 'aggregated')?.id).toBe(
      aggregated.nodes.find(node => node.type === 'aggregated' && node.kind === 'Y')?.id
    );
  });

  it('leaves new resources separate and offers an explicit merge with an existing aggregate', () => {
    const resources = ['A1', 'A2', 'A3', 'B1', 'B2'].map(id => resource(id));
    const graph = aggregateGraph(resources, [], [['A1', 'A2']]);
    expect(summarize(graph).nodes).toEqual(['(A1,A2)', 'A3', 'B1', 'B2']);
    const aggregated = graph.nodes[0];
    expect(candidateMembers(graph, 'A3')).toEqual(['A1', 'A2', 'A3']);
    expect(graph.candidates.get('A3')?.viewNodeIds).toEqual(['A3', aggregated.id].sort());
    expect(graph.candidates.get('A3')).toBe(graph.candidates.get(aggregated.id));
    expect(candidateMembers(graph, 'B1')).toEqual(['B1', 'B2']);
  });

  it('repartitions explicit memberships after live parent changes', () => {
    const relationships = [edge('A1', 'B1'), edge('A2', 'B2'), edge('A2', 'B3'), edge('A2', 'B4')];
    const graph = aggregateGraph(splitNodes, relationships, [
      ['B1', 'B2'],
      ['B3', 'B4'],
    ]);
    expect(summarize(graph).nodes).toEqual(['(B3,B4)', 'A1', 'A2', 'B1', 'B2']);
    expect(graph.candidates.has('B1')).toBe(false);
    expect(candidateMembers(graph, 'B2')).toEqual(['B2', 'B3', 'B4']);
  });

  it('does not merge the same type across separate visible parents or depths', () => {
    const resources = ['A1', 'X1', 'B1', 'B2', 'B3'].map(id => resource(id));
    const relationships = [edge('A1', 'B1'), edge('X1', 'B2'), edge('B1', 'B3')];
    const graph = aggregateGraph(resources, relationships, [['B1', 'B2', 'B3']]);
    expect(summarize(graph)).toEqual({
      nodes: ['A1', 'B1', 'B2', 'B3', 'X1'],
      edges: ['A1->B1', 'B1->B3', 'X1->B2'],
    });
    expect(graph.candidates.size).toBe(0);
  });

  it('uses API group and kind as type identity, independently of API version and namespace', () => {
    const first = resource('one', 'Object', 'first.example.org/v1');
    const second = resource('two', 'Object', 'first.example.org/v2');
    second.kubeObject.jsonData.metadata.namespace = 'other';
    const otherGroup = resource('three', 'Object', 'second.example.org/v1');
    const otherKind = resource('four', 'Service', 'first.example.org/v1');
    const resources = [first, second, otherGroup, otherKind];
    expect(candidateMembers(aggregateGraph(resources, [], []), 'one')).toEqual(['one', 'two']);
    expect(summarize(aggregateGraph(resources, [], collectAllAggregates(resources, [])))).toEqual({
      nodes: ['(one,two)', 'four', 'three'],
      edges: [],
    });
  });

  it('remaps additional references without letting them determine sibling aggregates', () => {
    const relationships = [
      ...edges,
      edge('B1', 'C1', true),
      edge('B2', 'C2', true),
      edge('B1', 'B2', true),
      edge('A1', 'B1', true),
      edge('A1', 'B1'),
      edge('missing', 'A1'),
      edge('A1', 'missing', true),
      edge('D2', 'D2'),
    ];
    expect(
      summarize(aggregateGraph(nodes, relationships, collectAllAggregates(nodes, relationships)))
    ).toEqual({
      nodes: ['(A1,A2)', '(B1,B2)', '(C1,C2)', 'D2'],
      edges: [
        '(A1,A2)->(B1,B2)',
        '(A1,A2)->(C1,C2)',
        '(A1,A2)->D2',
        '(A1,A2)~>(B1,B2)',
        '(B1,B2)~>(C1,C2)',
        'D2->D2',
      ],
    });
    const resources = [resource('A1'), resource('A2')];
    const onlyAux = [edge('A1', 'A2', true)];
    const separate = aggregateGraph(resources, onlyAux, []);
    expect(candidateMembers(separate, 'A1')).toEqual(['A1', 'A2']);
    expect(summarize(aggregateGraph(resources, onlyAux, [['A1', 'A2']]))).toEqual({
      nodes: ['(A1,A2)'],
      edges: [],
    });
  });

  it('preserves original edges outside a changed aggregate', () => {
    const graph = aggregateGraph(splitNodes, splitEdges, [['B1', 'B2']]);
    expect(graph.edges.find(relationship => relationship.id === splitEdges[2].id)).toBe(
      splitEdges[2]
    );
    expect(graph.edges.find(relationship => relationship.id === splitEdges[3].id)).toBe(
      splitEdges[3]
    );
  });

  it('keeps aggregate and edge identities stable when resource and relationship order changes', () => {
    const aggregates = collectAllAggregates(nodes, edges);
    const forward = aggregateGraph(nodes, edges, aggregates);
    const reverse = aggregateGraph([...nodes].reverse(), [...edges].reverse(), aggregates);
    expect(reverse.nodes.map(node => node.id).sort()).toEqual(
      forward.nodes.map(node => node.id).sort()
    );
    expect(reverse.edges.map(relationship => relationship.id).sort()).toEqual(
      forward.edges.map(relationship => relationship.id).sort()
    );
    expect(summarize(reverse)).toEqual(summarize(forward));
    const container = document.createElement('div');
    for (const node of forward.nodes) {
      const element = document.createElement('div');
      element.dataset.id = node.id;
      container.appendChild(element);
      expect(container.querySelector(`[data-id="${node.id}"]`)).toBe(element);
    }
  });

  it('retains rootless cycles and their downstream resources while aggregating other components', () => {
    const resources = ['A1', 'A2', 'B1', 'B2', 'B3', 'B4'].map(id => resource(id));
    const relationships = [edge('B1', 'B2'), edge('B2', 'B1'), edge('B2', 'B3'), edge('B2', 'B4')];
    const graph = aggregateGraph(
      resources,
      relationships,
      collectAllAggregates(resources, relationships)
    );
    expect(summarize(graph)).toEqual({
      nodes: ['(A1,A2)', 'B1', 'B2', 'B3', 'B4'],
      edges: ['B1->B2', 'B2->B1', 'B2->B3', 'B2->B4'],
    });
    expect(graph.candidates.size).toBe(0);
  });

  it('terminates without omitting or duplicating resources when a reachable branch contains a cycle', () => {
    const resources = ['A1', 'B1', 'C1'].map(id => resource(id));
    const relationships = [edge('A1', 'B1'), edge('B1', 'C1'), edge('C1', 'B1')];
    expect(
      summarize(
        aggregateGraph(resources, relationships, collectAllAggregates(resources, relationships))
      )
    ).toEqual({
      nodes: ['A1', 'B1', 'C1'],
      edges: ['A1->B1', 'B1->C1', 'C1->B1'],
    });
  });

  it('supports plain resources and ignores missing kinds and stale aggregate members', () => {
    const first = resource('A1');
    first.kubeObject = first.kubeObject.jsonData;
    const unknown = resource('unknown');
    const otherUnknown = resource('other-unknown');
    delete unknown.kubeObject.jsonData.kind;
    delete otherUnknown.kubeObject.jsonData.kind;
    const resources = [first, resource('A2'), unknown, otherUnknown];
    const graph = aggregateGraph(
      resources,
      [],
      [
        ['A1', 'A2', 'stale'],
        ['unknown', 'other-unknown'],
      ]
    );
    expect(summarize(graph)).toEqual({ nodes: ['(A1,A2)', 'other-unknown', 'unknown'], edges: [] });
    expect(graph.candidates.size).toBe(0);
    expect(aggregateGraph([], [], [])).toEqual({ nodes: [], edges: [], candidates: new Map() });
    expect(collectAllAggregates([], [])).toEqual([]);
  });
});

describe('filtered aggregation', () => {
  it('projects a remembered pair to two, one, zero and two members without changing its intent', () => {
    const resources = ['A1', 'A2'].map(id => resource(id));
    const aggregates = Object.freeze([Object.freeze(['A1', 'A2'])]);
    const original = aggregateGraph(resources, [], aggregates);

    expect(summarize(aggregateGraph(resources, [], aggregates, new Set(['A1', 'A2'])))).toEqual({
      nodes: ['(A1,A2)'],
      edges: [],
    });
    const singleton = aggregateGraph(resources, [], aggregates, new Set(['A1']));
    expect(singleton.nodes).toEqual([{ id: 'A1', type: 'resource', resource: resources[0] }]);
    expect(singleton.candidates.size).toBe(0);
    expect(aggregateGraph(resources, [], aggregates, new Set())).toEqual({
      nodes: [],
      edges: [],
      candidates: new Map(),
    });
    expect(aggregateGraph(resources, [], aggregates)).toEqual(original);
    expect(aggregates).toEqual([['A1', 'A2']]);
  });

  it('offers only matching members from at least two displayed representatives', () => {
    const resources = ['A1', 'A2', 'A3', 'A4'].map(id => resource(id));
    const aggregates = [['A1', 'A2', 'A4']];
    const graph = aggregateGraph(resources, [], aggregates, new Set(['A1', 'A3']));
    expect(graph.candidates.get('A1')?.viewNodeIds).toEqual(['A1', 'A3']);
    expect(candidateMembers(graph, 'A1')).toEqual(['A1', 'A3']);
    expect(graph.candidates.get('A1')).toBe(graph.candidates.get('A3'));

    const aggregate = aggregateGraph(resources, [], aggregates, new Set(['A1', 'A2']));
    expect(summarize(aggregate).nodes).toEqual(['(A1,A2)']);
    expect(aggregate.candidates.size).toBe(0);
    const merge = aggregateGraph(resources, [], aggregates, new Set(['A1', 'A2', 'A3']));
    expect(candidateMembers(merge, 'A3')).toEqual(['A1', 'A2', 'A3']);
    expect(merge.candidates.get('A3')?.viewNodeIds).toHaveLength(2);
  });

  it('keeps matching descendants without promoting hidden parents into new sibling sets', () => {
    const resources = ['A1', 'X1', 'B1', 'B2', 'B3'].map(id => resource(id));
    const relationships = [edge('A1', 'B1'), edge('X1', 'B2'), edge('B1', 'B3')];
    const matchingIds = new Set(['B1', 'B2', 'B3']);
    const graph = aggregateGraph(resources, relationships, [['B1', 'B2', 'B3']], matchingIds);
    expect(summarize(graph)).toEqual({ nodes: ['B1', 'B2', 'B3'], edges: ['B1->B3'] });
    expect(graph.candidates.size).toBe(0);
    expect(collectAllAggregates(resources, relationships, matchingIds)).toEqual([]);
  });

  it('retains child aggregation beneath a partially or completely hidden remembered parent aggregate', () => {
    const resources = ['A1', 'A2', 'B1', 'B2'].map(id => resource(id));
    const relationships = [edge('A1', 'B1'), edge('A2', 'B2')];
    const aggregates = [
      ['A1', 'A2'],
      ['B1', 'B2'],
    ];
    expect(
      summarize(aggregateGraph(resources, relationships, aggregates, new Set(['B1', 'B2'])))
    ).toEqual({
      nodes: ['(B1,B2)'],
      edges: [],
    });
    expect(
      summarize(aggregateGraph(resources, relationships, aggregates, new Set(['A1', 'B1', 'B2'])))
    ).toEqual({ nodes: ['(B1,B2)', 'A1'], edges: ['A1->(B1,B2)'] });
  });

  it('does not invent parent or additional-reference edges between diagonal matches', () => {
    const resources = ['A1', 'A2', 'A3', 'A4', 'B1', 'B2', 'B3', 'B4'].map(id => resource(id));
    const relationships = [1, 2, 3, 4].flatMap(index => [
      edge(`A${index}`, `B${index}`),
      edge(`A${index}`, `B${index}`, true),
    ]);
    const aggregates = [
      ['A1', 'A2', 'A3', 'A4'],
      ['B1', 'B2', 'B3', 'B4'],
    ];
    expect(
      summarize(aggregateGraph(resources, relationships, aggregates, new Set(['A1', 'B2'])))
    ).toEqual({
      nodes: ['A1', 'B2'],
      edges: [],
    });
    expect(
      summarize(
        aggregateGraph(resources, relationships, aggregates, new Set(['A1', 'A2', 'B3', 'B4']))
      )
    ).toEqual({ nodes: ['(A1,A2)', '(B3,B4)'], edges: [] });
    expect(
      summarize(
        aggregateGraph(resources, relationships, aggregates, new Set(['A1', 'A2', 'B1', 'B2']))
      )
    ).toEqual({
      nodes: ['(A1,A2)', '(B1,B2)'],
      edges: ['(A1,A2)->(B1,B2)', '(A1,A2)~>(B1,B2)'],
    });
  });

  it('preserves type boundaries and aggregates matching namespaces independently of API version', () => {
    const resources = [
      resource('one', 'Object', 'first.example.org/v1'),
      resource('two', 'Object', 'first.example.org/v2'),
      resource('three', 'Object', 'second.example.org/v1'),
      resource('four', 'Object', 'first.example.org/v1'),
    ];
    resources[0].kubeObject.jsonData.metadata.namespace = 'x';
    resources[1].kubeObject.jsonData.metadata.namespace = 'y';
    const matchingIds = new Set(['one', 'two', 'three']);
    const aggregates = collectAllAggregates(resources, [], matchingIds);
    expect(aggregates).toEqual([['one', 'two']]);
    expect(summarize(aggregateGraph(resources, [], aggregates, matchingIds))).toEqual({
      nodes: ['(one,two)', 'three'],
      edges: [],
    });
  });

  it('aggregates newly eligible matching descendants while preserving unrelated hidden aggregates', () => {
    const resources = ['A1', 'A2', 'B1', 'B2', 'B3', 'C1', 'C2', 'X1', 'X2'].map(id =>
      resource(id)
    );
    const relationships = [
      edge('A1', 'B1'),
      edge('A2', 'B2'),
      edge('A2', 'B3'),
      edge('B1', 'C1'),
      edge('B2', 'C2'),
    ];
    const matchingIds = new Set(['A1', 'A2', 'B1', 'B2', 'C1', 'C2']);
    const existing = Object.freeze([Object.freeze(['X1', 'X2'])]);
    const aggregates = collectAllAggregates(resources, relationships, matchingIds, existing);
    expect(aggregates).toEqual([
      ['X1', 'X2'],
      ['A1', 'A2'],
      ['B1', 'B2'],
      ['C1', 'C2'],
    ]);
    expect(aggregateGraph(resources, relationships, aggregates, matchingIds).candidates.size).toBe(
      0
    );
    expect(existing).toEqual([['X1', 'X2']]);
    expect(collectAllAggregates(resources, relationships, new Set(), aggregates)).toEqual(
      aggregates
    );
  });

  it('replaces a touched aggregate with current matches while leaving hidden members individual', () => {
    const resources = ['A1', 'A2', 'A3', 'X1', 'X2'].map(id => resource(id));
    const existing = [
      ['A1', 'A2'],
      ['X1', 'X2'],
    ];
    const aggregates = collectAllAggregates(resources, [], new Set(['A1', 'A3']), existing);
    expect(aggregates).toEqual([
      ['X1', 'X2'],
      ['A1', 'A3'],
    ]);
    expect(summarize(aggregateGraph(resources, [], aggregates))).toEqual({
      nodes: ['(A1,A3)', '(X1,X2)', 'A2'],
      edges: [],
    });
    expect(existing).toEqual([
      ['A1', 'A2'],
      ['X1', 'X2'],
    ]);
  });

  it('preserves an untouched part of a stored child aggregate when aggregating another part', () => {
    const resources = ['A1', 'A2', 'B1', 'B2', 'B3', 'B4', 'B5'].map(id => resource(id));
    const relationships = [
      edge('A1', 'B1'),
      edge('A1', 'B2'),
      edge('A1', 'B5'),
      edge('A2', 'B3'),
      edge('A2', 'B4'),
    ];
    const aggregates = collectAllAggregates(resources, relationships, new Set(['B1', 'B2', 'B5']), [
      ['B1', 'B2', 'B3', 'B4'],
    ]);
    expect(aggregates).toEqual([
      ['B3', 'B4'],
      ['B1', 'B2', 'B5'],
    ]);
    expect(summarize(aggregateGraph(resources, relationships, aggregates)).nodes).toEqual([
      '(B1,B2,B5)',
      '(B3,B4)',
      'A1',
      'A2',
    ]);
  });

  it('filters resources in rootless cycles without applying aggregation to their descendants', () => {
    const resources = ['A1', 'A2', 'B1', 'B2'].map(id => resource(id));
    const relationships = [edge('A1', 'A2'), edge('A2', 'A1'), edge('A2', 'B1'), edge('A2', 'B2')];
    const matchingIds = new Set(['A2', 'B1']);
    const graph = aggregateGraph(
      resources,
      relationships,
      [
        ['A1', 'A2'],
        ['B1', 'B2'],
      ],
      matchingIds
    );
    expect(summarize(graph)).toEqual({ nodes: ['A2', 'B1'], edges: ['A2->B1'] });
    expect(graph.candidates.size).toBe(0);
  });
});

describe('reaggregation remembered members', () => {
  it('restores a partial aggregate beside another sibling at the same filter', () => {
    const resources = ['A1', 'A2', 'A3', 'A4'].map(id => resource(id));
    const matchingIds = new Set(['A1', 'A2', 'A3']);
    const original = aggregateGraph(resources, [], [['A1', 'A2', 'A4']], matchingIds);
    const reaggregateHistory = Object.freeze([Object.freeze(['A1', 'A2'])]);
    const expanded = aggregateGraph(resources, [], [], matchingIds, reaggregateHistory);
    expect(candidateMembers(expanded, 'A1')).toEqual(['A1', 'A2']);
    expect(expanded.candidates.get('A1')).toBe(expanded.candidates.get('A2'));
    expect(candidateMembers(expanded, 'A3')).toEqual(['A1', 'A2', 'A3']);

    const reaggregated = aggregateGraph(
      resources,
      [],
      [candidateMembers(expanded, 'A1')!],
      matchingIds
    );
    expect(summarize(reaggregated)).toEqual(summarize(original));
    expect(reaggregateHistory).toEqual([['A1', 'A2']]);
  });

  it('restores preserved child aggregation when its expanded parent aggregate is rejoined', () => {
    const originalAggregates = [
      ['A1', 'A2'],
      ['B1', 'B2', 'B3', 'B4'],
    ];
    const original = aggregateGraph(splitNodes, splitEdges, originalAggregates);
    const childIntent = [originalAggregates[1]];
    const expanded = aggregateGraph(splitNodes, splitEdges, childIntent, undefined, [
      originalAggregates[0],
    ]);
    expect(summarize(expanded)).toEqual({
      nodes: ['(B1,B2)', '(B3,B4)', 'A1', 'A2'],
      edges: ['A1->(B1,B2)', 'A2->(B3,B4)'],
    });
    const reaggregated = aggregateGraph(splitNodes, splitEdges, [
      ...childIntent,
      candidateMembers(expanded, 'A1')!,
    ]);
    expect(summarize(reaggregated)).toEqual(summarize(original));
    expect(childIntent).toEqual([['B1', 'B2', 'B3', 'B4']]);
  });

  it('uses only current matches and requires two representatives for a remembered candidate', () => {
    const resources = ['A1', 'A2', 'A3', 'A4'].map(id => resource(id));
    const reaggregateHistory = [['A1', 'A2', 'A3']];
    const filtered = aggregateGraph(
      resources,
      [],
      [],
      new Set(['A1', 'A2', 'A4']),
      reaggregateHistory
    );
    expect(candidateMembers(filtered, 'A1')).toEqual(['A1', 'A2']);
    const singleton = aggregateGraph(resources, [], [], new Set(['A1']), reaggregateHistory);
    expect(singleton.candidates.size).toBe(0);
    const withSibling = aggregateGraph(
      resources,
      [],
      [],
      new Set(['A1', 'A4']),
      reaggregateHistory
    );
    expect(candidateMembers(withSibling, 'A1')).toEqual(['A1', 'A4']);
    const aggregate = aggregateGraph(
      resources,
      [],
      [['A1', 'A2']],
      new Set(['A1', 'A2']),
      reaggregateHistory
    );
    expect(aggregate.candidates.size).toBe(0);
  });

  it('ignores remembered combinations that no longer share a structural parent or API group', () => {
    const resources = [
      resource('A1'),
      resource('A2'),
      resource('B1'),
      resource('B2'),
      resource('B3', 'B', 'other.example.org/v1'),
    ];
    const relationships = [edge('A1', 'B1'), edge('A2', 'B2'), edge('A1', 'B3')];
    const graph = aggregateGraph(resources, relationships, [], new Set(['B1', 'B2', 'B3']), [
      ['B1', 'B2'],
      ['B1', 'B3'],
    ]);
    expect(graph.candidates.size).toBe(0);
  });

  it('does not split an active representative to restore stale overlapping membership', () => {
    const resources = ['A1', 'A2', 'A3'].map(id => resource(id));
    const graph = aggregateGraph(resources, [], [['A1', 'A3']], undefined, [['A1', 'A2']]);
    expect(candidateMembers(graph, 'A2')).toEqual(['A1', 'A2', 'A3']);
    expect(graph.candidates.get('A2')?.viewNodeIds).toHaveLength(2);
  });

  it('keeps the global action free to aggregate all matching siblings', () => {
    const resources = ['A1', 'A2', 'A3'].map(id => resource(id));
    const matchingIds = new Set(['A1', 'A2', 'A3']);
    const expanded = aggregateGraph(resources, [], [], matchingIds, [['A1', 'A2']]);
    expect(candidateMembers(expanded, 'A1')).toEqual(['A1', 'A2']);
    expect(collectAllAggregates(resources, [], matchingIds)).toEqual([['A1', 'A2', 'A3']]);
  });
});
