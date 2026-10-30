import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  crds: vi.fn(),
  revisions: vi.fn(),
  providers: vi.fn(),
  cluster: vi.fn((): string | null => 'cluster-a'),
  selectedClusters: vi.fn((): string[] => []),
  allowedNamespaces: vi.fn((): string[] => []),
}));
vi.mock('@kinvolk/headlamp-plugin/lib', () => ({
  K8s: {
    ResourceClasses: { CustomResourceDefinition: { useList: mocks.crds } },
    useCluster: mocks.cluster,
    useSelectedClusters: mocks.selectedClusters,
    cluster: { getAllowedNamespaces: mocks.allowedNamespaces },
  },
}));
vi.mock('../../common/Resources', () => ({ ProviderRevision: { useList: mocks.revisions } }));
vi.mock('../../providers/provider', () => ({ Provider: { useList: mocks.providers } }));

import { ManagedInstance } from './types';
import { useManagedGraph } from './useManagedGraph';

type Subscription = {
  crdName: string;
  cluster: string;
  namespace?: string;
  onList: (items: ManagedInstance[]) => void;
  onError: (error: Error) => void;
  cancel: ReturnType<typeof vi.fn>;
  resolveCancel?: (cancel: () => void) => void;
};
const subscriptions: Subscription[] = [];
const initialData = new Map<string, ManagedInstance[] | Error | null>();
let delayCancellation = false;

function resource(kind: string, name: string, extra: any = {}) {
  return {
    jsonData: {
      apiVersion: 'account.btp.sap.crossplane.io/v1alpha1',
      kind,
      metadata: { name, uid: 'uid-' + name },
      ...extra,
    },
  };
}

function crd(kind: string, plural: string, scope = 'Cluster') {
  const name = plural + '.account.btp.sap.crossplane.io';
  const resourceClass = {
    create: (jsonData: any, cluster: string) => ({ jsonData, cluster }),
    apiList: vi.fn((onList, onError, options) => () => {
      const subscription: Subscription = {
        crdName: name,
        cluster: options.cluster,
        namespace: options.namespace,
        onList,
        onError,
        cancel: vi.fn(),
      };
      subscriptions.push(subscription);
      const dataKey = options.namespace ? `${name}/${options.namespace}` : name;
      const initial = initialData.has(dataKey) ? initialData.get(dataKey) : [];
      if (initial instanceof Error) onError(initial);
      else if (initial !== null) onList(initial);
      return delayCancellation
        ? new Promise<() => void>(resolve => (subscription.resolveCancel = resolve))
        : Promise.resolve(subscription.cancel);
    }),
  };
  return {
    metadata: { name, uid: 'crd-' + name, resourceVersion: '1' },
    jsonData: {
      spec: {
        group: 'account.btp.sap.crossplane.io',
        names: { kind, plural },
        scope,
        versions: [{ name: 'v1alpha1', served: true, storage: true }],
      },
    },
    makeCRClass: vi.fn(() => resourceClass),
  };
}

function discover(crds: ReturnType<typeof crd>[], referenceKind = 'CustomResourceDefinition') {
  mocks.crds.mockReturnValue([crds, null]);
  mocks.revisions.mockReturnValue([
    [
      {
        metadata: { name: 'active-revision' },
        jsonData: {
          status: {
            objectRefs: crds.map(item => ({ kind: referenceKind, name: item.metadata.name })),
          },
        },
      },
    ],
    null,
  ]);
}

function readyProviders() {
  mocks.providers.mockReturnValue([
    [
      {
        metadata: { name: 'installed-btp-provider' },
        jsonData: { status: { currentRevision: 'active-revision' } },
      },
    ],
    null,
  ]);
}

beforeEach(() => {
  vi.clearAllMocks();
  subscriptions.length = 0;
  initialData.clear();
  delayCancellation = false;
  mocks.crds.mockReturnValue([[], null]);
  mocks.revisions.mockReturnValue([[], null]);
  mocks.providers.mockReturnValue([[], null]);
  mocks.cluster.mockReturnValue('cluster-a');
  mocks.selectedClusters.mockReturnValue([]);
  mocks.allowedNamespaces.mockReturnValue([]);
});
afterEach(cleanup);

describe('managed graph discovery and subscriptions', () => {
  it('binds all discovery and resource requests to the active cluster or selected-cluster fallback', () => {
    discover([crd('ServiceInstance', 'serviceinstances')]);
    const { result, rerender } = renderHook(useManagedGraph);
    for (const cluster of ['cluster-a', 'cluster-b']) {
      mocks.cluster.mockReturnValue(cluster);
      rerender();
      expect(mocks.crds).toHaveBeenLastCalledWith({ cluster });
      expect(mocks.revisions).toHaveBeenLastCalledWith({ cluster });
      expect(mocks.providers).toHaveBeenLastCalledWith({ cluster });
      expect(mocks.allowedNamespaces).toHaveBeenLastCalledWith(cluster);
      expect(subscriptions[subscriptions.length - 1].cluster).toBe(cluster);
    }
    mocks.cluster.mockReturnValue(null);
    mocks.selectedClusters.mockReturnValue(['project-cluster']);
    rerender();
    expect(subscriptions[subscriptions.length - 1].cluster).toBe('project-cluster');
    mocks.selectedClusters.mockReturnValue([]);
    rerender();
    expect(result.current).toEqual({ nodes: [], edges: [], error: undefined, resourceErrors: [] });
  });

  it('merges allowed namespaces without widening namespaced requests or duplicating cluster resources', () => {
    const managerCRD = crd('ServiceManager', 'servicemanagers');
    const instanceCRD = crd('ServiceInstance', 'serviceinstances', 'Namespaced');
    discover([managerCRD, instanceCRD]);
    mocks.allowedNamespaces.mockReturnValue(['team-b', 'team-a', 'team-a']);
    initialData.set(managerCRD.metadata.name, [resource('ServiceManager', 'manager')]);
    for (const namespace of ['team-a', 'team-b']) {
      initialData.set(`${instanceCRD.metadata.name}/${namespace}`, [
        resource('ServiceInstance', 'shared', {
          metadata: { name: 'shared', namespace, uid: `uid-${namespace}` },
        }),
      ]);
    }
    const { result, rerender } = renderHook(useManagedGraph);
    expect(subscriptions.map(({ crdName, namespace }) => [crdName, namespace])).toEqual([
      [managerCRD.metadata.name, undefined],
      [instanceCRD.metadata.name, 'team-a'],
      [instanceCRD.metadata.name, 'team-b'],
    ]);
    expect(result.current?.nodes).toHaveLength(3);
    expect(result.current?.nodes.map(node => node.kubeObject.jsonData.metadata.namespace)).toEqual([
      undefined,
      'team-a',
      'team-b',
    ]);
    mocks.allowedNamespaces.mockReturnValue(['team-a', 'team-b']);
    rerender();
    expect(subscriptions).toHaveLength(3);
  });

  it('waits for every namespace, retains successful siblings and clears only the recovered error', () => {
    const definition = crd('ServiceInstance', 'serviceinstances', 'Namespaced');
    discover([definition]);
    mocks.allowedNamespaces.mockReturnValue(['team-a', 'team-b']);
    initialData.set(`${definition.metadata.name}/team-a`, [resource('ServiceInstance', 'first')]);
    initialData.set(`${definition.metadata.name}/team-b`, null);
    const { result } = renderHook(useManagedGraph);
    expect(result.current).toBeNull();
    const error = new Error('Forbidden in team-b');
    act(() => subscriptions[1].onError(error));
    expect(result.current?.nodes).toHaveLength(1);
    expect(result.current?.resourceErrors).toEqual([
      { crdName: definition.metadata.name, namespace: 'team-b', error },
    ]);
    act(() => subscriptions[0].onList([resource('ServiceInstance', 'updated')]));
    expect(result.current?.resourceErrors).toHaveLength(1);
    act(() => subscriptions[1].onList([resource('ServiceInstance', 'second')]));
    expect(result.current?.nodes.map(node => node.kubeObject.jsonData.metadata.name)).toEqual([
      'updated',
      'second',
    ]);
    expect(result.current?.resourceErrors).toEqual([]);
  });

  it('drops obsolete namespace data and ignores callbacks after namespace settings change', async () => {
    const definition = crd('ServiceInstance', 'serviceinstances', 'Namespaced');
    discover([definition]);
    mocks.allowedNamespaces.mockReturnValue(['team-a']);
    initialData.set(`${definition.metadata.name}/team-a`, [resource('ServiceInstance', 'old')]);
    initialData.set(`${definition.metadata.name}/team-b`, null);
    const { result, rerender } = renderHook(useManagedGraph);
    await act(async () => {});
    const old = subscriptions[0];
    mocks.allowedNamespaces.mockReturnValue(['team-b']);
    rerender();
    expect(result.current).toBeNull();
    expect(old.cancel).toHaveBeenCalledOnce();
    expect(subscriptions[1].namespace).toBe('team-b');
    act(() => old.onList([resource('ServiceInstance', 'stale')]));
    expect(result.current).toBeNull();
    act(() => subscriptions[1].onList([resource('ServiceInstance', 'new')]));
    expect(result.current?.nodes.map(node => node.kubeObject.jsonData.metadata.name)).toEqual([
      'new',
    ]);
  });

  it('uses an all-namespace subscription when no namespace restriction is configured', () => {
    discover([crd('ServiceInstance', 'serviceinstances', 'Namespaced')]);
    renderHook(useManagedGraph);
    expect(subscriptions).toHaveLength(1);
    expect(subscriptions[0].namespace).toBeUndefined();
  });

  it('discovers MRD references and retains provider ownership while excluding infrastructure', () => {
    const managerCRD = crd('ServiceManager', 'servicemanagers');
    const configCRD = crd('ProviderConfig', 'providerconfigs');
    discover([managerCRD, configCRD], 'ManagedResourceDefinition');
    readyProviders();
    initialData.set(managerCRD.metadata.name, [resource('ServiceManager', 'manager')]);
    const { result } = renderHook(useManagedGraph);
    expect(result.current?.nodes).toHaveLength(1);
    expect(result.current?.nodes[0].providerName).toBe('installed-btp-provider');
    expect(subscriptions.map(item => item.crdName)).toEqual([managerCRD.metadata.name]);
    expect(configCRD.makeCRClass).not.toHaveBeenCalled();
  });

  it('updates status, nodes and relationships from successive Headlamp list callbacks', () => {
    const managerCRD = crd('ServiceManager', 'servicemanagers');
    const instanceCRD = crd('ServiceInstance', 'serviceinstances');
    discover([managerCRD, instanceCRD]);
    const manager = resource('ServiceManager', 'manager');
    const instance = resource('ServiceInstance', 'instance', {
      spec: { forProvider: { serviceManagerRef: { name: 'manager' } } },
    });
    initialData.set(managerCRD.metadata.name, [manager]);
    const { result, rerender } = renderHook(useManagedGraph);
    expect(result.current?.nodes[0].status).toBe('error');
    act(() => subscriptions[1].onList([instance]));
    expect(result.current?.nodes).toHaveLength(2);
    expect(result.current?.edges).toHaveLength(1);
    act(() => {
      manager.jsonData.status = {
        conditions: [
          { type: 'Ready', status: 'True' },
          { type: 'Synced', status: 'True' },
        ],
      };
      subscriptions[0].onList([manager]);
    });
    expect(result.current?.nodes[0].status).toBe('success');
    act(() => subscriptions[0].onList([]));
    expect(result.current?.nodes).toHaveLength(1);
    expect(result.current?.edges).toEqual([]);
    const graph = result.current;
    rerender();
    expect(result.current).toBe(graph);
    expect(subscriptions).toHaveLength(2);
    expect(subscriptions.every(item => item.cluster === 'cluster-a')).toBe(true);
  });

  it('retains successful collections, reports per-CRD failures and clears recovered errors', () => {
    const managerCRD = crd('ServiceManager', 'servicemanagers');
    const instanceCRD = crd('ServiceInstance', 'serviceinstances');
    discover([managerCRD, instanceCRD]);
    initialData.set(managerCRD.metadata.name, [resource('ServiceManager', 'manager')]);
    const error = new Error('Forbidden');
    initialData.set(instanceCRD.metadata.name, error);
    const { result } = renderHook(useManagedGraph);
    expect(result.current?.nodes).toHaveLength(1);
    expect(result.current?.resourceErrors).toEqual([{ crdName: instanceCRD.metadata.name, error }]);
    act(() => subscriptions[1].onList([resource('ServiceInstance', 'instance')]));
    expect(result.current?.nodes).toHaveLength(2);
    expect(result.current?.resourceErrors).toEqual([]);
    act(() => subscriptions[1].onError(error));
    expect(result.current?.nodes).toHaveLength(2);
    expect(result.current?.resourceErrors).toEqual([{ crdName: instanceCRD.metadata.name, error }]);
  });

  it('preserves previous resource versions when apiList mutates its backing objects', () => {
    const definition = crd('ServiceInstance', 'serviceinstances');
    discover([definition]);
    const instance = resource('ServiceInstance', 'instance', {
      metadata: { name: 'instance', uid: 'uid-instance', resourceVersion: '1' },
      status: { conditions: [{ type: 'Ready', status: 'False' }] },
    });
    initialData.set(definition.metadata.name, [instance]);
    const { result } = renderHook(useManagedGraph);
    const previous = result.current!.nodes[0];
    act(() => {
      Object.assign(instance.jsonData, {
        metadata: { ...instance.jsonData.metadata, resourceVersion: '2' },
        status: {
          conditions: [
            { type: 'Ready', status: 'True' },
            { type: 'Synced', status: 'True' },
          ],
        },
      });
      subscriptions[0].onList([instance]);
    });
    const current = result.current!.nodes[0];
    expect(previous.kubeObject.jsonData.metadata.resourceVersion).toBe('1');
    expect(previous.kubeObject.jsonData.status.conditions[0].status).toBe('False');
    expect(current.kubeObject.jsonData.metadata.resourceVersion).toBe('2');
    expect(current.kubeObject.cluster).toBe('cluster-a');
    expect(current.status).toBe('success');
  });

  it('settles failed collections without treating them as successful empty data', () => {
    const definition = crd('ServiceInstance', 'serviceinstances');
    discover([definition]);
    initialData.set(definition.metadata.name, new Error('Forbidden'));
    const { result } = renderHook(useManagedGraph);
    expect(result.current?.nodes).toEqual([]);
    expect(result.current?.resourceErrors).toHaveLength(1);
  });

  it('reports rejected subscription starts', async () => {
    const definition = crd('ServiceInstance', 'serviceinstances');
    const error = new Error('Subscription failed');
    definition.makeCRClass().apiList.mockReturnValue(() => Promise.reject(error));
    discover([definition]);
    const { result } = renderHook(useManagedGraph);
    await waitFor(() =>
      expect(result.current?.resourceErrors).toEqual([{ crdName: definition.metadata.name, error }])
    );
  });

  it.each([
    [
      'version',
      (definition: ReturnType<typeof crd>) => {
        definition.jsonData.spec.versions[0].name = 'v1beta1';
      },
    ],
    [
      'served version',
      (definition: ReturnType<typeof crd>) => {
        definition.jsonData.spec.versions[0].served = false;
      },
    ],
    [
      'storage version',
      (definition: ReturnType<typeof crd>) => {
        definition.jsonData.spec.versions[0].storage = false;
      },
    ],
    [
      'group',
      (definition: ReturnType<typeof crd>) => {
        definition.jsonData.spec.group = 'new.example.org';
      },
    ],
    [
      'plural',
      (definition: ReturnType<typeof crd>) => {
        definition.jsonData.spec.names.plural = 'newinstances';
      },
    ],
    [
      'kind',
      (definition: ReturnType<typeof crd>) => {
        definition.jsonData.spec.names.kind = 'NewInstance';
      },
    ],
    [
      'scope',
      (definition: ReturnType<typeof crd>) => {
        definition.jsonData.spec.scope = 'Namespaced';
      },
    ],
    [
      'CRD identity',
      (definition: ReturnType<typeof crd>) => {
        definition.metadata.uid = 'replacement-crd';
      },
    ],
  ] as const)('resubscribes when %s changes without a CRD-name change', async (_label, change) => {
    const definition = crd('ServiceInstance', 'serviceinstances');
    discover([definition]);
    const { rerender, unmount } = renderHook(useManagedGraph);
    await act(async () => {});
    const previous = subscriptions[0];
    change(definition);
    rerender();
    await act(async () => {});
    expect(previous.cancel).toHaveBeenCalledOnce();
    expect(subscriptions).toHaveLength(2);
    expect(definition.makeCRClass).toHaveBeenCalledTimes(2);
    unmount();
    expect(subscriptions[1].cancel).toHaveBeenCalledOnce();
  });

  it('keeps subscriptions across metadata-only changes and CRD reordering', () => {
    const managerCRD = crd('ServiceManager', 'servicemanagers');
    const instanceCRD = crd('ServiceInstance', 'serviceinstances');
    discover([managerCRD, instanceCRD]);
    const { rerender } = renderHook(useManagedGraph);
    managerCRD.metadata.resourceVersion = '2';
    discover([instanceCRD, managerCRD]);
    rerender();
    expect(subscriptions).toHaveLength(2);
  });

  it('drops obsolete cluster data and ignores late callbacks from its cancelled subscriptions', async () => {
    const definition = crd('ServiceInstance', 'serviceinstances');
    discover([definition]);
    initialData.set(definition.metadata.name, [resource('ServiceInstance', 'old-cluster')]);
    const { result, rerender } = renderHook(useManagedGraph);
    await act(async () => {});
    const old = subscriptions[0];
    initialData.set(definition.metadata.name, null);
    mocks.cluster.mockReturnValue('cluster-b');
    rerender();
    expect(result.current).toBeNull();
    expect(old.cancel).toHaveBeenCalledOnce();
    expect(subscriptions[1].cluster).toBe('cluster-b');
    act(() => {
      old.onList([resource('ServiceInstance', 'stale')]);
      old.onError(new Error('Old failure'));
    });
    expect(result.current).toBeNull();
    act(() => subscriptions[1].onList([resource('ServiceInstance', 'new-cluster')]));
    expect(result.current?.nodes.map(node => node.kubeObject.jsonData.metadata.name)).toEqual([
      'new-cluster',
    ]);
    expect(result.current?.resourceErrors).toEqual([]);
  });

  it('cancels removed CRDs and starts watching newly discovered kinds', async () => {
    const managerCRD = crd('ServiceManager', 'servicemanagers');
    const instanceCRD = crd('ServiceInstance', 'serviceinstances');
    initialData.set(managerCRD.metadata.name, [resource('ServiceManager', 'manager')]);
    discover([managerCRD]);
    const { result, rerender } = renderHook(useManagedGraph);
    await act(async () => {});
    const old = subscriptions[0];
    initialData.set(instanceCRD.metadata.name, [resource('ServiceInstance', 'instance')]);
    discover([instanceCRD]);
    rerender();
    expect(old.cancel).toHaveBeenCalledOnce();
    expect(result.current?.nodes.map(node => node.kubeObject.jsonData.kind)).toEqual([
      'ServiceInstance',
    ]);
    act(() => old.onList([resource('ServiceManager', 'stale')]));
    expect(result.current?.nodes).toHaveLength(1);
    discover([]);
    rerender();
    expect(result.current).toEqual({ nodes: [], edges: [], error: undefined, resourceErrors: [] });
  });

  it('stops a subscription even when its cancel function resolves after unmount', async () => {
    delayCancellation = true;
    discover([crd('ServiceInstance', 'serviceinstances')]);
    const { unmount } = renderHook(useManagedGraph);
    const subscription = subscriptions[0];
    unmount();
    await act(async () => subscription.resolveCancel!(subscription.cancel));
    expect(subscription.cancel).toHaveBeenCalledOnce();
  });

  it('waits for provider ownership, then updates ownership without resubscribing', () => {
    const definition = crd('ServiceManager', 'servicemanagers');
    discover([definition]);
    initialData.set(definition.metadata.name, [resource('ServiceManager', 'manager')]);
    mocks.providers.mockReturnValue([null, null]);
    const { result, rerender } = renderHook(useManagedGraph);
    expect(result.current).toBeNull();
    readyProviders();
    rerender();
    expect(result.current?.nodes[0].providerName).toBe('installed-btp-provider');
    expect(subscriptions).toHaveLength(1);
    mocks.providers.mockReturnValue([null, new Error('Provider discovery forbidden')]);
    rerender();
    expect(result.current?.nodes[0].providerName).toBeUndefined();
    expect(result.current?.error).toBeUndefined();
  });

  it.each(['crds', 'revisions'] as const)(
    'surfaces a %s discovery error and cancels instance watches',
    async source => {
      discover([crd('ServiceInstance', 'serviceinstances')]);
      const { result, rerender } = renderHook(useManagedGraph);
      await act(async () => {});
      const error = new Error('Discovery denied');
      mocks[source].mockReturnValue([null, error]);
      rerender();
      expect(result.current).toEqual({ nodes: [], edges: [], error, resourceErrors: [] });
      expect(subscriptions[0].cancel).toHaveBeenCalledOnce();
    }
  );

  it('shows a successful empty graph without waiting for provider discovery', () => {
    mocks.providers.mockReturnValue([null, null]);
    const { result } = renderHook(useManagedGraph);
    expect(result.current).toEqual({ nodes: [], edges: [], error: undefined, resourceErrors: [] });
  });
});
