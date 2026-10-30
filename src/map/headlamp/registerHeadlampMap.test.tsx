import { cleanup, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerHeadlampMap } from './registerHeadlampMap';

const mocks = vi.hoisted(() => ({
  registerRoute: vi.fn(),
  registerMapSource: vi.fn(),
  registerKindIcon: vi.fn(),
  graph: null as any,
  enabled: true,
  mapRoute: null as any,
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  registerRoute: mocks.registerRoute,
  Router: { getDefaultRoutes: () => ({ map: mocks.mapRoute }) },
  registerMapSource: mocks.registerMapSource,
  registerKindIcon: mocks.registerKindIcon,
}));
vi.mock('../common/useManagedGraph', () => ({ useManagedGraph: () => mocks.graph }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.graph = null;
  mocks.enabled = true;
  mocks.mapRoute = {
    name: 'Map',
    path: '/map',
    exact: true,
    sidebar: 'map',
    isFullWidth: true,
    component: () => (mocks.enabled ? <NativeSource /> : null),
  };
  registerHeadlampMap();
});
afterEach(cleanup);

function NativeSource() {
  const source = mocks.registerMapSource.mock.calls[0][0].sources[0];
  const data = source.useData();
  return <div data-testid="native-nodes">{data?.nodes?.length ?? 0}</div>;
}

function nativeMap() {
  return mocks.registerRoute.mock.calls[0][0].component;
}

describe('native map source errors', () => {
  it('shows discovery errors and removes the alert when discovery recovers', () => {
    mocks.graph = {
      nodes: [],
      edges: [],
      error: new Error('CRD discovery forbidden'),
      resourceErrors: [],
    };
    const Map = nativeMap();
    const { rerender } = render(
      <StrictMode>
        <Map />
      </StrictMode>
    );
    expect(screen.getByRole('alert').textContent).toContain('CRD discovery forbidden');
    mocks.graph = { nodes: [], edges: [], resourceErrors: [] };
    rerender(
      <StrictMode>
        <Map />
      </StrictMode>
    );
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps nodes visible with partial failures and clears errors when the source is disabled', () => {
    mocks.graph = {
      nodes: [{ id: 'successful-resource' }],
      edges: [],
      resourceErrors: [{ crdName: 'serviceinstances.example.org', error: new Error('Forbidden') }],
    };
    const Map = nativeMap();
    const { rerender } = render(<Map />);
    expect(screen.getByRole('alert').textContent).toContain(
      'serviceinstances.example.org: Forbidden'
    );
    expect(screen.getByTestId('native-nodes').textContent).toBe('1');
    mocks.enabled = false;
    rerender(<Map />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('clears an old cluster error while the next cluster is loading', () => {
    mocks.graph = {
      nodes: [],
      edges: [],
      error: new Error('Old cluster failure'),
      resourceErrors: [],
    };
    const Map = nativeMap();
    const { rerender } = render(<Map />);
    expect(screen.getByRole('alert')).toBeTruthy();
    mocks.graph = null;
    rerender(<Map />);
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('registers the wrapped native map with its original route settings', () => {
    expect(mocks.registerRoute).toHaveBeenCalledOnce();
    expect(mocks.registerRoute).toHaveBeenCalledWith({
      ...mocks.mapRoute,
      component: expect.any(Function),
    });
    expect(nativeMap()).not.toBe(mocks.mapRoute.component);
  });
});
