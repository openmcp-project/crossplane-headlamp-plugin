import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useMemo, useState } from 'react';

interface ResourceDefinition {
  name: string;
  spec: {
    group: string;
    scope: string;
    names: { plural: string; singular: string; kind: string };
    versions: { name: string; served: boolean; storage: boolean }[];
  };
}

interface ResourceLists {
  key: string;
  lists: Map<string, any[]>;
  errors: Map<string, any>;
  loading: boolean;
}

/** List and watch dynamic CRD types using Headlamp's streaming resource API. */
export function useCustomResourceLists(
  crds: any[] | null,
  { name, namespace }: { name?: string; namespace?: string } = {}
) {
  const cluster = K8s.useCluster();
  // CRD watch events and callers can create new arrays on every render. Only
  // restart streams when an endpoint changes, not when a CRD's status changes.
  const definitionsKey = JSON.stringify(
    crds === null
      ? null
      : Array.from(new Map(crds.map(crd => [crd.metadata.name, crd])).values())
          .map(crd => {
            const spec = crd.jsonData.spec;
            return {
              name: crd.metadata.name,
              spec: {
                group: spec.group,
                scope: spec.scope,
                names: {
                  plural: spec.names.plural,
                  singular: spec.names.singular,
                  kind: spec.names.kind,
                },
                versions: spec.versions
                  .filter((v: any) => v.served)
                  .map((v: any) => ({ name: v.name, served: true, storage: !!v.storage }))
                  .sort((a: any, b: any) => Number(b.storage) - Number(a.storage)),
              },
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name))
  );
  const definitions: ResourceDefinition[] | null = useMemo(
    () => JSON.parse(definitionsKey),
    [definitionsKey]
  );
  const key = JSON.stringify([definitionsKey, cluster, name, namespace]);
  const [state, setState] = useState<ResourceLists>({
    key: '',
    lists: new Map(),
    errors: new Map(),
    loading: true,
  });

  useEffect(() => {
    let cancelled = false;
    const cleanups: (() => void)[] = [];
    const pending = new Set(definitions?.map(d => d.name));
    setState({
      key,
      lists: new Map(),
      errors: new Map(),
      loading: definitions === null || pending.size > 0,
    });

    for (const definition of definitions ?? []) {
      const update = (items?: any[], error?: any) => {
        if (cancelled) return;
        pending.delete(definition.name);
        setState(previous => {
          const lists = new Map(previous.lists);
          const errors = new Map(previous.errors);
          if (items) lists.set(definition.name, items);
          if (error) errors.set(definition.name, error);
          else errors.delete(definition.name);
          return { key, lists, errors, loading: pending.size > 0 };
        });
      };

      async function connect() {
        if (definition.spec.versions.length === 0) {
          throw new Error(`No served version for ${definition.name}`);
        }
        const crd = new K8s.ResourceClasses.CustomResourceDefinition({
          metadata: { name: definition.name },
          spec: definition.spec,
        } as any);
        const Resource = crd.makeCRClass();
        const cleanup = await Resource.apiList(
          (items: any[]) => update(items.map(item => item.jsonData)),
          (error: any) => update(undefined, error),
          {
            cluster: cluster ?? undefined,
            namespace,
            queryParams: name ? { fieldSelector: `metadata.name=${name}` } : undefined,
          }
        )();
        // The component may unmount before the asynchronous connection resolves.
        if (cancelled) cleanup();
        else cleanups.push(cleanup);
      }
      connect().catch(error => update(undefined, error));
    }

    return () => {
      cancelled = true;
      cleanups.forEach(cleanup => cleanup());
    };
  }, [definitions, cluster, name, namespace, key]);

  // Never expose the previous cluster/resource's data during a route change.
  return state.key === key
    ? state
    : { key, lists: new Map<string, any[]>(), errors: new Map<string, any>(), loading: true };
}

export function useCustomResourceList(crd: any, options?: { name?: string; namespace?: string }) {
  const { lists, errors, loading } = useCustomResourceLists(crd ? [crd] : null, options);
  return {
    items: lists.get(crd?.metadata.name) ?? null,
    error: errors.get(crd?.metadata.name),
    loading,
  };
}
