import { act, fireEvent, render, renderHook, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const Container = ({ children }: any) => children;
  (window as any).pluginLib = {
    MuiCore: {
      Typography: Container,
      Box: Container,
      Paper: Container,
      Chip: ({ label }: any) => label,
      CircularProgress: () => 'Loading',
      FormControl: Container,
      InputLabel: () => null,
      InputAdornment: Container,
      FormControlLabel: () => null,
      Checkbox: () => null,
      TextField: () => null,
      Select: () => null,
      MenuItem: () => null,
    },
  };
  return {
    cluster: 'cluster-a',
    crds: [] as any[],
    providers: [] as any[],
    revisions: [] as any[],
    connect: vi.fn(),
    streams: [] as {
      definition: any;
      onList: (items: any[]) => void;
      onError: (error: any) => void;
      options: any;
      cancel: ReturnType<typeof vi.fn>;
    }[],
  };
});

vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    useCluster: () => mocks.cluster,
    ResourceClasses: {
      CustomResourceDefinition: class {
        static useList() {
          return [mocks.crds, null];
        }
        constructor(public jsonData: any) {}
        makeCRClass() {
          const definition = this.jsonData;
          return {
            apiList: (onList: any, onError: any, options: any) => () => {
              const cancel = vi.fn();
              const stream = { definition, onList, onError, options, cancel };
              mocks.streams.push(stream);
              return mocks.connect(stream);
            },
          };
        }
      },
    },
  },
}));

vi.mock('../common/Resources', () => ({
  ProviderRevision: { useList: () => [mocks.revisions, null] },
}));

vi.mock('../providers/provider', () => ({
  Provider: { useList: () => [mocks.providers, null] },
}));

import { useAllManagedResources } from '../helpers';
import { useCustomResourceList, useCustomResourceLists } from '../helpers/useCustomResources';
import ResourceList from '../resources/ResourceList';

function crd(plural = 'buckets', scope = 'Cluster') {
  const metadata = { name: `${plural}.example.org` };
  return {
    metadata,
    jsonData: {
      metadata,
      spec: {
        group: 'example.org',
        scope,
        names: { plural, singular: plural.slice(0, -1), kind: 'Bucket' },
        versions: [
          { name: 'v1alpha1', served: false, storage: false },
          { name: 'v1beta1', served: true, storage: false },
          { name: 'v1', served: true, storage: true },
        ],
      },
    },
  };
}

function publish(index: number, items: any[]) {
  act(() => mocks.streams[index].onList(items.map(jsonData => ({ jsonData }))));
}

beforeEach(() => {
  mocks.cluster = 'cluster-a';
  mocks.crds = [];
  mocks.providers = [];
  mocks.revisions = [];
  mocks.streams = [];
  mocks.connect.mockReset();
  mocks.connect.mockImplementation(stream => Promise.resolve(stream.cancel));
});

describe('useCustomResourceLists', () => {
  it('updates lists for resource additions, condition changes, and deletions', () => {
    const definition = crd();
    const { result } = renderHook(() => useCustomResourceLists([definition]));
    expect(result.current.loading).toBe(true);
    publish(0, []);
    expect(result.current.loading).toBe(false);

    const item = {
      metadata: { name: 'test' },
      status: { conditions: [{ type: 'Ready', status: 'False' }] },
    };
    publish(0, [item]);
    expect(result.current.lists.get(definition.metadata.name)).toEqual([item]);
    const ready = { ...item, status: { conditions: [{ type: 'Ready', status: 'True' }] } };
    publish(0, [ready]);
    expect(result.current.lists.get(definition.metadata.name)?.[0].status).toEqual(ready.status);
    publish(0, []);
    expect(result.current.lists.get(definition.metadata.name)).toEqual([]);
  });

  it('waits for discovery and handles an empty set without opening a stream', () => {
    const { result, rerender } = renderHook(({ crds }) => useCustomResourceLists(crds), {
      initialProps: { crds: null as any[] | null },
    });
    expect(result.current.loading).toBe(true);
    rerender({ crds: [] });
    expect(result.current.loading).toBe(false);
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('prefers the served storage version and excludes unserved versions', () => {
    renderHook(() => useCustomResourceLists([crd()]));
    expect(mocks.streams[0].definition.spec.versions.map((v: any) => v.name)).toEqual([
      'v1',
      'v1beta1',
    ]);
  });

  it('deduplicates types referenced by multiple providers', () => {
    renderHook(() => useCustomResourceLists([crd(), crd()]));
    expect(mocks.connect).toHaveBeenCalledOnce();
  });

  it('reports CRDs without a served version instead of leaving them loading', async () => {
    const definition = crd();
    definition.jsonData.spec.versions = [];
    const { result } = renderHook(() => useCustomResourceLists([definition]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errors.get(definition.metadata.name)?.message).toContain(
      'No served version'
    );
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('does not restart streams on CRD status updates or new array references', () => {
    const { rerender } = renderHook(({ crds }) => useCustomResourceLists(crds), {
      initialProps: { crds: [crd('buckets'), crd('vpcs')] },
    });
    const updated = crd('buckets');
    (updated.jsonData as any).status = { conditions: [{ status: 'True' }] };
    rerender({ crds: [crd('vpcs'), updated] });
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });

  it('stops old streams on cluster changes and ignores late callbacks', async () => {
    const { result, rerender, unmount } = renderHook(() => useCustomResourceLists([crd()]));
    publish(0, [{ metadata: { name: 'old' } }]);
    await act(async () => {});
    mocks.cluster = 'cluster-b';
    rerender();
    expect(mocks.streams[0].cancel).toHaveBeenCalledOnce();
    expect(mocks.streams[1].options.cluster).toBe('cluster-b');
    expect(result.current.lists.size).toBe(0);
    publish(0, [{ metadata: { name: 'late' } }]);
    expect(result.current.lists.size).toBe(0);
    await act(async () => {});
    unmount();
    expect(mocks.streams[1].cancel).toHaveBeenCalledOnce();
  });

  it('cancels a connection that resolves after unmount', async () => {
    let resolve!: (cancel: () => void) => void;
    mocks.connect.mockImplementation(
      () =>
        new Promise(r => {
          resolve = r;
        })
    );
    const { unmount } = renderHook(() => useCustomResourceLists([crd()]));
    unmount();
    await act(async () => resolve(mocks.streams[0].cancel));
    expect(mocks.streams[0].cancel).toHaveBeenCalledOnce();
  });

  it('settles errors independently and recovers on the next successful update', () => {
    const { result } = renderHook(() => useCustomResourceLists([crd('buckets'), crd('vpcs')]));
    const error = new Error('Forbidden');
    act(() => mocks.streams[0].onError(error));
    expect(result.current.loading).toBe(true);
    publish(1, []);
    expect(result.current.loading).toBe(false);
    expect(result.current.errors.get('buckets.example.org')).toBe(error);
    publish(0, []);
    expect(result.current.errors.size).toBe(0);
  });

  it('reports connection failures rather than remaining in loading state', async () => {
    mocks.connect.mockRejectedValue(new Error('Connection failed'));
    const { result } = renderHook(() => useCustomResourceLists([crd()]));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.errors.get('buckets.example.org')?.message).toBe('Connection failed');
  });

  it('scopes detail subscriptions by namespace and name, including deletion updates', () => {
    const { result } = renderHook(() =>
      useCustomResourceList(crd('buckets', 'Namespaced'), {
        name: 'test',
        namespace: 'team-a',
      })
    );
    expect(mocks.streams[0].definition.spec.scope).toBe('Namespaced');
    expect(mocks.streams[0].options).toMatchObject({
      namespace: 'team-a',
      queryParams: { fieldSelector: 'metadata.name=test' },
    });
    publish(0, [{ metadata: { name: 'test', namespace: 'team-a' } }]);
    expect(result.current.items).toHaveLength(1);
    publish(0, []);
    expect(result.current.items).toEqual([]);
  });
});

describe('useAllManagedResources', () => {
  it('watches the active revision and updates provider totals without a page reload', async () => {
    mocks.crds = [crd(), crd('providerconfigs'), crd('vpcs')];
    mocks.providers = [{ metadata: { name: 'provider-a' }, currentRevision: 'revision-a' }];
    mocks.revisions = [
      {
        metadata: { name: 'revision-a' },
        jsonData: {
          status: {
            objectRefs: mocks.crds.slice(0, 2).map(c => ({ name: c.metadata.name })),
          },
        },
      },
    ];
    const { result, rerender } = renderHook(() => useAllManagedResources());
    expect(mocks.streams).toHaveLength(1);
    publish(0, [{ metadata: { name: 'test' }, status: { conditions: [] } }]);
    expect(result.current.items).toMatchObject([
      { _providerName: 'provider-a', _plural: 'buckets' },
    ]);
    publish(0, []);
    expect(result.current.items).toEqual([]);

    await act(async () => {});
    mocks.providers = [{ metadata: { name: 'provider-a' }, currentRevision: 'revision-b' }];
    mocks.revisions = [
      {
        metadata: { name: 'revision-b' },
        jsonData: {
          status: {
            objectRefs: [{ name: 'vpcs.example.org' }],
          },
        },
      },
    ];
    rerender();
    expect(mocks.streams[0].cancel).toHaveBeenCalledOnce();
    expect(mocks.streams[1].definition.metadata.name).toBe('vpcs.example.org');
    publish(1, [{ metadata: { name: 'new-vpc' } }]);
    expect(result.current.items).toMatchObject([
      { _plural: 'vpcs', metadata: { name: 'new-vpc' } },
    ]);
  });
});

// Render the actual Resources page with lightweight host UI components. This
// verifies that counters and expanded rows consume the same watched snapshots.
describe('Managed Resources page', () => {
  it('updates counts and expanded rows when a resource becomes ready or is deleted', async () => {
    mocks.crds = [crd()];
    mocks.providers = [
      { metadata: { name: 'provider-a' }, jsonData: { status: { currentRevision: 'revision-a' } } },
    ];
    mocks.revisions = [
      {
        metadata: { name: 'revision-a' },
        jsonData: { status: { objectRefs: [{ name: 'buckets.example.org' }] } },
      },
    ];
    render(
      <MemoryRouter>
        <ResourceList />
      </MemoryRouter>
    );
    const item = {
      metadata: { name: 'test-bucket' },
      status: {
        conditions: [
          { type: 'Ready', status: 'False' },
          { type: 'Synced', status: 'True' },
        ],
      },
    };
    publish(0, [item]);
    expect(screen.getByText('1 not ready')).toBeTruthy();
    fireEvent.click(screen.getByText('Bucket'));
    expect(screen.getByText('test-bucket')).toBeTruthy();
    expect(screen.getByText('Not Ready')).toBeTruthy();
    // Expanding a row reuses its list and must not create another subscription.
    expect(mocks.connect).toHaveBeenCalledOnce();
    publish(0, [
      {
        ...item,
        status: {
          conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'Synced', status: 'True' },
          ],
        },
      },
    ]);
    expect(screen.getByText('1 ready')).toBeTruthy();
    expect(screen.queryByText('Not Ready')).toBeNull();
    publish(0, []);
    expect(screen.queryByText('test-bucket')).toBeNull();
    expect(screen.getByText(/No resource types with instances/)).toBeTruthy();
  });
});
