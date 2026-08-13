import { useEffect, useState } from 'react';
import { useHistory } from 'react-router-dom';
import { Provider } from '../common/Resources';
import { clusterPrefix, useAllManagedResources, useCRDsForProvider, getApiProxy } from '../helpers';
import { xpColors, providerHealthColor } from '../common/colors';
import { openProviderConfigDetail } from '../providerconfigs/ProviderConfigDetail';

const { Typography, Box, Paper, CircularProgress, Alert } =
  (window as any).pluginLib?.MuiCore ?? {};
const { SectionBox } = (window as any).pluginLib?.CommonComponents ?? {};

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

// Inline donut + legend — no Paper wrapper
function DonutView({ title, slices, total, loading, size = 72 }: {
  title: string; slices: DonutSlice[]; total: number; loading?: boolean; size?: number;
}) {
  if (loading) {
    return (
      <Box display="flex" alignItems="center" gap={1} minWidth={160}>
        <CircularProgress size={14} />
        <Typography variant="caption" color="textSecondary">Loading…</Typography>
      </Box>
    );
  }
  return (
    <Box display="flex" alignItems="center" gap={2}>
      <Box position="relative" flexShrink={0} style={{ width: size, height: size }}>
        <DonutChart slices={slices} total={total} size={size} />
        <Box position="absolute" top={0} left={0} right={0} bottom={0}
          display="flex" alignItems="center" justifyContent="center">
          <Typography style={{ fontWeight: 700, fontSize: size * 0.22, lineHeight: 1 }}>{total}</Typography>
        </Box>
      </Box>
      <Box>
        <Typography variant="caption" color="textSecondary" style={{ fontWeight: 600, display: 'block', marginBottom: 4 }}>
          {title}
        </Typography>
        <Box display="flex" flexDirection="column" gap={0.5}>
          {slices.map((s) => (
            <Box key={s.label} display="flex" alignItems="center" gap={0.75}
              style={{ cursor: s.onClick ? 'pointer' : 'default' }}
              onClick={s.onClick}
            >
              <span style={{ width: 8, height: 8, borderRadius: '50%', background: s.color, flexShrink: 0 }} />
              <Typography variant="caption" style={{ fontWeight: 700 }}>{s.value}</Typography>
              <Typography variant="caption" color="textSecondary"
                style={{ textDecoration: s.onClick ? 'underline' : 'none' }}>
                {s.label}
              </Typography>
            </Box>
          ))}
        </Box>
      </Box>
    </Box>
  );
}

// Compact donut for header — just circle + count, no legend
function MiniDonut({ slices, total, label, size = 48 }: {
  slices: DonutSlice[]; total: number; label: string; size?: number;
}) {
  return (
    <Box display="flex" flexDirection="column" alignItems="center" style={{ gap: 2 }}>
      <Box position="relative" style={{ width: size, height: size, flexShrink: 0 }}>
        <DonutChart slices={slices} total={total} size={size} />
        <Box position="absolute" top={0} left={0} right={0} bottom={0}
          display="flex" alignItems="center" justifyContent="center">
          <Typography style={{ fontWeight: 700, fontSize: size * 0.24, lineHeight: 1 }}>{total}</Typography>
        </Box>
      </Box>
      <Typography style={{ fontSize: 10, color: '#888', lineHeight: 1 }}>{label}</Typography>
    </Box>
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
  const [expanded, setExpanded] = useState(false);

  const conditions: any[] = provider.jsonData?.status?.conditions ?? [];
  const readyCond     = conditions.find((c: any) => c.type === 'Ready');
  const healthyCond   = conditions.find((c: any) => c.type === 'Healthy');
  const installedCond = conditions.find((c: any) => c.type === 'Installed');
  const borderColor   = providerHealthColor(conditions);

  const currentRevision: string = provider.jsonData?.status?.currentRevision ?? '';
  const providerName: string    = provider.metadata.name;
  const { configs } = useProviderConfigs(providerName, currentRevision);

  const providerMRs  = mrItems.filter((i: any) => i._providerName === providerName);
  const mrTotal      = providerMRs.length;
  const mrReady      = providerMRs.filter((i: any) =>
    i.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True'
  ).length;
  const mrSynced     = providerMRs.filter((i: any) =>
    i.status?.conditions?.find((c: any) => c.type === 'Synced')?.status === 'True'
  ).length;
  const mrNotReady   = mrTotal - mrReady;
  const mrNotSynced  = mrTotal - mrSynced;

  const brokenMRs = providerMRs.filter((i: any) =>
    i.status?.conditions?.some((c: any) =>
      (c.type === 'Ready' || c.type === 'Synced') && c.status === 'False'
    )
  );

  const resourcesBase = `${clusterPrefix()}/crossplane/resources`;

  const mrSlices: DonutSlice[] = [
    { value: mrReady,    color: xpColors.ready.bg,   label: 'Ready' },
    { value: mrNotReady, color: xpColors.notReady.bg, label: 'Not Ready' },
  ];
  const syncSlices: DonutSlice[] = [
    { value: mrSynced,    color: xpColors.synced.bg,   label: 'Synced' },
    { value: mrNotSynced, color: xpColors.notSynced.bg, label: 'Not Synced' },
  ];

  const condBadge = (label: string, cond: any) => {
    const ok  = cond?.status === 'True';
    const bad = cond?.status === 'False';
    return (
      <span key={label} style={{
        padding: '1px 7px', borderRadius: 10, fontSize: 11, fontWeight: 600,
        background: ok ? xpColors.ready.bg : bad ? xpColors.notReady.bg : xpColors.unknown.bg,
        color: '#fff',
      }}>{label}</span>
    );
  };

  return (
    <Paper elevation={1} style={{ overflow: 'hidden' }}>
      {/* Header — click to expand, name click navigates */}
      <Box px={2} py={1.25} display="flex" alignItems="center" gap={1.5}
        style={{ cursor: 'pointer', borderBottom: expanded ? '1px solid #f0f0f0' : 'none' }}
        onClick={() => setExpanded(e => !e)}
      >
        <span style={{ width: 8, height: 8, borderRadius: '50%', background: borderColor, flexShrink: 0 }} />

        <Box flex={1} minWidth={0}>
          <Typography
            variant="subtitle2" style={{ lineHeight: 1.3, color: xpColors.link, textDecoration: 'underline', display: 'inline' }}
            onClick={(e: any) => { e.stopPropagation(); history.push(`${clusterPrefix()}/crossplane/providers/${providerName}`); }}
          >
            {providerName}
          </Typography>
          <Typography variant="caption" color="textSecondary" style={{ fontFamily: 'monospace', display: 'block' }}>
            {provider.jsonData?.spec?.package ?? ''}
          </Typography>
        </Box>

        {/* Mini donuts in header */}
        {!mrLoading && mrTotal > 0 && (
          <Box display="flex" alignItems="center" gap={2} mr={1}>
            <MiniDonut slices={mrSlices}  total={mrTotal} label="Ready"  size={44} />
            <MiniDonut slices={syncSlices} total={mrTotal} label="Synced" size={44} />
          </Box>
        )}
        {mrLoading && <CircularProgress size={14} style={{ marginRight: 8 }} />}

        <Box display="flex" alignItems="center" gap={0.75}>
          <span
            style={{ fontSize: 11, color: xpColors.link, textDecoration: 'underline', cursor: 'pointer', marginRight: 4 }}
            onClick={(e: any) => { e.stopPropagation(); history.push(`${clusterPrefix()}/crossplane/crds?provider=${providerName}`); }}
          >
            CRDs
          </span>
          {condBadge('Ready',     readyCond)}
          {condBadge('Healthy',   healthyCond)}
          {condBadge('Installed', installedCond)}
        </Box>

        {/* Chevron */}
        <svg width="16" height="16" viewBox="0 0 12 12" fill="none" stroke="#999" strokeWidth="1.8"
          strokeLinecap="round" strokeLinejoin="round"
          style={{ flexShrink: 0, transition: 'transform 0.2s', transform: expanded ? 'rotate(180deg)' : 'none' }}>
          <path d="M3 4.5l3 3 3-3"/>
        </svg>
      </Box>

      {/* Expanded body */}
      {expanded && (
        <Box display="flex" alignItems="flex-start" style={{ borderTop: '1px solid #f5f5f5' }}>
          {/* Broken resources */}
          <Box flex={1} px={2} py={1.5} minWidth={0}>
            <Typography variant="caption" color="textSecondary"
              style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>
              {brokenMRs.length === 0
                ? `All ${mrTotal} resources healthy`
                : `${brokenMRs.length} broken resource${brokenMRs.length !== 1 ? 's' : ''}`}
            </Typography>
            {brokenMRs.length > 0 && (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #f0f0f0', textAlign: 'left' as const }}>
                    <th style={{ padding: '2px 8px 4px 0', fontWeight: 600, color: '#666', fontSize: 11 }}>Name</th>
                    <th style={{ padding: '2px 8px 4px 0', fontWeight: 600, color: '#666', fontSize: 11 }}>Kind</th>
                    <th style={{ padding: '2px 0 4px 0',   fontWeight: 600, color: '#666', fontSize: 11 }}>Reason</th>
                  </tr>
                </thead>
                <tbody>
                  {brokenMRs.map((i: any) => {
                    const failingCond = i.status?.conditions?.find((c: any) =>
                      (c.type === 'Ready' || c.type === 'Synced') && c.status === 'False'
                    );
                    return (
                      <tr key={i.metadata?.name}
                        style={{ borderBottom: '1px solid #fafafa', cursor: 'pointer' }}
                        onClick={() => history.push(`${resourcesBase}?provider=${providerName}&status=not-ready`)}
                      >
                        <td style={{ padding: '3px 8px 3px 0', fontFamily: 'monospace', fontSize: 11, color: xpColors.link, textDecoration: 'underline' }}>
                          {i.metadata?.name}
                        </td>
                        <td style={{ padding: '3px 8px 3px 0', fontSize: 11, color: '#555' }}>
                          {i._kind ?? i._plural}
                        </td>
                        <td style={{ padding: '3px 0', fontSize: 11, color: xpColors.notReady.bg, maxWidth: 300, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                          {failingCond?.reason ?? failingCond?.message ?? '—'}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </Box>

          {/* ProviderConfigs — right column */}
          {configs && configs.length > 0 && (
            <>
              <Box style={{ width: 1, background: '#f0f0f0', alignSelf: 'stretch' }} />
              <Box px={2} py={1.5} style={{ minWidth: 200 }}>
                <Typography variant="caption" color="textSecondary"
                  style={{ fontWeight: 600, display: 'block', marginBottom: 8 }}>
                  ProviderConfigs ({configs.length})
                </Typography>
                <Box display="flex" flexDirection="column" gap={0.75}>
                  {configs.map((cfg: any) => {
                    const cfgName: string  = cfg.metadata?.name ?? '';
                    const cfgConds: any[]  = cfg.status?.conditions ?? [];
                    const readyOk  = cfgConds.find((c: any) => c.type === 'Ready')?.status === 'True';
                    const readyBad = cfgConds.find((c: any) => c.type === 'Ready')?.status === 'False';
                    const syncOk   = cfgConds.find((c: any) => c.type === 'Synced')?.status === 'True';
                    const syncBad  = cfgConds.find((c: any) => c.type === 'Synced')?.status === 'False';
                    return (
                      <Box key={cfgName} display="flex" alignItems="center" gap={1}>
                        <Typography variant="caption"
                          style={{ fontFamily: 'monospace', color: xpColors.link, cursor: 'pointer', textDecoration: 'underline' }}
                          onClick={() => openProviderConfigDetail({ providerName, configName: cfgName })}
                        >
                          {cfgName}
                        </Typography>
                        {cfgConds.length > 0 && (
                          <Box display="flex" gap={0.5}>
                            <span style={{ padding: '1px 5px', borderRadius: 8, fontSize: 10, fontWeight: 600, color: '#fff', background: readyOk ? xpColors.ready.bg : readyBad ? xpColors.notReady.bg : xpColors.unknown.bg }}>Ready</span>
                            <span style={{ padding: '1px 5px', borderRadius: 8, fontSize: 10, fontWeight: 600, color: '#fff', background: syncOk ? xpColors.synced.bg : syncBad ? xpColors.notReady.bg : xpColors.unknown.bg }}>Synced</span>
                          </Box>
                        )}
                      </Box>
                    );
                  })}
                </Box>
              </Box>
            </>
          )}
          {configs === null && (
            <Box p={2}><CircularProgress size={12} /></Box>
          )}
        </Box>
      )}
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

  const mrTotal     = mrItems.length;
  const mrReady     = mrItems.filter((i: any) =>
    i.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True'
  ).length;
  const mrSynced    = mrItems.filter((i: any) =>
    i.status?.conditions?.find((c: any) => c.type === 'Synced')?.status === 'True'
  ).length;
  const mrNotReady  = mrTotal - mrReady;
  const mrNotSynced = mrTotal - mrSynced;

  const resourcesBase = `${clusterPrefix()}/crossplane/resources`;

  const mrReadySlices: DonutSlice[] = [
    { value: mrReady,    color: xpColors.ready.bg,   label: 'Ready',
      onClick: mrReady > 0    ? () => history.push(`${resourcesBase}?status=ready`)     : undefined },
    { value: mrNotReady, color: xpColors.notReady.bg, label: 'Not Ready',
      onClick: mrNotReady > 0 ? () => history.push(`${resourcesBase}?status=not-ready`) : undefined },
  ];
  const mrSyncSlices: DonutSlice[] = [
    { value: mrSynced,    color: xpColors.synced.bg,   label: 'Synced',
      onClick: mrSynced > 0    ? () => history.push(`${resourcesBase}?status=synced`)     : undefined },
    { value: mrNotSynced, color: xpColors.notSynced.bg, label: 'Not Synced',
      onClick: mrNotSynced > 0 ? () => history.push(`${resourcesBase}?status=not-synced`) : undefined },
  ];

  return (
    <SectionBox title="Overview" headerProps={{ headerStyle: 'main' }}>

      {/* Global managed resource summary */}
      <Box display="flex" alignItems="center" gap={4} flexWrap="wrap" mb={3}>
        <DonutView title="Ready"  slices={mrReadySlices} total={mrTotal} loading={mrLoading} size={100} />
        <Box style={{ width: 1, height: 60, background: '#e8e8e8' }} />
        <DonutView title="Synced" slices={mrSyncSlices}  total={mrTotal} loading={mrLoading} size={100} />
      </Box>

      {/* Per-provider cards */}
      <Typography variant="h6" style={{ marginBottom: 12 }}>
        Providers
      </Typography>
      <Box display="flex" flexDirection="column" gap={1.5}>
        {providers.map((provider: any) => (
          <ProviderCard
            key={provider.metadata.name}
            provider={provider}
            mrItems={mrItems}
            mrLoading={mrLoading}
          />
        ))}
      </Box>

    </SectionBox>
  );
}
