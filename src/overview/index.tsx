import { useHistory } from 'react-router-dom';
import { Provider } from '../common/Resources';
import { clusterPrefix, useAllManagedResources } from '../helpers';

const { Typography, Box, Grid, Paper, CircularProgress, Alert, Chip } =
  (window as any).pluginLib?.MuiCore ?? {};

function ProviderTile({ provider }: { provider: any }) {
  const history = useHistory();
  const conditions: any[] = provider.jsonData?.status?.conditions ?? [];
  const readyCond = conditions.find((c: any) => c.type === 'Ready');
  const healthyCond = conditions.find((c: any) => c.type === 'Healthy');
  const installedCond = conditions.find((c: any) => c.type === 'Installed');
  const allOk = readyCond?.status === 'True' && healthyCond?.status === 'True' && installedCond?.status === 'True';
  const anyError = readyCond?.status === 'False' || healthyCond?.status === 'False' || installedCond?.status === 'False';
  const tileColor = allOk ? '#4caf50' : anyError ? '#f44336' : '#ff9800';

  return (
    <Paper
      elevation={2}
      style={{ padding: 16, cursor: 'pointer', borderLeft: `4px solid ${tileColor}` }}
      onClick={() => history.push(`${clusterPrefix()}/crossplane/providers/${provider.metadata.name}`)}
    >
      <Typography variant="h6" gutterBottom>{provider.metadata.name}</Typography>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        {provider.jsonData?.spec?.package ?? ''}
      </Typography>
      <Box display="flex" gap={1} flexWrap="wrap" mt={1}>
        {[
          { label: 'Ready', cond: readyCond },
          { label: 'Healthy', cond: healthyCond },
          { label: 'Installed', cond: installedCond },
        ].map(({ label, cond }) => {
          const ok = cond?.status === 'True';
          const bad = cond?.status === 'False';
          const color = ok ? '#4caf50' : bad ? '#f44336' : '#9e9e9e';
          return (
            <span key={label} style={{ padding: '2px 8px', borderRadius: 10, background: color, color: '#fff', fontSize: 11, fontWeight: 600 }}>
              {label}
            </span>
          );
        })}
      </Box>
    </Paper>
  );
}

function conditionChip(conditions: any[], type: string) {
  const cond = conditions?.find((c: any) => c.type === type);
  if (!cond) return <Chip label="—" size="small" />;
  const ok = cond.status === 'True';
  return (
    <Chip label={ok ? type : `Not ${type}`} size="small"
      style={{ background: ok ? '#4caf50' : '#f44336', color: '#fff', fontWeight: 600 }} />
  );
}

function AlertsSection() {
  const history = useHistory();
  const { items, loading } = useAllManagedResources();

  if (loading) {
    return (
      <Box display="flex" alignItems="center" gap={1} mb={3}>
        <CircularProgress size={16} />
        <Typography variant="body2" color="textSecondary">Loading resource health…</Typography>
      </Box>
    );
  }

  const total = items.length;
  const notReady = items.filter((item: any) =>
    item.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'False'
  );
  const ready = items.filter((item: any) =>
    item.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True'
  ).length;

  return (
    <Box mb={4}>
      {/* Stats row */}
      <Box display="flex" gap={2} mb={3} flexWrap="wrap">
        <Paper elevation={1} style={{ padding: '12px 24px', minWidth: 140, textAlign: 'center' }}>
          <Typography variant="h3" style={{ color: '#1976d2' }}>{total}</Typography>
          <Typography variant="body2" color="textSecondary">Managed Resources</Typography>
        </Paper>
        <Paper elevation={1} style={{ padding: '12px 24px', minWidth: 140, textAlign: 'center' }}>
          <Typography variant="h3" style={{ color: '#4caf50' }}>{ready}</Typography>
          <Typography variant="body2" color="textSecondary">Ready</Typography>
        </Paper>
        <Paper elevation={1} style={{ padding: '12px 24px', minWidth: 140, textAlign: 'center' }}>
          <Typography variant="h3" style={{ color: notReady.length > 0 ? '#f44336' : '#4caf50' }}>
            {notReady.length}
          </Typography>
          <Typography variant="body2" color="textSecondary">Not Ready</Typography>
        </Paper>
      </Box>

      {/* Inline alerts table — only when there are failures */}
      {notReady.length > 0 && (
        <Paper elevation={1} style={{ marginBottom: 8 }}>
          <Box px={2} py={1.5} borderBottom="1px solid #e0e0e0" display="flex" alignItems="center" gap={1}>
            <Typography variant="h6">Unhealthy Resources</Typography>
            <Chip label={notReady.length} size="small" style={{ background: '#f44336', color: '#fff', fontWeight: 600 }} />
          </Box>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left', background: '#fafafa' }}>
                {['Kind', 'Name', 'Provider', 'Ready', 'Synced', 'Reason', 'Message'].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', fontWeight: 600, fontSize: 13 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {notReady.map((item: any) => {
                const itemName: string = item.metadata?.name ?? '';
                const ns: string = item.metadata?.namespace ?? '';
                const conditions: any[] = item.status?.conditions ?? [];
                const failCond = conditions.find((c: any) => c.status === 'False');
                const detailUrl = ns
                  ? `${clusterPrefix()}/crossplane/providers/${item._providerName}/resources/${item._group}/${item._plural}/${ns}/${itemName}`
                  : `${clusterPrefix()}/crossplane/providers/${item._providerName}/resources/${item._group}/${item._plural}/${itemName}`;
                return (
                  <tr key={`${item._providerName}/${item._group}/${item._plural}/${ns}/${itemName}`}
                    style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                    onClick={() => history.push(detailUrl)}>
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{item._kind}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ color: '#1976d2', textDecoration: 'underline' }}>{itemName}</span>
                      {ns && <Typography variant="caption" display="block" color="textSecondary">{ns}</Typography>}
                    </td>
                    <td style={{ padding: '8px 12px', fontSize: 13, color: '#555' }}>{item._providerName}</td>
                    <td style={{ padding: '8px 12px' }}>{conditionChip(conditions, 'Ready')}</td>
                    <td style={{ padding: '8px 12px' }}>{conditionChip(conditions, 'Synced')}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12 }}>{failCond?.reason ?? '—'}</td>
                    <td style={{ padding: '8px 12px', fontSize: 12, color: '#555', maxWidth: 280 }}>{failCond?.message ?? ''}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </Paper>
      )}
      {notReady.length === 0 && total > 0 && (
        <Alert severity="success">All managed resources are healthy.</Alert>
      )}
    </Box>
  );
}

export default function CrossplaneOverview() {
  const [providers, error] = Provider.useList();

  if (error) {
    return (
      <Box p={3}>
        <Alert severity="warning">
          Crossplane is not installed on this cluster or the Providers CRD is not available.
        </Alert>
      </Box>
    );
  }

  if (!providers) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading Crossplane providers…</Typography>
      </Box>
    );
  }

  if (providers.length === 0) {
    return (
      <Box p={3}>
        <Alert severity="info">No Crossplane Providers are installed on this cluster.</Alert>
      </Box>
    );
  }

  const totalProviders = providers.length;
  const readyProviders = providers.filter(
    (p: any) => p.jsonData?.status?.conditions?.find((c: any) => c.type === 'Healthy')?.status === 'True'
  ).length;

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>Crossplane Overview</Typography>

      <Typography variant="subtitle2" color="textSecondary" gutterBottom>Providers</Typography>
      <Box display="flex" gap={2} mb={3} flexWrap="wrap">
        <Paper elevation={1} style={{ padding: '12px 24px', minWidth: 140, textAlign: 'center' }}>
          <Typography variant="h3" style={{ color: '#1976d2' }}>{totalProviders}</Typography>
          <Typography variant="body2" color="textSecondary">Installed</Typography>
        </Paper>
        <Paper elevation={1} style={{ padding: '12px 24px', minWidth: 140, textAlign: 'center' }}>
          <Typography variant="h3" style={{ color: readyProviders === totalProviders ? '#4caf50' : '#ff9800' }}>
            {readyProviders}/{totalProviders}
          </Typography>
          <Typography variant="body2" color="textSecondary">Healthy</Typography>
        </Paper>
      </Box>

      <Typography variant="subtitle2" color="textSecondary" gutterBottom>Managed Resources</Typography>
      <AlertsSection />

      <Typography variant="h6" gutterBottom>Installed Providers</Typography>
      <Grid container spacing={2}>
        {providers.map((provider: any) => (
          <Grid item xs={12} sm={6} md={4} key={provider.metadata.name}>
            <ProviderTile provider={provider} />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
