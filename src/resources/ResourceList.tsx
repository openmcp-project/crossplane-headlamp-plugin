import { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Provider } from '../common/Resources';
import { useCRDsForProvider, getApiProxy, clusterPrefix } from '../helpers';

const { Typography, Box, Chip, CircularProgress, Paper, FormControlLabel, Checkbox } =
  (window as any).pluginLib?.MuiCore ?? {};

// Fetches instance counts for all CRDs in a provider in parallel.
// Returns a map of crd.metadata.name → count, or null while loading.
function useCRDInstanceCounts(crds: any[] | null): Map<string, number> | null {
  const [counts, setCounts] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    if (!crds) { setCounts(null); return; }
    if (crds.length === 0) { setCounts(new Map()); return; }

    let cancelled = false;
    const result = new Map<string, number>();
    const fetches = crds.map((crd: any) => {
      const group: string = crd.jsonData?.spec?.group ?? '';
      const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
      const topVersion: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
      if (!group || !plural || !topVersion) {
        result.set(crd.metadata.name, 0);
        return Promise.resolve();
      }
      return getApiProxy()
        .request(`/apis/${group}/${topVersion}/${plural}`, { isJSON: true })
        .then((res: any) => { result.set(crd.metadata.name, res?.items?.length ?? 0); })
        .catch(() => { result.set(crd.metadata.name, 0); });
    });

    Promise.all(fetches).then(() => {
      if (!cancelled) setCounts(new Map(result));
    });

    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crds?.map((c: any) => c.metadata.name).join(',')]);

  return counts;
}

function ProviderSection({ provider, hideUnused }: { provider: any; hideUnused: boolean }) {
  const history = useHistory();
  const currentRevision: string = provider.jsonData?.status?.currentRevision ?? '';
  const [crds, crdErr] = useCRDsForProvider(provider.metadata.name, currentRevision);
  const counts = useCRDInstanceCounts(crds ?? null);

  // When hideUnused is on, wait until all counts are loaded before rendering rows.
  const loading = crds === null && !crdErr;
  const countsLoading = hideUnused && crds !== null && counts === null;

  const visibleCrds = (() => {
    if (!crds) return [];
    if (!hideUnused || counts === null) return crds;
    return crds.filter((crd: any) => (counts.get(crd.metadata.name) ?? 0) > 0);
  })();

  return (
    <Paper elevation={1} style={{ marginBottom: 24 }}>
      <Box px={2} py={1.5} borderBottom="1px solid #e0e0e0" display="flex" alignItems="center" gap={1}>
        <Typography variant="h6">{provider.metadata.name}</Typography>
        {crds !== null && counts !== null && (
          <Chip label={`${visibleCrds.length} types`} size="small" />
        )}
      </Box>
      {loading || countsLoading ? (
        <Box px={2} py={2} display="flex" alignItems="center" gap={1}>
          <CircularProgress size={16} />
          <Typography variant="body2">Loading…</Typography>
        </Box>
      ) : crdErr ? (
        <Box px={2} py={1.5}>
          <Typography variant="body2" color="error">Error loading CRDs</Typography>
        </Box>
      ) : visibleCrds.length === 0 ? (
        <Box px={2} py={1.5}>
          <Typography variant="body2" color="textSecondary">
            {hideUnused ? 'No resource types with instances.' : 'No CRDs found for this provider.'}
          </Typography>
        </Box>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left', background: '#fafafa' }}>
              {['Kind', 'Group', 'Version', 'Scope', 'Instances'].map((h) => (
                <th key={h} style={{ padding: '8px 12px', fontWeight: 600, fontSize: 13 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visibleCrds.map((crd: any) => {
              const group: string = crd.jsonData?.spec?.group ?? '';
              const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
              const kind: string = crd.jsonData?.spec?.names?.kind ?? '';
              const scope: string = crd.jsonData?.spec?.scope ?? '';
              const topVersion: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
              const count = counts?.get(crd.metadata.name) ?? 0;
              return (
                <tr
                  key={crd.metadata.name}
                  style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                  onClick={() =>
                    history.push(
                      `${clusterPrefix()}/crossplane/providers/${provider.metadata.name}/resources/${group}/${plural}`
                    )
                  }
                >
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ color: '#1976d2', textDecoration: 'underline' }}>{kind}</span>
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>{group}</td>
                  <td style={{ padding: '8px 12px', fontSize: 12 }}>{topVersion}</td>
                  <td style={{ padding: '8px 12px' }}>
                    <Chip
                      label={scope}
                      size="small"
                      style={{
                        background: scope === 'Cluster' ? '#1976d2' : '#7b1fa2',
                        color: '#fff',
                        fontWeight: 600,
                      }}
                    />
                  </td>
                  <td style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' as const }}>
                    {count}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Paper>
  );
}

export default function ResourceList() {
  const [providers, providerErr] = Provider.useList();
  const [hideUnused, setHideUnused] = useState(true);

  if (!providers && !providerErr) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading providers…</Typography>
      </Box>
    );
  }

  if (providerErr) {
    return (
      <Box p={3}>
        <Typography color="error">Failed to load providers: {String(providerErr)}</Typography>
      </Box>
    );
  }

  return (
    <Box p={3}>
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2}>
        <Box>
          <Typography variant="h4">Managed Resources</Typography>
          <Typography variant="body2" color="textSecondary">
            Resource types owned by each provider. Click a row to browse instances.
          </Typography>
        </Box>
        <FormControlLabel
          control={
            <Checkbox
              checked={hideUnused}
              onChange={(e: any) => setHideUnused(e.target.checked)}
              size="small"
            />
          }
          label="Hide unused"
        />
      </Box>
      {(providers ?? []).map((p: any) => (
        <ProviderSection key={p.metadata.name} provider={p} hideUnused={hideUnused} />
      ))}
    </Box>
  );
}
