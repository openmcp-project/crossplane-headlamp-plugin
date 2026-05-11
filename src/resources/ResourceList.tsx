import { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Provider } from '../common/Resources';
import { useCRDsForProvider, getApiProxy, clusterPrefix } from '../helpers';

const { Typography, Box, Chip, CircularProgress, Paper } =
  (window as any).pluginLib?.MuiCore ?? {};

function useInstanceCount(group: string, version: string, plural: string) {
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    if (!group || !plural || !version) return;
    getApiProxy()
      .request(`/apis/${group}/${version}/${plural}`, { isJSON: true })
      .then((res: any) => setCount(res?.items?.length ?? 0))
      .catch(() => setCount(0));
  }, [group, version, plural]);
  return count;
}

function CRDRow({ crd, providerName }: { crd: any; providerName: string }) {
  const history = useHistory();
  const group: string = crd.jsonData?.spec?.group ?? '';
  const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
  const kind: string = crd.jsonData?.spec?.names?.kind ?? '';
  const scope: string = crd.jsonData?.spec?.scope ?? '';
  const topVersion: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
  const count = useInstanceCount(group, topVersion, plural);

  return (
    <tr
      style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
      onClick={() =>
        history.push(
          `${clusterPrefix()}/crossplane/providers/${providerName}/resources/${group}/${plural}`
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
        {count === null ? <CircularProgress size={12} /> : count}
      </td>
    </tr>
  );
}

function ProviderSection({ provider }: { provider: any }) {
  const currentRevision: string = provider.jsonData?.status?.currentRevision ?? '';
  const [crds, crdErr] = useCRDsForProvider(provider.metadata.name, currentRevision);

  return (
    <Paper elevation={1} style={{ marginBottom: 24 }}>
      <Box px={2} py={1.5} borderBottom="1px solid #e0e0e0" display="flex" alignItems="center" gap={1}>
        <Typography variant="h6">{provider.metadata.name}</Typography>
        {crds !== null && (
          <Chip label={`${crds.length} types`} size="small" />
        )}
      </Box>
      {crds === null && !crdErr ? (
        <Box px={2} py={2} display="flex" alignItems="center" gap={1}>
          <CircularProgress size={16} />
          <Typography variant="body2">Loading CRDs…</Typography>
        </Box>
      ) : crdErr ? (
        <Box px={2} py={1.5}>
          <Typography variant="body2" color="error">Error loading CRDs</Typography>
        </Box>
      ) : crds!.length === 0 ? (
        <Box px={2} py={1.5}>
          <Typography variant="body2" color="textSecondary">No CRDs found for this provider.</Typography>
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
            {crds!.map((crd: any) => (
              <CRDRow key={crd.metadata.name} crd={crd} providerName={provider.metadata.name} />
            ))}
          </tbody>
        </table>
      )}
    </Paper>
  );
}

export default function ResourceList() {
  const [providers, providerErr] = Provider.useList();

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
      <Typography variant="h4" gutterBottom>
        Managed Resources
      </Typography>
      <Typography variant="body2" color="textSecondary" gutterBottom style={{ marginBottom: 16 }}>
        Resource types owned by each provider. Click a row to browse instances.
      </Typography>
      {(providers ?? []).map((p: any) => (
        <ProviderSection key={p.metadata.name} provider={p} />
      ))}
    </Box>
  );
}
