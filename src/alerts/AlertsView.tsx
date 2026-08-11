import { useAllManagedResources } from '../helpers';
import { xpColors } from '../common/colors';
import { openManagedDetail } from '../managed/ManagedDetail';

const { Typography, Box, Chip, CircularProgress, Alert } =
  (window as any).pluginLib?.MuiCore ?? {};

function conditionChip(conditions: any[], type: string) {
  const cond = conditions?.find((c: any) => c.type === type);
  if (!cond) return <Chip label="—" size="small" />;
  const ok = cond.status === 'True';
  return (
    <Chip
      label={ok ? type : `Not ${type}`}
      size="small"
      style={{ background: ok ? xpColors.ready.bg : xpColors.notReady.bg, color: '#fff', fontWeight: 600 }}
    />
  );
}

function failingSince(conditions: any[]): string {
  const failing = conditions
    .filter((c: any) => c.status === 'False' && c.lastTransitionTime)
    .sort(
      (a: any, b: any) =>
        new Date(a.lastTransitionTime).getTime() - new Date(b.lastTransitionTime).getTime()
    );
  if (!failing.length) return '—';
  return new Date(failing[0].lastTransitionTime).toLocaleString();
}

function firstFailReason(conditions: any[]): string {
  const cond = conditions.find((c: any) => c.status === 'False');
  return cond?.reason ?? '—';
}

function firstFailMessage(conditions: any[]): string {
  const cond = conditions.find((c: any) => c.status === 'False');
  return cond?.message ?? '';
}

export default function AlertsView() {
  const { items, loading } = useAllManagedResources();

  if (loading) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading managed resources…</Typography>
      </Box>
    );
  }

  const broken = items.filter((item: any) => {
    const conditions: any[] = item.status?.conditions ?? [];
    const ready = conditions.find((c: any) => c.type === 'Ready');
    const synced = conditions.find((c: any) => c.type === 'Synced');
    return ready?.status === 'False' || synced?.status === 'False';
  }).sort((a: any, b: any) => {
    const aTime = a.status?.conditions?.find((c: any) => c.status === 'False')?.lastTransitionTime ?? '';
    const bTime = b.status?.conditions?.find((c: any) => c.status === 'False')?.lastTransitionTime ?? '';
    return new Date(aTime).getTime() - new Date(bTime).getTime();
  });

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>
        Alerts
      </Typography>
      <Typography variant="body2" color="textSecondary" gutterBottom style={{ marginBottom: 16 }}>
        Managed resources with failing Ready or Synced conditions, oldest first.
      </Typography>

      {broken.length === 0 ? (
        <Alert severity="success" style={{ marginTop: 16 }}>
          All managed resources are healthy.
        </Alert>
      ) : (
        <>
          <Box mb={2}>
            <Chip
              label={`${broken.length} unhealthy`}
              style={{ background: xpColors.notReady.bg, color: '#fff', fontWeight: 600 }}
            />
          </Box>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left', background: '#fafafa' }}>
                {['Kind', 'Name', 'Provider', 'Ready', 'Synced', 'Failing Since', 'Reason', 'Message'].map((h) => (
                  <th key={h} style={{ padding: '8px 12px', fontWeight: 600 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {broken.map((item: any) => {
                const itemName: string = item.metadata?.name ?? '';
                const ns: string = item.metadata?.namespace ?? '';
                const conditions: any[] = item.status?.conditions ?? [];

                return (
                  <tr
                    key={`${item._providerName}/${item._group}/${item._plural}/${ns}/${itemName}`}
                    style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
                    onClick={() => openManagedDetail({ providerName: item._providerName, group: item._group, plural: item._plural, name: itemName, namespace: ns || undefined })}
                  >
                    <td style={{ padding: '8px 12px', fontWeight: 600 }}>{item._kind}</td>
                    <td style={{ padding: '8px 12px' }}>
                      <span style={{ color: xpColors.link, textDecoration: 'underline' }}>{itemName}</span>
                      {ns && (
                        <Typography variant="caption" display="block" color="textSecondary">
                          {ns}
                        </Typography>
                      )}
                    </td>
                    <td style={{ padding: '8px 12px', color: '#555' }}>
                      {item._providerName}
                    </td>
                    <td style={{ padding: '8px 12px' }}>{conditionChip(conditions, 'Ready')}</td>
                    <td style={{ padding: '8px 12px' }}>{conditionChip(conditions, 'Synced')}</td>
                    <td style={{ padding: '8px 12px', color: '#888' }}>
                      {failingSince(conditions)}
                    </td>
                    <td style={{ padding: '8px 12px' }}>
                      {firstFailReason(conditions)}
                    </td>
                    <td style={{ padding: '8px 12px', color: '#555', maxWidth: 300 }}>
                      {firstFailMessage(conditions)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </Box>
  );
}
