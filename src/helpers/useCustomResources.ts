import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useMemo, useRef, useState } from 'react';

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

const POLL_INTERVAL_MS = 10000;

function getApiRoot(group: string, version: string): string {
  return group ? `/apis/${group}/${version}` : `/api/${version}`;
}

/** Do a plain LIST request (no watch) using Headlamp's clusterRequest. */
async function listResources(
  definition: ResourceDefinition,
  cluster: string,
  namespace?: string,
  name?: string
): Promise<any[]> {
  const apiProxy = (K8s as any).ApiProxy ?? (window as any).pluginLib?.ApiProxy;
  const version =
    definition.spec.versions.find(v => v.storage) ?? definition.spec.versions[0];
  const scopedPath =
    definition.spec.scope === 'Namespaced' && namespace
      ? `namespaces/${namespace}/${definition.spec.names.plural}`
      : definition.spec.names.plural;
  const base = `${getApiRoot(definition.spec.group, version.name)}/${scopedPath}`;
  const qs = name ? `?fieldSelector=metadata.name%3D${encodeURIComponent(name)}` : '';
  const url = `${base}${qs}`;

  const response = await apiProxy.clusterRequest(url, { cluster });
  const items: any[] = response?.items ?? [];
  const fixedKind = (response?.kind ?? '').replace(/List$/, '') || definition.spec.names.kind;
  return items.map((item: any) => {
    if (!item.kind) item.kind = fixedKind;
    if (!item.apiVersion) item.apiVersion = `${definition.spec.group}/${version.name}`;
    return item;
  });
}

/** List dynamic CRD types using polling (plain HTTP GET every POLL_INTERVAL_MS).
 *
 * We avoid streaming/watch because many cluster proxies close WebSocket
 * connections immediately and Headlamp's stream() then reconnects in a tight
 * loop. Polling is simpler and reliable across all environments.
 */
export function useCustomResourceLists(
  crds: any[] | null,
  { name, namespace }: { name?: string; namespace?: string } = {}
) {
  const cluster = K8s.useCluster();
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

  const pollTimers = useRef<Map<string, ReturnType<typeof setInterval>>>(new Map());

  useEffect(() => {
    let cancelled = false;

    pollTimers.current.forEach(t => clearInterval(t));
    pollTimers.current.clear();

    setState({
      key,
      lists: new Map(),
      errors: new Map(),
      loading: definitions === null || (definitions?.length ?? 0) > 0,
    });

    for (const definition of definitions ?? []) {
      const pending = { done: false };

      const poll = async () => {
        if (cancelled) return;
        try {
          const items = await listResources(definition, cluster ?? '', namespace, name);
          if (cancelled) return;
          const wasPending = !pending.done;
          pending.done = true;
          setState(previous => {
            const lists = new Map(previous.lists);
            const errors = new Map(previous.errors);
            lists.set(definition.name, items);
            errors.delete(definition.name);
            // Still loading only if some other definitions haven't resolved yet.
            const stillLoading = wasPending
              ? Array.from(previous.lists.keys()).length + 1 < (definitions?.length ?? 0)
              : previous.loading;
            return { key, lists, errors, loading: stillLoading };
          });
        } catch (error) {
          if (cancelled) return;
          const wasPending = !pending.done;
          pending.done = true;
          setState(previous => {
            const lists = new Map(previous.lists);
            const errors = new Map(previous.errors);
            errors.set(definition.name, error);
            const stillLoading = wasPending
              ? Array.from(previous.lists.keys()).length < (definitions?.length ?? 0)
              : previous.loading;
            return { key, lists, errors, loading: stillLoading };
          });
        }
      };

      poll();
      const timer = setInterval(poll, POLL_INTERVAL_MS);
      pollTimers.current.set(definition.name, timer);
    }

    return () => {
      cancelled = true;
      pollTimers.current.forEach(t => clearInterval(t));
      pollTimers.current.clear();
    };
  }, [definitions, cluster, name, namespace, key]);

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
