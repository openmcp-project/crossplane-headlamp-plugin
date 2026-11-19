import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlow } from '@xyflow/react';
import { readFileSync } from 'fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { layoutGraph } from './layoutGraph';
import { ResourceNode } from './ResourceNode';
import { NODE_WIDTH, RESOURCE_NODE_LAYOUT_HEIGHT } from './styles';

const nodeTypes = { resource: ResourceNode };
const flowStyles = document.createElement('style');
beforeAll(() => {
  // JSDOM cannot parse CSS layers; retain the rules used by the handle geometry assertions.
  flowStyles.textContent = readFileSync('node_modules/@xyflow/react/dist/style.css', 'utf8')
    .split('@layer xyflow {')
    .map(layer => layer.replace(/\}\s*$/, ''))
    .join('');
  document.head.append(flowStyles);
});
beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe = vi.fn();
      unobserve = vi.fn();
      disconnect = vi.fn();
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
afterAll(() => flowStyles.remove());

it.each(['success', 'error'] as const)(
  'aggregates resources independently of details and child visibility (status: %s)',
  status => {
    const onAggregate = vi.fn();
    const onOpenDetails = vi.fn();
    const onToggleCollapse = vi.fn();
    render(
      <ReactFlow
        nodeTypes={nodeTypes}
        nodes={[
          {
            id: 'resource',
            type: 'resource',
            position: { x: 0, y: 0 },
            width: NODE_WIDTH,
            height: RESOURCE_NODE_LAYOUT_HEIGHT,
            data: {
              name: 'sample',
              kind: 'ServiceInstance',
              namespace: 'team-a',
              status,
              childNodeCount: 1,
              candidateMemberCount: 4,
              onAggregate,
              onOpenDetails,
              onToggleCollapse,
            },
          },
        ]}
      />
    );

    expect(screen.getByText(status === 'success' ? 'Healthy' : 'Needs Attention')).toBeTruthy();
    expect(screen.getByText('ServiceInstance')).toBeTruthy();
    expect(screen.getByText('sample').title).toBe('team-a/sample');
    expect(screen.queryByText('Namespace: team-a')).toBeNull();
    const aggregate = screen.getByRole('button', {
      name: 'Aggregate 4 ServiceInstance resources with team-a/sample',
    });
    expect(aggregate.title).toBe('Combine resources');
    fireEvent.click(aggregate);
    expect(onAggregate).toHaveBeenCalledOnce();
    expect(onOpenDetails).not.toHaveBeenCalled();
    expect(onToggleCollapse).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole('button', { name: 'Show details for ServiceInstance team-a/sample' })
    );
    expect(onOpenDetails).toHaveBeenCalledOnce();
    const collapse = screen.getByRole('button', { name: 'Collapse children of team-a/sample' });
    expect(collapse.title).toBe('Collapse 1 child node of team-a/sample');
    fireEvent.click(collapse);
    expect(onToggleCollapse).toHaveBeenCalledWith('resource');
    expect(onAggregate).toHaveBeenCalledOnce();
  }
);

it.each([undefined, 'team-a'])(
  'aligns both handle types with ELK ports (namespace: %s)',
  async namespace => {
    const height = RESOURCE_NODE_LAYOUT_HEIGHT;
    const onError = vi.fn();
    const { container } = render(
      <ReactFlow
        nodeTypes={nodeTypes}
        onError={onError}
        nodes={[
          {
            id: 'resource',
            type: 'resource',
            position: { x: 0, y: 0 },
            width: NODE_WIDTH,
            height,
            data: { name: 'sample', kind: 'ServiceInstance', namespace, status: 'success' },
          },
        ]}
      />
    );
    // JSDOM has no viewport dimensions; all other React Flow errors remain failures.
    expect(onError.mock.calls.every(([code]) => code === '004')).toBe(true);
    expect(screen.queryByRole('button', { name: /^Aggregate / })).toBeNull();
    const card = container.querySelector('.MuiCard-root')!;
    const width = parseFloat(getComputedStyle(card).width);
    expect(width).toBe(NODE_WIDTH);
    const edges = [
      { id: 'source', source: 'resource', target: 'other' },
      { id: 'target', source: 'other', target: 'resource' },
      { id: 'aux-source', source: 'resource', target: 'other', aux: true },
      { id: 'aux-target', source: 'other', target: 'resource', aux: true },
    ];
    const { positions, routes } = await layoutGraph({
      nodes: ['resource', 'other'].map(id => ({ id, width: NODE_WIDTH, height })),
      edges,
    });
    const origin = positions.get('resource')!;
    expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(4);
    for (const edge of edges) {
      const handle = container.querySelector(
        `[data-nodeid="resource"][data-handleid="${edge.id}"]`
      )!;
      const style = getComputedStyle(handle);
      const x = style.left.endsWith('%')
        ? (parseFloat(style.left) * width) / 100
        : parseFloat(style.left);
      const isSource = edge.source === 'resource';
      expect(handle.getAttribute('data-handlepos')).toBe(isSource ? 'bottom' : 'top');
      expect(handle.classList.contains(isSource ? 'source' : 'target')).toBe(true);
      expect(style.transform).toBe('translateX(-50%)');
      expect(isSource ? style.bottom : style.top).toBe('0px');
      const points = routes.get(edge.id)!.points;
      const anchor = isSource ? points[0] : points[points.length - 1];
      expect(anchor.x - origin.x).toBe(x);
      expect(anchor.y - origin.y).toBe(isSource ? height : 0);
    }
  }
);
