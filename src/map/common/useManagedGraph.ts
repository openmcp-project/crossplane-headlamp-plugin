import { K8s } from '@kinvolk/headlamp-plugin/lib';
import { useEffect, useMemo, useState } from 'react';
import { ProviderRevision } from '../../common/Resources';
import { NON_MANAGED_PLURALS } from '../../helpers';
import { Provider } from '../../providers/provider';
import { buildManagedGraph } from './buildManagedGraph';
import { ManagedGraphData, ManagedInstance, ManagedResourceError } from './types';

/** Discovers managed-resource CRDs through ProviderRevision ownership references. */
function useManagedCRDs(cluster: string | null) {
  const [allCrds, crdError] = K8s.ResourceClasses.CustomResourceDefinition.useList({ cluster });
  const [revisions, revisionError] = ProviderRevision.useList({ cluster });
  const [providers, providerError] = Provider.useList({ cluster });

  const crds = useMemo(() => {
    if (!allCrds || !revisions) return null;
    const allManagedCrdNames = new Set<string>();
    for (const rev of revisions) {
      const refs: any[] = rev.jsonData?.status?.objectRefs ?? [];
      // Crossplane may reference a ManagedResourceDefinition with the same CRD name.
      refs.forEach(ref => allManagedCrdNames.add(ref.name));
    }
    return (allCrds as any[]).filter((crd: any) => {
      const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
      return allManagedCrdNames.has(crd.metadata?.name) && !NON_MANAGED_PLURALS.has(plural);
    });
  }, [allCrds, revisions]);

  const providerByCRD = useMemo(() => {
    const ownership = new Map<string, string>();
    for (const provider of providers ?? []) {
      const providerName = provider.metadata?.name;
      if (!providerName) continue;
      const revision = revisions?.find(
        (rev: any) => rev.metadata?.name === provider.jsonData?.status?.currentRevision
      );
      const refs: any[] = revision?.jsonData?.status?.objectRefs ?? [];
      for (const ref of refs) {
        ownership.set(ref.name, providerName);
      }
    }
    return ownership;
  }, [providers, revisions]);

  return {
    crds,
    providerByCRD,
    providersPending: !providers && !providerError,
    error: crdError ?? revisionError,
  };
}

type ManagedInstancesData = {
  key: string;
  instances: ManagedInstance[];
  resourceErrors: ManagedResourceError[];
};

/** Uses apiList to preserve watch reconnection on Headlamp 0.46.0. */
function useManagedInstancesData(
  crds: any[] | null,
  cluster: string | null
): ManagedInstancesData | null {
  const [result, setResult] = useState<ManagedInstancesData | null>(null);
  const allowedNamespaces = [...new Set(K8s.cluster.getAllowedNamespaces(cluster))].sort();
  const crdKey = crds
    ? JSON.stringify(
        crds
          .map(crd => {
            const spec = crd.jsonData.spec;
            return {
              name: crd.metadata.name,
              uid: crd.metadata.uid,
              group: spec.group,
              names: spec.names,
              scope: spec.scope,
              versions: spec.versions.map(({ name, served, storage }: any) => ({
                name,
                served,
                storage,
              })),
            };
          })
          .sort((a, b) => a.name.localeCompare(b.name))
      )
    : null;
  const requestKey =
    cluster && crdKey !== null ? JSON.stringify([cluster, crdKey, allowedNamespaces]) : null;

  useEffect(() => {
    setResult(null);
    if (!crds || !cluster || !requestKey) return;
    if (crds.length === 0) {
      setResult({ key: requestKey, instances: [], resourceErrors: [] });
      return;
    }

    const requests = crds.flatMap(crd => {
      const namespaces =
        crd.jsonData.spec.scope === 'Namespaced' && allowedNamespaces.length > 0
          ? allowedNamespaces
          : [undefined];
      return namespaces.map(namespace => ({
        crd,
        namespace,
        key: JSON.stringify([crd.metadata.name, namespace]),
      }));
    });
    let cancelled = false;
    const pending = new Set(requests.map(request => request.key));
    const collections = new Map<string, ManagedInstance[]>();
    const errors = new Map<string, Error>();
    const cancelSubscriptions: (() => void)[] = [];

    function publish() {
      if (cancelled || pending.size > 0) return;
      setResult({
        key: requestKey!,
        instances: requests.flatMap(({ key }) => collections.get(key) ?? []),
        resourceErrors: requests.flatMap(({ key, crd, namespace }) => {
          const error = errors.get(key);
          return error ? [{ crdName: crd.metadata.name, namespace, error }] : [];
        }),
      });
    }

    for (const { crd, namespace, key } of requests) {
      const onError = (error: unknown) => {
        if (cancelled) return;
        errors.set(key, error instanceof Error ? error : new Error(String(error)));
        pending.delete(key);
        publish();
      };
      try {
        const CRClass = crd.makeCRClass();
        CRClass.apiList(
          (instances: ManagedInstance[]) => {
            if (cancelled) return;
            // apiList mutates its backing objects; preserve snapshots for the native map's diff.
            collections.set(
              key,
              instances.map(instance => CRClass.create({ ...instance.jsonData }, cluster))
            );
            errors.delete(key);
            pending.delete(key);
            publish();
          },
          onError,
          { cluster, namespace }
        )().then((cancel: () => void) => {
          // The stop function can arrive after a cluster change or unmount.
          if (cancelled) cancel();
          else cancelSubscriptions.push(cancel);
        }, onError);
      } catch (error) {
        onError(error);
      }
    }

    return () => {
      cancelled = true;
      cancelSubscriptions.forEach(cancel => cancel());
    };
    // Metadata-only CRD updates must not restart the watches; endpoint fields are in requestKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey]);

  return result?.key === requestKey ? result : null;
}

export function useManagedGraph(): ManagedGraphData | null {
  const urlCluster = K8s.useCluster();
  const selectedClusters = K8s.useSelectedClusters?.() ?? [];
  const cluster = urlCluster ?? selectedClusters[0] ?? null;
  const { crds, providerByCRD, providersPending, error } = useManagedCRDs(cluster);
  const data = useManagedInstancesData(error ? null : crds, cluster);
  return useMemo(() => {
    if (!cluster) return { nodes: [], edges: [], error: undefined, resourceErrors: [] };
    if (error) return { nodes: [], edges: [], error, resourceErrors: [] };
    if (!data || !crds) return null;
    // Pinned Activities retain initial props; wait until provider discovery settles.
    if (data.instances.length > 0 && providersPending) return null;
    const graph = buildManagedGraph(data.instances, crds, providerByCRD);
    return {
      nodes: graph.nodes,
      edges: [...graph.parentEdges, ...graph.auxEdges.map(edge => ({ ...edge, aux: true }))],
      error: undefined,
      resourceErrors: data.resourceErrors,
    };
  }, [cluster, data, crds, providerByCRD, providersPending, error]);
}
