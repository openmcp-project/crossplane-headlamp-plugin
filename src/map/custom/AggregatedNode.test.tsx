import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ReactFlow } from '@xyflow/react';
import { readFileSync } from 'fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { AggregatedNode } from './AggregatedNode';
import { layoutGraph } from './layoutGraph';
import { AGGREGATED_NODE_HEIGHT, NODE_WIDTH } from './styles';

const nodeTypes = { aggregated: AggregatedNode };
const flowStyles = document.createElement('style');
beforeAll(() => {
  flowStyles.textContent = readFileSync('node_modules/@xyflow/react/dist/style.css', 'utf8');
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

it('shows the health count and ungroups only through its dedicated button', () => {
  const onUngroup = vi.fn();
  render(
    <ReactFlow
      nodeTypes={nodeTypes}
      nodes={[
        {
          id: 'group',
          type: 'aggregated',
          position: { x: 0, y: 0 },
          width: NODE_WIDTH,
          height: AGGREGATED_NODE_HEIGHT,
          data: {
            kind: 'ServiceInstance',
            apiGroup: 'account.btp.sap.crossplane.io',
            memberCount: 2,
            healthyMemberCount: 2,
            onUngroup,
          },
        },
      ]}
    />
  );

  expect(screen.getByText('2 of 2 Healthy')).toBeTruthy();
  expect(screen.getByText('account.btp.sap.crossplane.io').title).toBe(
    'account.btp.sap.crossplane.io'
  );
  expect(screen.queryByText('Needs Attention')).toBeNull();
  expect(screen.queryByText('Healthy')).toBeNull();
  expect(screen.queryByRole('button', { name: /^Group / })).toBeNull();
  fireEvent.click(screen.getByText('ServiceInstance'));
  expect(onUngroup).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Ungroup 2 ServiceInstance resources from account.btp.sap.crossplane.io',
    })
  );
  expect(onUngroup).toHaveBeenCalledOnce();
});

it('offers separate actions to group eligible siblings and ungroup existing members', () => {
  const onGroup = vi.fn();
  const onUngroup = vi.fn();
  render(
    <ReactFlow
      nodeTypes={nodeTypes}
      nodes={[
        {
          id: 'group',
          type: 'aggregated',
          position: { x: 0, y: 0 },
          width: NODE_WIDTH,
          height: AGGREGATED_NODE_HEIGHT,
          data: {
            kind: 'ServiceInstance',
            apiGroup: 'account.btp.sap.crossplane.io',
            memberCount: 2,
            healthyMemberCount: 1,
            candidateMemberCount: 4,
            onGroup,
            onUngroup,
          },
        },
      ]}
    />
  );

  expect(screen.getByText('1 of 2 Healthy')).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Group 4 ServiceInstance resources from account.btp.sap.crossplane.io',
    })
  );
  expect(onGroup).toHaveBeenCalledOnce();
  expect(onUngroup).not.toHaveBeenCalled();
  fireEvent.click(
    screen.getByRole('button', {
      name: 'Ungroup 2 ServiceInstance resources from account.btp.sap.crossplane.io',
    })
  );
  expect(onUngroup).toHaveBeenCalledOnce();
  expect(onGroup).toHaveBeenCalledOnce();
});

it('keeps all four edge anchors on the front card while the stack extends above it', async () => {
  const { container } = render(
    <ReactFlow
      nodeTypes={nodeTypes}
      nodes={[
        {
          id: 'group',
          type: 'aggregated',
          position: { x: 0, y: 0 },
          width: NODE_WIDTH,
          height: AGGREGATED_NODE_HEIGHT,
          data: {
            kind: 'ServiceInstance',
            memberCount: 2,
            healthyMemberCount: 0,
            onUngroup: vi.fn(),
          },
        },
      ]}
    />
  );
  expect(screen.getByText('2 of 2 Needs Attention')).toBeTruthy();
  const stack = container.querySelector('.MuiBox-root.nodrag.nopan')!;
  expect(parseFloat(getComputedStyle(stack).width)).toBe(NODE_WIDTH);
  expect(parseFloat(getComputedStyle(stack).height)).toBe(AGGREGATED_NODE_HEIGHT);
  const edges = [
    { id: 'source', source: 'group', target: 'other' },
    { id: 'target', source: 'other', target: 'group' },
    { id: 'aux-source', source: 'group', target: 'other', aux: true },
    { id: 'aux-target', source: 'other', target: 'group', aux: true },
  ];
  const { positions, routes } = await layoutGraph({
    nodes: ['group', 'other'].map(id => ({
      id,
      width: NODE_WIDTH,
      height: AGGREGATED_NODE_HEIGHT,
    })),
    edges,
  });
  const origin = positions.get('group')!;
  expect(container.querySelectorAll('.react-flow__handle')).toHaveLength(4);
  for (const edge of edges) {
    const handle = container.querySelector(`[data-nodeid="group"][data-handleid="${edge.id}"]`)!;
    const style = getComputedStyle(handle);
    const x = style.left.endsWith('%')
      ? (parseFloat(style.left) * NODE_WIDTH) / 100
      : parseFloat(style.left);
    const isSource = edge.source === 'group';
    const points = routes.get(edge.id)!.points;
    const anchor = isSource ? points[0] : points[points.length - 1];
    expect(handle.getAttribute('data-handlepos')).toBe(isSource ? 'bottom' : 'top');
    expect(style.transform).toBe('translateX(-50%)');
    expect(isSource ? style.bottom : style.top).toBe('0px');
    expect(anchor.x - origin.x).toBe(x);
    expect(anchor.y - origin.y).toBeCloseTo(isSource ? AGGREGATED_NODE_HEIGHT : 0, 8);
  }
});

it('collapses children through a separate accessible action and offers expansion afterwards', () => {
  const onUngroup = vi.fn();
  const onToggleCollapse = vi.fn();
  const data = {
    kind: 'ServiceManager',
    apiGroup: 'account.btp.sap.crossplane.io',
    memberCount: 4,
    healthyMemberCount: 2,
    onUngroup,
    onToggleCollapse,
  };
  const flow = (collapsed: boolean, childNodeCount: number) => (
    <ReactFlow
      nodeTypes={nodeTypes}
      nodes={[
        {
          id: 'group',
          type: 'aggregated',
          position: { x: 0, y: 0 },
          width: NODE_WIDTH,
          height: AGGREGATED_NODE_HEIGHT,
          data: { ...data, collapsed, childNodeCount },
        },
      ]}
    />
  );
  const { rerender } = render(flow(false, 3));
  const collapse = screen.getByRole('button', {
    name: 'Collapse children of 4 ServiceManager resources from account.btp.sap.crossplane.io',
  });
  expect(collapse.getAttribute('aria-expanded')).toBe('true');
  expect(collapse.textContent).toBe('3');
  expect(collapse.title).toBe(
    'Collapse 3 child nodes of 4 ServiceManager resources from account.btp.sap.crossplane.io'
  );
  fireEvent.click(collapse);
  expect(onToggleCollapse).toHaveBeenCalledWith('group');
  expect(onUngroup).not.toHaveBeenCalled();

  rerender(flow(true, 1));
  const expand = screen.getByRole('button', { name: /^Expand children of 4 ServiceManager/ });
  expect(expand.getAttribute('aria-expanded')).toBe('false');
  expect(expand.textContent).toBe('1');
  expect(expand.title).toBe(
    'Expand 1 child node of 4 ServiceManager resources from account.btp.sap.crossplane.io'
  );
  fireEvent.click(expand);
  expect(onToggleCollapse).toHaveBeenCalledTimes(2);
  expect(onUngroup).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /^Ungroup / }));
  expect(onUngroup).toHaveBeenCalledOnce();
  expect(onToggleCollapse).toHaveBeenCalledTimes(2);
});

it.each([20, 200, 1000])('preserves health and all three actions for %i members', count => {
  const onGroup = vi.fn();
  const onUngroup = vi.fn();
  const onToggleCollapse = vi.fn();
  render(
    <ReactFlow
      nodeTypes={nodeTypes}
      nodes={[
        {
          id: 'group',
          type: 'aggregated',
          position: { x: 0, y: 0 },
          width: NODE_WIDTH,
          height: AGGREGATED_NODE_HEIGHT,
          data: {
            kind: 'ServiceManager',
            memberCount: count,
            healthyMemberCount: 0,
            childNodeCount: count,
            candidateMemberCount: count + 1,
            onGroup,
            onUngroup,
            onToggleCollapse,
          },
        },
      ]}
    />
  );

  expect(screen.getByText(`${count} of ${count} Needs Attention`)).toBeTruthy();
  fireEvent.click(
    screen.getByRole('button', { name: `Group ${count + 1} ServiceManager resources` })
  );
  fireEvent.click(
    screen.getByRole('button', { name: `Ungroup ${count} ServiceManager resources` })
  );
  const collapse = screen.getByRole('button', {
    name: `Collapse children of ${count} ServiceManager resources`,
  });
  expect(collapse.title).toBe(`Collapse ${count} child nodes of ${count} ServiceManager resources`);
  fireEvent.click(collapse);
  expect(onGroup).toHaveBeenCalledOnce();
  expect(onUngroup).toHaveBeenCalledOnce();
  expect(onToggleCollapse).toHaveBeenCalledExactlyOnceWith('group');
});
