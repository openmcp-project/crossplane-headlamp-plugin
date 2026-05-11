import { useHistory } from 'react-router-dom';
import { Provider } from '../common/Resources';
import { clusterPrefix } from '../helpers';

const { Typography, Box, Grid, Paper, CircularProgress, Alert } =
  (window as any).pluginLib?.MuiCore ?? {};

function ProviderTile({ provider }: { provider: any }) {
  const history = useHistory();
  const conditions: any[] = provider.jsonData?.status?.conditions ?? [];
  const readyCond = conditions.find((c: any) => c.type === 'Ready');
  const healthyCond = conditions.find((c: any) => c.type === 'Healthy');
  const installedCond = conditions.find((c: any) => c.type === 'Installed');

  const readyOk = readyCond?.status === 'True';
  const healthyOk = healthyCond?.status === 'True';
  const installedOk = installedCond?.status === 'True';

  const allOk = readyOk && healthyOk && installedOk;
  const anyError =
    readyCond?.status === 'False' ||
    healthyCond?.status === 'False' ||
    installedCond?.status === 'False';

  const tileColor = allOk ? '#4caf50' : anyError ? '#f44336' : '#ff9800';

  return (
    <Paper
      elevation={2}
      style={{ padding: 16, cursor: 'pointer', borderLeft: `4px solid ${tileColor}` }}
      onClick={() => history.push(`${clusterPrefix()}/crossplane/providers/${provider.metadata.name}`)}
    >
      <Typography variant="h6" gutterBottom>
        {provider.metadata.name}
      </Typography>
      <Typography variant="body2" color="textSecondary" gutterBottom>
        {provider.spec?.package ?? ''}
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
            <span
              key={label}
              style={{
                padding: '2px 8px',
                borderRadius: 10,
                background: color,
                color: '#fff',
                fontSize: 11,
                fontWeight: 600,
              }}
            >
              {label}
            </span>
          );
        })}
      </Box>
    </Paper>
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
        <Alert severity="info">
          No Crossplane Providers are installed on this cluster.
        </Alert>
      </Box>
    );
  }

  const totalProviders = providers.length;
  const readyProviders = providers.filter(
    (p: any) =>
      p.jsonData?.status?.conditions?.find((c: any) => c.type === 'Healthy')?.status === 'True'
  ).length;

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        Crossplane Overview
      </Typography>

      {/* Summary stats */}
      <Box display="flex" gap={2} mb={3} flexWrap="wrap">
        <Paper elevation={1} style={{ padding: '12px 24px', minWidth: 140, textAlign: 'center' }}>
          <Typography variant="h3" style={{ color: '#1976d2' }}>
            {totalProviders}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Providers
          </Typography>
        </Paper>
        <Paper elevation={1} style={{ padding: '12px 24px', minWidth: 140, textAlign: 'center' }}>
          <Typography
            variant="h3"
            style={{ color: readyProviders === totalProviders ? '#4caf50' : '#ff9800' }}
          >
            {readyProviders}/{totalProviders}
          </Typography>
          <Typography variant="body2" color="textSecondary">
            Ready
          </Typography>
        </Paper>
      </Box>

      {/* Provider tiles */}
      <Typography variant="h6" gutterBottom>
        Installed Providers
      </Typography>
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
