import { describe, expect, it } from 'vitest';
import { buildManagedGraph } from './buildManagedGraph';

function resource(
  kind: string,
  name: string,
  group = 'account.btp.sap.crossplane.io',
  extra: any = {}
) {
  return {
    _kind: kind,
    jsonData: { apiVersion: `${group}/v1alpha1`, kind, metadata: { name }, ...extra },
  };
}

function graphEdges(graph: ReturnType<typeof buildManagedGraph>, edges = graph.parentEdges) {
  return edges.map(edge => ({
    source: graph.nodes.find(node => node.id === edge.source)?.kubeObject,
    target: graph.nodes.find(node => node.id === edge.target)?.kubeObject,
  }));
}

describe('managed resource graph identity and references', () => {
  it('retains equal names across API groups, namespaces, and kinds', () => {
    const btp = resource('ServiceInstance', 'same');
    const cf = resource('ServiceInstance', 'same', 'cloudfoundry.crossplane.io');
    const firstNamespace = resource('ServiceInstance', 'same', undefined, {
      metadata: { name: 'same', namespace: 'one' },
    });
    const secondNamespace = resource('ServiceInstance', 'same', undefined, {
      metadata: { name: 'same', namespace: 'two' },
    });
    const otherKind = resource('ServiceManager', 'same');
    const instances = [btp, cf, firstNamespace, secondNamespace, otherKind];
    const graph = buildManagedGraph(instances, []);
    expect(graph.nodes.map(node => node.kubeObject)).toEqual(instances);
    expect(new Set(graph.nodes.map(node => node.id)).size).toBe(instances.length);
    // React Flow interpolates node IDs into attribute selectors for internal updates.
    const container = document.createElement('div');
    for (const node of graph.nodes) {
      const element = document.createElement('div');
      element.dataset.id = node.id;
      container.appendChild(element);
      expect(container.querySelector(`[data-id="${node.id}"]`)).toBe(element);
    }
  });

  it('uses raw UID for identity and ignores repeated occurrences when resolving a target', () => {
    const manager = resource('ServiceManager', 'manager', undefined, {
      metadata: { name: 'manager', uid: 'manager-resource-uid' },
    });
    const instance = resource('ServiceInstance', 'instance', undefined, {
      spec: { forProvider: { serviceManagerRef: { name: 'manager' } } },
    });
    const graph = buildManagedGraph([manager, { ...manager }, instance], []);
    expect(graph.nodes).toHaveLength(2);
    expect(graph.nodes[0].id).toBe('manager-resource-uid');
    expect(graphEdges(graph)).toEqual([{ source: manager, target: instance }]);
  });

  it('omits missing and ambiguous targets, but resolves a unique target across API groups', () => {
    const instance = resource('ServiceInstance', 'instance', undefined, {
      spec: { forProvider: { serviceManagerRef: { name: 'manager' } } },
    });
    const manager = resource('ServiceManager', 'manager', 'other.example.org');
    const collision = resource('ServiceManager', 'manager');
    expect(buildManagedGraph([instance], []).parentEdges).toEqual([]);
    const unique = buildManagedGraph([instance, manager], []);
    expect(graphEdges(unique)).toEqual([{ source: manager, target: instance }]);
    const ambiguous = buildManagedGraph([instance, manager, collision], []);
    expect(ambiguous.nodes).toHaveLength(3);
    expect(ambiguous.parentEdges).toEqual([]);
  });

  it('does not prefer a source namespace when name-based target lookup is ambiguous', () => {
    const manager = resource('ServiceManager', 'manager', undefined, {
      metadata: { name: 'manager', namespace: 'one' },
    });
    const collision = resource('ServiceManager', 'manager', undefined, {
      metadata: { name: 'manager', namespace: 'two' },
    });
    const instance = resource('ServiceInstance', 'instance', undefined, {
      metadata: { name: 'instance', namespace: 'one' },
      spec: { forProvider: { serviceManagerRef: { name: 'manager' } } },
    });
    expect(buildManagedGraph([manager, collision, instance], []).parentEdges).toEqual([]);
  });

  it('preserves parent priority, Cloud Foundry Space extras, and subaccount-scoped Entitlement matching', () => {
    const accountA = resource('Subaccount', 'account-a');
    const accountB = resource('Subaccount', 'account-b');
    const manager = resource('ServiceManager', 'manager', undefined, {
      spec: { forProvider: { subaccountRef: { name: 'account-a' } } },
    });
    const entitlementA = resource('Entitlement', 'entitlement-a', undefined, {
      spec: {
        forProvider: {
          serviceName: 'aicore',
          servicePlanName: 'standard',
          subaccountRef: { name: 'account-a' },
        },
      },
    });
    const entitlementB = resource('Entitlement', 'entitlement-b', undefined, {
      spec: {
        forProvider: {
          serviceName: 'aicore',
          servicePlanName: 'standard',
          subaccountRef: { name: 'account-b' },
        },
      },
    });
    const instance = resource('ServiceInstance', 'same-instance', undefined, {
      spec: {
        forProvider: {
          serviceManagerRef: { name: 'manager' },
          offeringName: 'aicore',
          planName: 'standard',
        },
      },
    });
    const space = resource('Space', 'space', 'cloudfoundry.crossplane.io');
    const cfInstance = resource('ServiceInstance', 'same-instance', 'cloudfoundry.crossplane.io', {
      spec: { forProvider: { spaceRef: { name: 'space' }, type: 'managed' } },
    });
    const graph = buildManagedGraph(
      [accountA, accountB, manager, entitlementA, entitlementB, instance, space, cfInstance],
      []
    );
    expect(graph.nodes).toHaveLength(8);
    expect(graphEdges(graph)).toEqual([
      { source: accountA, target: manager },
      { source: accountA, target: entitlementA },
      { source: accountB, target: entitlementB },
      { source: manager, target: instance },
    ]);
    expect(graphEdges(graph, graph.auxEdges)).toEqual([
      { source: entitlementA, target: instance },
      { source: space, target: cfInstance },
    ]);
    expect(buildManagedGraph([manager, entitlementB, instance], []).auxEdges).toEqual([]);
    const duplicateEntitlement = resource('Entitlement', 'entitlement-a-dup', undefined, {
      spec: entitlementA.jsonData.spec,
    });
    expect(
      buildManagedGraph([manager, entitlementA, duplicateEntitlement, instance], []).auxEdges
    ).toEqual([]);
  });
});
