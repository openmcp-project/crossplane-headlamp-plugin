import { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Provider } from '../common/Resources';
import { clusterPrefix, useAllManagedResources, useCRDsForProvider, getApiProxy } from '../helpers';

const { Typography, Box, Paper, CircularProgress, Alert } =
  (window as any).pluginLib?.MuiCore ?? {};

// ── Donut chart (pure SVG) ────────────────────────────────────────────────────

interface DonutSlice {
  value: number;
  color: string;
  label: string;
  onClick?: () => void;
}

function DonutChart({ slices, total, size = 100 }: { slices: DonutSlice[]; total: number; size?: number }) {
  const r = size * 0.38;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;
  const segments = slices.map((s) => {
    const dash = total > 0 ? (s.value / total) * circumference : 0;
    const seg = { ...s, dash, offset };
    offset += dash;
    return seg;
  });
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ transform: 'rotate(-90deg)' }}>
      <circle cx={cx} cy={cy} r={r} fill="none" stroke="#e0e0e0" strokeWidth={size * 0.13} />
      {segments.map((s, i) =>
        s.dash > 0 ? (
          <circle key={i} cx={cx} cy={cy} r={r} fill="none"
            stroke={s.color} strokeWidth={size * 0.13}
            strokeDasharray={`${s.dash} ${circumference - s.dash}`}
            strokeDashoffset={-s.offset} strokeLinecap="butt"
          />
        ) : null
      )}
    </svg>
  );
}

function DonutCard({
  title,
  slices,
  total,
  loading,
  size = 100,
}: {
  title: string;
  slices: DonutSlice[];
  total: number;
  loading?: boolean;
  size?: number;
}) {
  return (
    <Paper elevation={1} style={{ padding: '16px 20px', flex: '1 1 220px', minWidth: 220 }}>
      <Typography variant="subtitle2" color="textSecondary" gutterBottom style={{ fontWeight: 600 }}>
        {title}
      </Typography>
      {loading ? (
        <Box display="flex" alignItems="center" gap={1} height={size}>
          <CircularProgress size={18} />
          <Typography variant="body2" color="textSecondary">Loading…</Typography>
        </Box>
      ) : (
        <Box display="flex" alignItems="center" gap={3}>
          <Box position="relative" flexShrink={0} style={{ width: size, height: size }}>
            <DonutChart slices={slices} total={total} size={size} />
            <Box position="absolute" top={0} left={0} right={0} bottom={0}
              display="flex" alignItems="center" justifyContent="center" flexDirection="column">
              <Typography style={{ fontWeight: 700, fontSize: size * 0.22, lineHeight: 1 }}>{total}</Typography>
              <Typography variant="caption" color="textSecondary" style={{ fontSize: size * 0.11 }}>total</Typography>
            </Box>
          </Box>
          <Box display="flex" flexDirection="column" gap={0.75}>
            {slices.map((s) => (
              <Box key={s.label} display="flex" alignItems="center" gap={1}
                style={{ cursor: s.onClick ? 'pointer' : 'default' }}
                onClick={s.onClick}
              >
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
                <Typography variant="body2" style={{ fontWeight: 700 }}>{s.value}</Typography>
                <Typography variant="body2" color="textSecondary"
                  style={{ textDecoration: s.onClick ? 'underline' : 'none' }}>
                  {s.label}
                </Typography>
              </Box>
            ))}
          </Box>
        </Box>
      )}
    </Paper>
  );
}

// ── Per-provider ProviderConfig count ─────────────────────────────────────────

function useProviderConfigs(providerName: string, currentRevision: string): { configs: any[] | null } {
  const [crds] = useCRDsForProvider(providerName, currentRevision);
  const [configs, setConfigs] = useState<any[] | null>(null);
  const configCrd = crds?.find((c: any) => c.jsonData?.spec?.names?.plural === 'providerconfigs');
  useEffect(() => {
    if (!configCrd) { setConfigs([]); return; }
    const group: string = configCrd.jsonData?.spec?.group ?? '';
    const ver: string = configCrd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
    getApiProxy()
      .request(`/apis/${group}/${ver}/providerconfigs`, { isJSON: true })
      .then((res: any) => setConfigs(res?.items ?? []))
      .catch(() => setConfigs([]));
  }, [configCrd?.metadata?.name]);
  return { configs };
}

// ── Provider card ─────────────────────────────────────────────────────────────

function ProviderCard({ provider, mrItems, mrLoading }: {
  provider: any;
  mrItems: any[];
  mrLoading: boolean;
}) {
  const history = useHistory();
  const conditions: any[] = provider.jsonData?.status?.conditions ?? [];
  const readyCond = conditions.find((c: any) => c.type === 'Ready');
  const healthyCond = conditions.find((c: any) => c.type === 'Healthy');
  const installedCond = conditions.find((c: any) => c.type === 'Installed');

  const allOk = readyCond?.status === 'True' && healthyCond?.status === 'True' && installedCond?.status === 'True';
  const anyError = readyCond?.status === 'False' || healthyCond?.status === 'False' || installedCond?.status === 'False';
  const borderColor = allOk ? '#4caf50' : anyError ? '#f44336' : '#ff9800';

  const currentRevision: string = provider.jsonData?.status?.currentRevision ?? '';
  const providerName: string = provider.metadata.name;
  const { configs } = useProviderConfigs(providerName, currentRevision);
  const configCount = configs?.length ?? null;

  const providerMRs = mrItems.filter((i: any) => i._providerName === providerName);
  const mrTotal = providerMRs.length;
  const mrReady = providerMRs.filter((i: any) =>
    i.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True'
  ).length;
  const mrSynced = providerMRs.filter((i: any) =>
    i.status?.conditions?.find((c: any) => c.type === 'Synced')?.status === 'True'
  ).length;
  const mrNotReady = mrTotal - mrReady;
  const mrNotSynced = mrTotal - mrSynced;

  const resourcesBase = `${clusterPrefix()}/crossplane/resources`;

  const mrSlices: DonutSlice[] = [
    {
      value: mrReady, color: '#4caf50', label: 'Ready',
      onClick: mrReady > 0
        ? () => history.push(`${resourcesBase}?provider=${providerName}&status=ready`)
        : undefined,
    },
    {
      value: mrNotReady, color: '#f44336', label: 'Not Ready',
      onClick: mrNotReady > 0
        ? () => history.push(`${resourcesBase}?provider=${providerName}&status=not-ready`)
        : undefined,
    },
  ];
  const syncSlices: DonutSlice[] = [
    {
      value: mrSynced, color: '#1976d2', label: 'Synced',
      onClick: mrSynced > 0
        ? () => history.push(`${resourcesBase}?provider=${providerName}&status=synced`)
        : undefined,
    },
    {
      value: mrNotSynced, color: '#ff9800', label: 'Not Synced',
      onClick: mrNotSynced > 0
        ? () => history.push(`${resourcesBase}?provider=${providerName}&status=not-synced`)
        : undefined,
    },
  ];

  return (
    <Paper elevation={2} style={{ borderLeft: `4px solid ${borderColor}`, overflow: 'hidden' }}>
      {/* Header */}
      <Box px={2} py={1.5} display="flex" alignItems="center" justifyContent="space-between"
        style={{ cursor: 'pointer', borderBottom: '1px solid #f0f0f0' }}
        onClick={() => history.push(`${clusterPrefix()}/crossplane/providers/${providerName}`)}
      >
        <Box>
          <Typography variant="h6" style={{ lineHeight: 1.2 }}>{providerName}</Typography>
          <Typography variant="caption" color="textSecondary" style={{ fontFamily: 'monospace' }}>
            {provider.jsonData?.spec?.package ?? ''}
          </Typography>
        </Box>
        <Box display="flex" gap={0.75} flexWrap="wrap" justifyContent="flex-end">
          {[
            { label: 'Ready', cond: readyCond },
            { label: 'Healthy', cond: healthyCond },
            { label: 'Installed', cond: installedCond },
          ].map(({ label, cond }) => {
            const ok = cond?.status === 'True';
            const bad = cond?.status === 'False';
            return (
              <span key={label} style={{
                padding: '2px 8px', borderRadius: 10,
                background: ok ? '#4caf50' : bad ? '#f44336' : '#9e9e9e',
                color: '#fff', fontSize: 11, fontWeight: 600,
              }}>
                {label}
              </span>
            );
          })}
        </Box>
      </Box>

      {/* Stats */}
      <Box px={2} py={1.5} display="flex" alignItems="center" gap={3} flexWrap="wrap">
        {mrLoading ? (
          <Box display="flex" alignItems="center" gap={1}>
            <CircularProgress size={14} />
            <Typography variant="caption" color="textSecondary">Loading resources…</Typography>
          </Box>
        ) : mrTotal === 0 ? (
          <Typography variant="caption" color="textSecondary">No managed resource instances</Typography>
        ) : (
          <>
            <DonutCard title="Ready" slices={mrSlices} total={mrTotal} size={60} />
            <DonutCard title="Synced" slices={syncSlices} total={mrTotal} size={60} />
          </>
        )}

        {mrTotal > 0 && <Box style={{ width: 1, height: 40, background: '#e0e0e0' }} />}

        <Box>
          <Typography variant="caption" color="textSecondary" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
            ProviderConfig{configCount !== 1 ? 's' : ''}{configCount !== null ? ` (${configCount})` : ''}
            {configCount === null && <CircularProgress size={10} style={{ marginLeft: 4 }} />}
          </Typography>
          {configs && configs.length === 0 && (
            <Typography variant="caption" color="textSecondary">None</Typography>
          )}
          {configs && configs.map((cfg: any) => {
            const cfgName: string = cfg.metadata?.name ?? '';
            const cfgConds: any[] = cfg.status?.conditions ?? [];
            const readyOk = cfgConds.find((c: any) => c.type === 'Ready')?.status === 'True';
            const readyBad = cfgConds.find((c: any) => c.type === 'Ready')?.status === 'False';
            const syncedOk = cfgConds.find((c: any) => c.type === 'Synced')?.status === 'True';
            const syncedBad = cfgConds.find((c: any) => c.type === 'Synced')?.status === 'False';
            return (
              <Box key={cfgName} display="flex" alignItems="center" justifyContent="space-between" gap={1} mb={0.5} style={{ width: '100%' }}>
                <Typography
                  variant="caption"
                  style={{ fontFamily: 'monospace', fontSize: 11, color: '#1976d2', cursor: 'pointer', textDecoration: 'underline', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  onClick={() => history.push(`${clusterPrefix()}/crossplane/providers/${providerName}/providerconfigs/${cfgName}`)}
                >
                  {cfgName}
                </Typography>
                <Box display="flex" gap={0.5} style={{ flexShrink: 0 }}>
                  {cfgConds.length > 0 && (
                    <>
                      <span style={{ padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600, color: '#fff', background: readyOk ? '#4caf50' : readyBad ? '#f44336' : '#9e9e9e' }}>Ready</span>
                      <span style={{ padding: '1px 6px', borderRadius: 8, fontSize: 10, fontWeight: 600, color: '#fff', background: syncedOk ? '#1976d2' : syncedBad ? '#f44336' : '#9e9e9e' }}>Synced</span>
                    </>
                  )}
                </Box>
              </Box>
            );
          })}
        </Box>
      </Box>
    </Paper>
  );
}

// ── Main Overview ─────────────────────────────────────────────────────────────

export default function CrossplaneOverview() {
  const history = useHistory();
  const [providers, error] = Provider.useList();
  const { items: mrItems, loading: mrLoading } = useAllManagedResources();

  if (error) {
    const errMsg: string = String(error?.message ?? error?.status ?? error ?? '').toLowerCase();
    const notInstalled = errMsg.includes('404') || errMsg.includes('not found') || errMsg.includes('no kind');
    return (
      <Box p={3}>
        <Alert severity={notInstalled ? 'info' : 'warning'}>
          {notInstalled
            ? 'Crossplane is not installed on this cluster — the Providers CRD was not found.'
            : `Could not load Crossplane providers: ${String(error?.message ?? error)}`}
        </Alert>
      </Box>
    );
  }

  if (!providers) {
    return (
      <Box p={3} display="flex" alignItems="center" gap={2}>
        <CircularProgress size={20} />
        <Typography>Loading Crossplane…</Typography>
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

  const mrTotal = mrItems.length;
  const mrReady = mrItems.filter((i: any) =>
    i.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True'
  ).length;
  const mrSynced = mrItems.filter((i: any) =>
    i.status?.conditions?.find((c: any) => c.type === 'Synced')?.status === 'True'
  ).length;
  const mrNotReady = mrTotal - mrReady;
  const mrNotSynced = mrTotal - mrSynced;

  const resourcesBase = `${clusterPrefix()}/crossplane/resources`;

  const mrReadySlices: DonutSlice[] = [
    {
      value: mrReady, color: '#4caf50', label: 'Ready',
      onClick: mrReady > 0 ? () => history.push(`${resourcesBase}?status=ready`) : undefined,
    },
    {
      value: mrNotReady, color: '#f44336', label: 'Not Ready',
      onClick: mrNotReady > 0 ? () => history.push(`${resourcesBase}?status=not-ready`) : undefined,
    },
  ];
  const mrSyncSlices: DonutSlice[] = [
    {
      value: mrSynced, color: '#1976d2', label: 'Synced',
      onClick: mrSynced > 0 ? () => history.push(`${resourcesBase}?status=synced`) : undefined,
    },
    {
      value: mrNotSynced, color: '#ff9800', label: 'Not Synced',
      onClick: mrNotSynced > 0 ? () => history.push(`${resourcesBase}?status=not-synced`) : undefined,
    },
  ];

  return (
    <Box p={3}>
      <Typography variant="h4" gutterBottom>Crossplane Overview</Typography>

      {/* Section 1: Managed Resources */}
      <Typography variant="overline" color="textSecondary" style={{ letterSpacing: 1.5 }}>
        Managed Resources
      </Typography>
      <Box display="flex" gap={2} mb={4} mt={0.5} flexWrap="wrap">
        <DonutCard title="Ready" slices={mrReadySlices} total={mrTotal} loading={mrLoading} />
        <DonutCard title="Synced" slices={mrSyncSlices} total={mrTotal} loading={mrLoading} />
      </Box>

      {/* Section 2: Providers */}
      <Typography variant="overline" color="textSecondary" style={{ letterSpacing: 1.5 }}>
        Providers
      </Typography>

      <Box display="flex" flexDirection="column" gap={2} mt={0.5}>
        {providers.map((provider: any) => (
          <ProviderCard
            key={provider.metadata.name}
            provider={provider}
            mrItems={mrItems}
            mrLoading={mrLoading}
          />
        ))}
      </Box>
    </Box>
  );
}
