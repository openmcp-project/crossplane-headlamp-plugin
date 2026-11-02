import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useMemo, useState } from 'react';
import { ResourceDefinitionSpec, listCRDResources } from './apiProxy';

interface ResourceDefinition {
  name: string;
  spec: ResourceDefinitionSpec;
}

interface ResourceLists {
  key: string;
  lists: Map<string, any[]>;
  errors: Map<string, any>;
  loading: boolean;
}

const POLL_INTERVAL_MS = 10000;

/** List dynamic CRD types using polling (plain HTTP GET every POLL_INTERVAL_MS).
 *
 * We avoid streaming/watch because many cluster proxies close WebSocket
 * connections immediately, causing Headlamp's stream() to reconnect in a tight
 * loop. Polling is simpler and reliable across all environments.
 */
export function useCustomResourceLists(
  crds: any[] | null,
  { name, namespace }: { name?: string; namespace?: string } = {}
) {
  const cluster = K8s.useCluster();
  // CRD watch events and callers can create new arrays on every render. Only
  // restart polling when an endpoint changes, not when a CRD's status changes.
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
    const timers: ReturnType<typeof setInterval>[] = [];
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
        const remaining = pending.size;
        setState(previous => {
          // Discard responses that arrived after a key change (e.g. cluster switch).
          if (previous.key !== key) return previous;
          const lists = new Map(previous.lists);
          const errors = new Map(previous.errors);
          if (items !== undefined) lists.set(definition.name, items);
          if (error) errors.set(definition.name, error);
          else errors.delete(definition.name);
          return { key, lists, errors, loading: remaining > 0 };
        });
      };

      const poll = async () => {
        if (cancelled) return;
        try {
          if (definition.spec.versions.length === 0) {
            throw new Error(`No served version for ${definition.name}`);
          }
          const items = await listCRDResources(
            definition.spec,
            definition.name,
            cluster ?? '',
            namespace,
            name
          );
          update(items);
        } catch (error) {
          update(undefined, error);
        }
      };

      poll();
      timers.push(setInterval(poll, POLL_INTERVAL_MS));
    }

    return () => {
      cancelled = true;
      timers.forEach(t => clearInterval(t));
    };
  }, [definitions, cluster, name, namespace, key]);

  // Never expose the previous cluster/resource's data during a route change,
  // and report loading immediately when key changes (before the effect runs).
  if (state.key !== key) {
    return { key, lists: new Map<string, any[]>(), errors: new Map<string, any>(), loading: true };
  }
  return state;
}

export function useCustomResourceList(crd: any, options?: { name?: string; namespace?: string }) {
  const { lists, errors, loading } = useCustomResourceLists(crd ? [crd] : null, options);
  return {
    items: lists.get(crd?.metadata.name) ?? null,
    error: errors.get(crd?.metadata.name),
    loading,
  };
}
