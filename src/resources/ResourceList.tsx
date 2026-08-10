import { useEffect, useState } from 'react';
import { openManagedDetail } from '../managed/ManagedDetail';
import { useHistory, useLocation } from 'react-router-dom';
import { Provider } from '../common/Resources';
import { useCRDsForProvider, getApiProxy, clusterPrefix, NON_MANAGED_PLURALS } from '../helpers';
import { xpColors, DOT } from '../common/colors';
import { ScopeBadge } from '../common/ScopeBadge';

const {
  Typography, Box, Chip, CircularProgress, Paper,
  TextField, InputAdornment, MenuItem,
} = (window as any).pluginLib?.MuiCore ?? {};
const { SectionBox } = (window as any).pluginLib?.CommonComponents ?? {};

// ── URL query helpers ─────────────────────────────────────────────────────────

function parseSearch(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

// ── Status filter types ───────────────────────────────────────────────────────

type StatusFilter = 'ready' | 'not-ready' | 'synced' | 'not-synced';

function matchesStatusFilter(item: any, filters: StatusFilter[]): boolean {
  if (filters.length === 0) return true;
  const conditions: any[] = item.status?.conditions ?? [];
  const readyStatus = conditions.find((c: any) => c.type === 'Ready')?.status;
  const syncedStatus = conditions.find((c: any) => c.type === 'Synced')?.status;
  return filters.some((filter) => {
    if (filter === 'ready') return readyStatus === 'True';
    if (filter === 'not-ready') return readyStatus !== 'True';
    if (filter === 'synced') return syncedStatus === 'True';
    if (filter === 'not-synced') return syncedStatus !== 'True';
    return true;
  });
}

// ── Instance fetching ─────────────────────────────────────────────────────────

function useInstancesForCRD(crd: any, expanded: boolean, statusFilter: StatusFilter[]) {
  const [instances, setInstances] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!expanded || !crd) return;
    const group: string = crd.jsonData?.spec?.group ?? '';
    const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
    const ver: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
    setLoading(true);
    getApiProxy()
      .request(`/apis/${group}/${ver}/${plural}`, { isJSON: true })
      .then((res: any) => { setInstances(res?.items ?? []); setLoading(false); })
      .catch(() => { setInstances([]); setLoading(false); });
  }, [expanded, crd?.metadata?.name]);

  const filtered = instances
    ? instances.filter((i) => matchesStatusFilter(i, statusFilter))
    : null;

  return { instances: filtered, loading };
}

function useCRDInstanceCounts(crds: any[] | null): Map<string, { total: number; ready: number; notReady: number }> | null {
  const [counts, setCounts] = useState<Map<string, { total: number; ready: number; notReady: number }> | null>(null);

  useEffect(() => {
    if (!crds) { setCounts(null); return; }
    if (crds.length === 0) { setCounts(new Map()); return; }
    let cancelled = false;
    const result = new Map<string, { total: number; ready: number; notReady: number }>();
    const fetches = crds.map((crd: any) => {
      const group: string = crd.jsonData?.spec?.group ?? '';
      const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
      const ver: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
      if (!group || !plural) { result.set(crd.metadata.name, { total: 0, ready: 0, notReady: 0 }); return Promise.resolve(); }
      return getApiProxy()
        .request(`/apis/${group}/${ver}/${plural}`, { isJSON: true })
        .then((res: any) => {
          const items: any[] = res?.items ?? [];
          const ready = items.filter((i: any) =>
            i.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True'
          ).length;
          result.set(crd.metadata.name, { total: items.length, ready, notReady: items.length - ready });
        })
        .catch(() => { result.set(crd.metadata.name, { total: 0, ready: 0, notReady: 0 }); });
    });
    Promise.all(fetches).then(() => { if (!cancelled) setCounts(new Map(result)); });
    return () => { cancelled = true; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [crds?.map((c: any) => c.metadata.name).join(',')]);

  return counts;
}

// ── Health chips ──────────────────────────────────────────────────────────────

function readyChip(conditions: any[]) {
  const cond = conditions?.find((c: any) => c.type === 'Ready');
  if (!cond) return <Chip label="—" size="small" />;
  const ok = cond.status === 'True';
  return <Chip label={ok ? 'Ready' : 'Not Ready'} size="small"
    style={{ background: ok ? xpColors.ready.bg : xpColors.notReady.bg, color: '#fff', fontWeight: 600 }} />;
}

function syncedChip(conditions: any[]) {
  const cond = conditions?.find((c: any) => c.type === 'Synced');
  if (!cond) return <Chip label="—" size="small" />;
  const ok = cond.status === 'True';
  return <Chip label={ok ? 'Synced' : 'Not Synced'} size="small"
    style={{ background: ok ? xpColors.synced.bg : xpColors.notSynced.bg, color: '#fff', fontWeight: 600 }} />;
}

// ── Expanded instances sub-table ──────────────────────────────────────────────

function InstancesSubTable({ crd, providerName, statusFilter }: {
  crd: any;
  providerName: string;
  statusFilter: StatusFilter[];
}) {
  const { instances, loading } = useInstancesForCRD(crd, true, statusFilter);
  const group: string = crd.jsonData?.spec?.group ?? '';
  const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
  const scope: string = crd.jsonData?.spec?.scope ?? 'Cluster';
  const isNamespaced = scope === 'Namespaced';

  if (loading) {
    return (
      <Box px={3} py={2} display="flex" alignItems="center" gap={1}>
        <CircularProgress size={14} />
        <Typography variant="body2" color="textSecondary">Loading instances…</Typography>
      </Box>
    );
  }
  if (!instances || instances.length === 0) {
    return (
      <Box px={3} py={2}>
        <Typography variant="body2" color="textSecondary">
          {statusFilter.length > 0 ? 'No instances match the current filter.' : 'No instances found.'}
        </Typography>
      </Box>
    );
  }

  return (
    <Box style={{ background: '#f9f9f9', borderTop: '1px solid #e8e8e8' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <tbody>
          {instances.map((inst: any) => {
            const instName: string = inst.metadata?.name ?? '';
            const ns: string = inst.metadata?.namespace ?? '';
            const conditions: any[] = inst.status?.conditions ?? [];
            const created = inst.metadata?.creationTimestamp
              ? new Date(inst.metadata.creationTimestamp).toLocaleDateString()
              : '—';
            const isReady = conditions.find((c: any) => c.type === 'Ready')?.status === 'True';
            const isSynced = conditions.find((c: any) => c.type === 'Synced')?.status === 'True';
            return (
              <tr key={`${ns}/${instName}`}
                style={{
                  borderBottom: '1px solid #ebebeb', cursor: 'pointer',
                  background: (!isReady || !isSynced) ? 'rgba(244,67,54,0.04)' : 'transparent',
                }}
                onClick={() => openManagedDetail({ providerName, group, plural, name: instName, namespace: ns || undefined })}
              >
                {/* col 1: indent spacer */}
                <td style={{ padding: '6px 4px 6px 12px', width: 24 }} />
                {/* col 2: name */}
                <td style={{ padding: '6px 12px' }}>
                  <span style={{ color: xpColors.link, textDecoration: 'underline', fontSize: 13 }}>{instName}</span>
                  {isNamespaced && ns && (
                    <span style={{ color: '#888', fontSize: 11, marginLeft: 6 }}>{ns}</span>
                  )}
                </td>
                {/* col 3+4: group/version/scope spacers — empty, keeps alignment */}
                <td style={{ padding: '6px 12px', fontSize: 12, color: '#aaa' }} colSpan={3}>{created}</td>
                {/* col 6: health — aligns with parent "Health" column */}
                <td style={{ padding: '6px 12px 6px 20px', textAlign: 'right' as const, whiteSpace: 'nowrap' as const }}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {readyChip(conditions)}
                    {syncedChip(conditions)}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Box>
  );
}

// ── Sort types ────────────────────────────────────────────────────────────────

type SortKey = 'kind' | 'group' | 'version' | 'scope' | 'instances';
type SortDir = 'asc' | 'desc';

// ── CRD row ───────────────────────────────────────────────────────────────────

function CRDRow({ crd, providerName, count, statusFilter }: {
  crd: any;
  providerName: string;
  count: { total: number; ready: number; notReady: number };
  statusFilter: StatusFilter[];
}) {
  const history = useHistory();
  const [expanded, setExpanded] = useState(false);

  const group: string = crd.jsonData?.spec?.group ?? '';
  const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
  const kind: string = crd.jsonData?.spec?.names?.kind ?? '';
  const scope: string = crd.jsonData?.spec?.scope ?? '';
  const topVersion: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
  const hasInstances = count.total > 0;

  // Auto-expand if a status filter is active and there are instances
  useEffect(() => {
    if (statusFilter.length > 0 && hasInstances) setExpanded(true);
  }, [statusFilter, hasInstances]);

  return (
    <>
      <tr
        style={{ borderBottom: expanded ? 'none' : '1px solid #f0f0f0', cursor: 'pointer' }}
        onClick={() => {
          if (hasInstances) setExpanded((v) => !v);
          else history.push(`${clusterPrefix()}/crossplane/providers/${providerName}/resources/${group}/${plural}`);
        }}
      >
        <td style={{ padding: '8px 4px 8px 12px', width: 24 }}>
          {hasInstances ? (
            <span style={{ fontSize: 11, color: '#888', userSelect: 'none' as const }}>
              {expanded ? '▾' : '▸'}
            </span>
          ) : <span style={{ display: 'inline-block', width: 12 }} />}
        </td>
        <td style={{ padding: '8px 12px' }}>
          <span style={{ color: xpColors.link, textDecoration: 'underline' }}>{kind}</span>
        </td>
        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>{group}</td>
        <td style={{ padding: '8px 12px', fontSize: 12 }}>{topVersion}</td>
        <td style={{ padding: '8px 12px' }}>
          <ScopeBadge scope={scope} />
        </td>
        <td style={{ padding: '8px 12px', textAlign: 'right' as const, paddingRight: 20 }}>
          {hasInstances ? (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {count.notReady > 0 && (
                <Chip label={`${count.notReady} not ready`} size="small"
                  style={{ background: xpColors.notReady.bg, color: '#fff', fontWeight: 600 }} />
              )}
              {count.ready > 0 && (
                <Chip label={`${count.ready} ready`} size="small"
                  style={{ background: xpColors.ready.bg, color: '#fff', fontWeight: 600 }} />
              )}
            </span>
          ) : (
            <span style={{ color: '#bbb', fontSize: 12 }}>—</span>
          )}
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={6} style={{ padding: 0 }}>
            <InstancesSubTable crd={crd} providerName={providerName} statusFilter={statusFilter} />
          </td>
        </tr>
      )}
    </>
  );
}

// ── Provider section ──────────────────────────────────────────────────────────

function ProviderSection({ provider, search, sortKey, sortDir, onSort, statusFilter }: {
  provider: any;
  search: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  statusFilter: StatusFilter[];
}) {
  const currentRevision: string = provider.jsonData?.status?.currentRevision ?? '';
  const [crds, crdErr] = useCRDsForProvider(provider.metadata.name, currentRevision);
  const counts = useCRDInstanceCounts(
    crds ? crds.filter((c: any) => !NON_MANAGED_PLURALS.has(c.jsonData?.spec?.names?.plural ?? '')) : null
  );

  const loading = crds === null && !crdErr;
  const countsLoading = crds !== null && counts === null;
  const lc = search.toLowerCase();

  const visibleCrds = (() => {
    if (!crds) return [];
    let list = crds.filter((c: any) => !NON_MANAGED_PLURALS.has(c.jsonData?.spec?.names?.plural ?? ''));
    if (counts !== null) {
      list = list.filter((c: any) => (counts.get(c.metadata.name)?.total ?? 0) > 0);
    }
    if (lc) {
      list = list.filter((c: any) => {
        const kind: string = c.jsonData?.spec?.names?.kind ?? '';
        const group: string = c.jsonData?.spec?.group ?? '';
        return kind.toLowerCase().includes(lc) || group.toLowerCase().includes(lc);
      });
    }
    return [...list].sort((a: any, b: any) => {
      let va: any, vb: any;
      if (sortKey === 'kind') { va = a.jsonData?.spec?.names?.kind ?? ''; vb = b.jsonData?.spec?.names?.kind ?? ''; }
      else if (sortKey === 'group') { va = a.jsonData?.spec?.group ?? ''; vb = b.jsonData?.spec?.group ?? ''; }
      else if (sortKey === 'version') { va = a.jsonData?.spec?.versions?.[0]?.name ?? ''; vb = b.jsonData?.spec?.versions?.[0]?.name ?? ''; }
      else if (sortKey === 'scope') { va = a.jsonData?.spec?.scope ?? ''; vb = b.jsonData?.spec?.scope ?? ''; }
      else if (sortKey === 'instances') { va = counts?.get(a.metadata.name)?.total ?? 0; vb = counts?.get(b.metadata.name)?.total ?? 0; }
      if (va < vb) return sortDir === 'asc' ? -1 : 1;
      if (va > vb) return sortDir === 'asc' ? 1 : -1;
      return 0;
    });
  })();

  const SortHeader = ({ label, sk }: { label: string; sk: SortKey }) => (
    <th onClick={() => onSort(sk)}
      style={{ padding: '8px 12px', fontWeight: 600, fontSize: 13, cursor: 'pointer', userSelect: 'none' as const, whiteSpace: 'nowrap' as const }}>
      {label}
      {sortKey === sk && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );

  return (
    <Paper elevation={1} style={{ marginBottom: 24 }}>
      <Box px={2} py={1.5} borderBottom="1px solid #e0e0e0" display="flex" alignItems="center" gap={1}>
        <Typography variant="h6">{provider.metadata.name}</Typography>
        {crds !== null && counts !== null && <Chip label={`${visibleCrds.length} types`} size="small" />}
      </Box>
      {loading || countsLoading ? (
        <Box px={2} py={2} display="flex" alignItems="center" gap={1}>
          <CircularProgress size={16} />
          <Typography variant="body2">Loading…</Typography>
        </Box>
      ) : crdErr ? (
        <Box px={2} py={1.5}><Typography variant="body2" color="error">Error loading CRDs</Typography></Box>
      ) : visibleCrds.length === 0 ? (
        <Box px={2} py={1.5}>
          <Typography variant="body2" color="textSecondary">
            {lc ? 'No types match your search.' : 'No resource types with instances.'}
          </Typography>
        </Box>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left', background: '#fafafa' }}>
              <th style={{ padding: '8px 4px 8px 12px', width: 24 }} />
              <SortHeader label="Kind" sk="kind" />
              <SortHeader label="Group" sk="group" />
              <SortHeader label="Version" sk="version" />
              <SortHeader label="Scope" sk="scope" />
              <SortHeader label="Health" sk="instances" />
            </tr>
          </thead>
          <tbody>
            {visibleCrds.map((crd: any) => (
              <CRDRow key={crd.metadata.name} crd={crd} providerName={provider.metadata.name}
                count={counts?.get(crd.metadata.name) ?? { total: 0, ready: 0, notReady: 0 }} statusFilter={statusFilter} />
            ))}
          </tbody>
        </table>
      )}
    </Paper>
  );
}

// ── Main ResourceList ─────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'ready', label: 'Ready' },
  { value: 'not-ready', label: 'Not Ready' },
  { value: 'synced', label: 'Synced' },
  { value: 'not-synced', label: 'Not Synced' },
];

export default function ResourceList() {
  const history = useHistory();
  const location = useLocation();
  const [providers, providerErr] = Provider.useList();
  const [search, setSearch] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('kind');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Read initial filter state from URL
  const qp = parseSearch(location.search);
  const [statusFilter, setStatusFilter] = useState<StatusFilter[]>(
    qp.get('status') ? (qp.get('status')!.split(',') as StatusFilter[]) : []
  );
  const [providerFilter, setProviderFilter] = useState<string>(qp.get('provider') ?? 'all');

  // Sync state → URL whenever filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter.length > 0) params.set('status', statusFilter.join(','));
    if (providerFilter !== 'all') params.set('provider', providerFilter);
    const newSearch = params.toString() ? `?${params.toString()}` : '';
    if (location.search !== newSearch) {
      history.replace({ ...location, search: newSearch });
    }
  }, [statusFilter, providerFilter]);

  // When status filter is active, also expand rows with instances — handled inside CRDRow

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

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

  const providerNames = (providers ?? []).map((p: any) => p.metadata.name);
  const visibleProviders = providerFilter === 'all'
    ? (providers ?? [])
    : (providers ?? []).filter((p: any) => p.metadata.name === providerFilter);

  // Active filter banner
  const hasActiveFilter = statusFilter.length > 0 || providerFilter !== 'all';

  return (
    <SectionBox
      title="Resources"
      headerProps={{
        headerStyle: 'main',
        actions: [
          <Box display="flex" alignItems="center" gap={1}>
            <TextField
              size="small"
              placeholder="Search kind or group…"
              value={search}
              onChange={(e: any) => setSearch(e.target.value)}
              InputProps={{
                startAdornment: (
                  <InputAdornment position="start">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.45 }}>
                      <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
                    </svg>
                  </InputAdornment>
                ),
              }}
              style={{ width: 200 }}
            />
            <TextField
              select
              size="small"
              value={statusFilter}
              onChange={(e: any) => {
                const val: StatusFilter[] = typeof e.target.value === 'string'
                  ? (e.target.value ? e.target.value.split(',') : [])
                  : e.target.value;
                setStatusFilter(val);
              }}
              style={{ minWidth: 140 }}
              SelectProps={{
                multiple: true,
                displayEmpty: true,
                renderValue: (selected: any) => {
                  const sel = selected as StatusFilter[];
                  if (sel.length === 0) return <span style={{ opacity: 0.5 }}>Status</span>;
                  return (
                    <span style={{ display: 'inline-flex', gap: 4, flexWrap: 'wrap' }}>
                      {sel.map((v) => {
                        const opt = STATUS_OPTIONS.find((o) => o.value === v);
                        return (
                          <span key={v} style={{
                            display: 'inline-flex', alignItems: 'center', gap: 4,
                            background: DOT[v], color: '#fff',
                            borderRadius: 10, padding: '1px 8px', fontSize: 11, fontWeight: 600,
                          }}>
                            {opt?.label ?? v}
                          </span>
                        );
                      })}
                    </span>
                  );
                },
              }}
            >
              {STATUS_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
                      background: DOT[o.value] ?? 'transparent',
                    }} />
                    {o.label}
                  </span>
                </MenuItem>
              ))}
            </TextField>
            <TextField
              select
              size="small"
              value={providerFilter}
              onChange={(e: any) => setProviderFilter(e.target.value)}
              style={{ width: 160 }}
              disabled={providerNames.length <= 1}
            >
              <MenuItem value="all">All providers</MenuItem>
              {providerNames.map((n: string) => (
                <MenuItem key={n} value={n}>{n}</MenuItem>
              ))}
            </TextField>
          </Box>,
        ],
      }}
    >
      {/* Active filter indicator */}
      {hasActiveFilter && (
        <Box mb={1.5} display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <Typography variant="caption" color="textSecondary">Filtered:</Typography>
          {statusFilter.map((v) => {
            const opt = STATUS_OPTIONS.find((o) => o.value === v);
            return (
              <span key={v} style={{
                display: 'inline-flex', alignItems: 'center', gap: 4,
                background: DOT[v], color: '#fff',
                borderRadius: 10, padding: '2px 10px', fontSize: 11, fontWeight: 600,
              }}>
                {opt?.label}
                <span style={{ cursor: 'pointer', opacity: 0.8, marginLeft: 2 }}
                  onClick={() => setStatusFilter(statusFilter.filter((f) => f !== v))}>×</span>
              </span>
            );
          })}
          {providerFilter !== 'all' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: '#616161', color: '#fff',
              borderRadius: 10, padding: '2px 10px', fontSize: 11, fontWeight: 600,
            }}>
              {providerFilter}
              <span style={{ cursor: 'pointer', opacity: 0.8, marginLeft: 2 }}
                onClick={() => setProviderFilter('all')}>×</span>
            </span>
          )}
        </Box>
      )}

      {visibleProviders.map((p: any) => (
        <ProviderSection
          key={p.metadata.name}
          provider={p}
          search={search}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          statusFilter={statusFilter}
        />
      ))}
    </SectionBox>
  );
}
