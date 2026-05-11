import { useHistory } from 'react-router-dom';
import { Provider } from '../common/Resources';
import { clusterPrefix } from '../helpers';

const { Typography, Box, Chip, CircularProgress } =
  (window as any).pluginLib?.MuiCore ?? {};

function conditionChip(conditions: any[], type: string) {
  const cond = conditions?.find((c: any) => c.type === type);
  if (!cond) return <Chip label="Unknown" size="small" />;
  const ok = cond.status === 'True';
  return (
    <Chip
      label={ok ? type : `Not ${type}`}
      size="small"
      style={{
        background: ok ? '#4caf50' : '#f44336',
        color: '#fff',
        fontWeight: 600,
      }}
    />
  );
}

export default function ProviderList() {
  const history = useHistory();
  const [providers, error] = Provider.useList();

  if (!providers && !error) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading providers…</Typography>
      </Box>
    );
  }

  if (error) {
    return (
      <Box p={3}>
        <Typography color="error">
          Failed to load providers: {String(error)}
        </Typography>
      </Box>
    );
  }

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        Crossplane Providers
      </Typography>

      {providers.length === 0 ? (
        <Typography>No providers installed.</Typography>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left' }}>
              {['Name', 'Package', 'Version', 'Installed', 'Healthy', 'Ready', 'Age'].map((h) => (
                <th key={h} style={{ padding: '8px 12px', fontWeight: 600 }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {providers.map((p: any) => {
              const conditions: any[] = p.jsonData?.status?.conditions ?? [];
              const version =
                p.jsonData?.status?.atPkg ??
                p.jsonData?.status?.currentRevision ??
                '—';
              const created = p.metadata?.creationTimestamp
                ? new Date(p.metadata.creationTimestamp).toLocaleDateString()
                : '—';

              return (
                <tr
                  key={p.metadata.name}
                  style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                  onClick={() =>
                    history.push(`${clusterPrefix()}/crossplane/providers/${p.metadata.name}`)
                  }
                >
                  <td style={{ padding: '8px 12px' }}>
                    <span
                      style={{ color: '#1976d2', textDecoration: 'underline', cursor: 'pointer' }}
                    >
                      {p.metadata.name}
                    </span>
                  </td>
                  <td
                    style={{
                      padding: '8px 12px',
                      fontFamily: 'monospace',
                      fontSize: 12,
                      maxWidth: 320,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {p.jsonData?.spec?.package ?? '—'}
                  </td>
                  <td style={{ padding: '8px 12px' }}>{version}</td>
                  <td style={{ padding: '8px 12px' }}>
                    {conditionChip(conditions, 'Installed')}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {conditionChip(conditions, 'Healthy')}
                  </td>
                  <td style={{ padding: '8px 12px' }}>
                    {conditionChip(conditions, 'Ready')}
                  </td>
                  <td style={{ padding: '8px 12px' }}>{created}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </Box>
  );
}
