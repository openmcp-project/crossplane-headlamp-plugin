import { useParams, useHistory } from 'react-router-dom';
import { Provider } from '../common/Resources';
import { useCRDsForProvider, clusterPrefix } from '../helpers';

const { Typography, Box, Chip, CircularProgress, Button, Paper } =
  (window as any).pluginLib?.MuiCore ?? {};

function ConditionRow({ cond }: { cond: any }) {
  const ok = cond.status === 'True';
  return (
    <tr style={{ borderBottom: '1px solid #f5f5f5' }}>
      <td style={{ padding: '6px 12px', fontWeight: 600 }}>{cond.type}</td>
      <td style={{ padding: '6px 12px' }}>
        <Chip
          label={cond.status}
          size="small"
          style={{ background: ok ? '#4caf50' : '#f44336', color: '#fff', fontWeight: 600 }}
        />
      </td>
      <td style={{ padding: '6px 12px', fontSize: 12, color: '#666' }}>{cond.reason ?? ''}</td>
      <td style={{ padding: '6px 12px', fontSize: 12, color: '#666' }}>{cond.message ?? ''}</td>
    </tr>
  );
}

function ProviderConfigs({ currentRevision }: { currentRevision: string }) {
  const [crds] = useCRDsForProvider('', currentRevision);
  const configCrd = crds?.find(
    (crd: any) => crd.jsonData?.spec?.names?.plural === 'providerconfigs'
  );

  if (!configCrd) {
    return (
      <Typography variant="body2" color="textSecondary">
        No ProviderConfig CRD found for this provider.
      </Typography>
    );
  }

  return (
    <Typography variant="body2" color="textSecondary">
      ProviderConfig CRD found: {configCrd.metadata?.name}
      {' '}(navigate to the cluster CRD view to manage configs)
    </Typography>
  );
}

function ManagedResourceSection({
  providerName,
  currentRevision,
}: {
  providerName: string;
  currentRevision: string;
}) {
  const history = useHistory();
  const [crds, error] = useCRDsForProvider(providerName, currentRevision);

  if (!currentRevision) return null;
  if (!crds && !error) return <CircularProgress size={16} />;
  if (error) return <Typography color="error">Error loading CRDs</Typography>;
  if (!crds || crds.length === 0) {
    return (
      <Typography variant="body2" color="textSecondary">
        No managed resource CRDs found.
      </Typography>
    );
  }

  return (
    <Box>
      {crds.map((crd: any) => {
        const crdGroup = crd.jsonData?.spec?.group ?? '';
        const plural = crd.jsonData?.spec?.names?.plural ?? '';
        const kind = crd.jsonData?.spec?.names?.kind ?? '';
        const scope = crd.jsonData?.spec?.scope ?? '';
        return (
          <Box
            key={crd.metadata.name}
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            py={1}
            borderBottom="1px solid #f0f0f0"
          >
            <Box>
              <Typography variant="body1" fontWeight={600}>
                {kind}
              </Typography>
              <Typography variant="body2" color="textSecondary">
                {crd.metadata.name} · {scope}
              </Typography>
            </Box>
            <Button
              size="small"
              variant="outlined"
              onClick={() =>
                history.push(
                  `${clusterPrefix()}/crossplane/providers/${providerName}/resources/${crdGroup}/${plural}`
                )
              }
            >
              Browse
            </Button>
          </Box>
        );
      })}
    </Box>
  );
}

export default function ProviderDetail() {
  const { name } = useParams<{ name: string }>();
  const [providers, error] = Provider.useList();

  if (!providers && !error) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading…</Typography>
      </Box>
    );
  }

  const provider = providers?.find((p: any) => p.metadata.name === name);

  if (!provider) {
    return (
      <Box p={3}>
        <Typography color="error">Provider "{name}" not found.</Typography>
      </Box>
    );
  }

  const conditions: any[] = provider.jsonData?.status?.conditions ?? [];
  const packageRef: string = provider.jsonData?.spec?.package ?? '';
  const currentRevision: string = provider.jsonData?.status?.currentRevision ?? '';
  const controllerRef = provider.jsonData?.status?.controller?.configRef?.name ?? '';

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        Provider: {name}
      </Typography>

      {/* Basic Info */}
      <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
        <Typography variant="h6" gutterBottom>
          Provider Info
        </Typography>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <tbody>
            {[
              ['Package', packageRef],
              ['Current Revision', currentRevision],
              ['Controller', controllerRef],
              [
                'Created',
                provider.metadata?.creationTimestamp
                  ? new Date(provider.metadata.creationTimestamp).toLocaleString()
                  : '—',
              ],
            ].map(([label, value]) => (
              <tr key={label} style={{ borderBottom: '1px solid #f5f5f5' }}>
                <td style={{ padding: '6px 12px', fontWeight: 600, width: 180 }}>{label}</td>
                <td style={{ padding: '6px 12px', fontFamily: 'monospace', fontSize: 13 }}>
                  {value}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Paper>

      {/* Conditions */}
      <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
        <Typography variant="h6" gutterBottom>
          Conditions
        </Typography>
        {conditions.length === 0 ? (
          <Typography variant="body2" color="textSecondary">
            No conditions reported.
          </Typography>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e0e0' }}>
                {['Type', 'Status', 'Reason', 'Message'].map((h) => (
                  <th key={h} style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {conditions.map((c: any) => (
                <ConditionRow key={c.type} cond={c} />
              ))}
            </tbody>
          </table>
        )}
      </Paper>

      {/* Provider Configs */}
      <Paper elevation={1} style={{ padding: 16, marginBottom: 24 }}>
        <Typography variant="h6" gutterBottom>
          Provider Configs
        </Typography>
        <ProviderConfigs currentRevision={currentRevision} />
      </Paper>

      {/* Managed Resources */}
      <Paper elevation={1} style={{ padding: 16 }}>
        <Typography variant="h6" gutterBottom>
          Managed Resource Types
        </Typography>
        <ManagedResourceSection providerName={name} currentRevision={currentRevision} />
      </Paper>
    </Box>
  );
}
