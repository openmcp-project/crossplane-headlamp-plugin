import { useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { Provider } from '../common/Resources';
import { useCRDsForProvider, getApiProxy, clusterPrefix, NON_MANAGED_PLURALS } from '../helpers';
import { xpColors, DOT } from '../common/colors';

const {
  Typography, Box, Chip, CircularProgress, Paper,
  FormControlLabel, Checkbox, TextField, InputAdornment, MenuItem, Select, FormControl, InputLabel,
} = (window as any).pluginLib?.MuiCore ?? {};

// ── URL query helpers ─────────────────────────────────────────────────────────

function parseSearch(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

// ── Status filter types ───────────────────────────────────────────────────────

type StatusFilter = 'all' | 'ready' | 'not-ready' | 'synced' | 'not-synced' | 'needs-attention';

function matchesStatusFilter(item: any, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  const conditions: any[] = item.status?.conditions ?? [];
  const readyStatus = conditions.find((c: any) => c.type === 'Ready')?.status;
  const syncedStatus = conditions.find((c: any) => c.type === 'Synced')?.status;
  if (filter === 'ready') return readyStatus === 'True';
  if (filter === 'not-ready') return readyStatus !== 'True';
  if (filter === 'synced') return syncedStatus === 'True';
  if (filter === 'not-synced') return syncedStatus !== 'True';
  if (filter === 'needs-attention') return readyStatus !== 'True' || syncedStatus !== 'True';
  return true;
}

// ── Label filter helpers ──────────────────────────────────────────────────────

function parseLabelFilter(raw: string): { key: string; value: string | null } | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const colonIdx = trimmed.indexOf(':');
  if (colonIdx === -1) return { key: trimmed.toLowerCase(), value: null };
  return {
    key: trimmed.slice(0, colonIdx).trim().toLowerCase(),
    value: trimmed.slice(colonIdx + 1).trim().toLowerCase(),
  };
}

function matchesLabelFilter(labels: Record<string, string>, filter: { key: string; value: string | null }): boolean {
  const entry = Object.entries(labels).find(([k]) => k.toLowerCase().includes(filter.key));
  if (!entry) return false;
  if (filter.value === null) return true;
  return entry[1].toLowerCase().includes(filter.value);
}

function useInstancesForCRD(crd: any, expanded: boolean, statusFilter: StatusFilter) {
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

function useCRDInstanceCounts(crds: any[] | null): Map<string, { total: number; ready: number; notReady: number; synced: number; notSynced: number }> | null {
  const [counts, setCounts] = useState<Map<string, { total: number; ready: number; notReady: number; synced: number; notSynced: number }> | null>(null);

  useEffect(() => {
    if (!crds) { setCounts(null); return; }
    if (crds.length === 0) { setCounts(new Map()); return; }
    let cancelled = false;
    const result = new Map<string, { total: number; ready: number; notReady: number; synced: number; notSynced: number }>();
    const fetches = crds.map((crd: any) => {
      const group: string = crd.jsonData?.spec?.group ?? '';
      const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
      const ver: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
      if (!group || !plural) { result.set(crd.metadata.name, { total: 0, ready: 0, notReady: 0, synced: 0, notSynced: 0 }); return Promise.resolve(); }
      return getApiProxy()
        .request(`/apis/${group}/${ver}/${plural}`, { isJSON: true })
        .then((res: any) => {
          const items: any[] = res?.items ?? [];
          const ready = items.filter((i: any) =>
            i.status?.conditions?.find((c: any) => c.type === 'Ready')?.status === 'True'
          ).length;
          const synced = items.filter((i: any) =>
            i.status?.conditions?.find((c: any) => c.type === 'Synced')?.status === 'True'
          ).length;
          result.set(crd.metadata.name, { total: items.length, ready, notReady: items.length - ready, synced, notSynced: items.length - synced });
        })
        .catch(() => { result.set(crd.metadata.name, { total: 0, ready: 0, notReady: 0, synced: 0, notSynced: 0 }); });
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

function InstancesSubTable({ crd, providerName, statusFilter, labelFilter }: {
  crd: any;
  providerName: string;
  statusFilter: StatusFilter;
  labelFilter: string;
}) {
  const history = useHistory();
  const { instances, loading } = useInstancesForCRD(crd, true, statusFilter);
  const group: string = crd.jsonData?.spec?.group ?? '';
  const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
  const scope: string = crd.jsonData?.spec?.scope ?? 'Cluster';
  const isNamespaced = scope === 'Namespaced';

  const parsedLabel = parseLabelFilter(labelFilter);

  const visibleInstances = instances
    ? (parsedLabel
        ? instances.filter((i: any) => matchesLabelFilter(i.metadata?.labels ?? {}, parsedLabel))
        : instances)
    : null;

  if (loading) {
    return (
      <tr>
        <td colSpan={8} style={{ padding: '6px 12px 6px 36px' }}>
          <Box display="flex" alignItems="center" gap={1}>
            <CircularProgress size={14} />
            <Typography variant="body2" color="textSecondary">Loading instances…</Typography>
          </Box>
        </td>
      </tr>
    );
  }
  if (!visibleInstances || visibleInstances.length === 0) {
    return (
      <tr>
        <td colSpan={8} style={{ padding: '6px 12px 6px 36px' }}>
          <Typography variant="body2" color="textSecondary">
            {parsedLabel ? 'No instances match the label filter.' : statusFilter !== 'all' ? 'No instances match the current filter.' : 'No instances found.'}
          </Typography>
        </td>
      </tr>
    );
  }

  return (
    <>
      {visibleInstances.map((inst: any) => {
        const instName: string = inst.metadata?.name ?? '';
        const ns: string = inst.metadata?.namespace ?? '';
        const conditions: any[] = inst.status?.conditions ?? [];
        const labels: Record<string, string> = inst.metadata?.labels ?? {};
        const created = inst.metadata?.creationTimestamp
          ? new Date(inst.metadata.creationTimestamp).toLocaleDateString()
          : '—';
        const isReady = conditions.find((c: any) => c.type === 'Ready')?.status === 'True';
        const isSynced = conditions.find((c: any) => c.type === 'Synced')?.status === 'True';
        const detailUrl = isNamespaced
          ? `${clusterPrefix()}/crossplane/providers/${providerName}/resources/${group}/${plural}/${ns}/${instName}`
          : `${clusterPrefix()}/crossplane/providers/${providerName}/resources/${group}/${plural}/${instName}`;
        return (
          <tr
            key={`${ns}/${instName}`}
            style={{
              borderBottom: '1px solid #ebebeb',
              cursor: 'pointer',
              background: (!isReady || !isSynced) ? 'rgba(244,67,54,0.04)' : '#fafffe',
            }}
            onClick={() => history.push(detailUrl)}
          >
            {/* col 1: chevron spacer */}
            <td style={{ padding: '6px 4px 6px 12px', width: 24 }} />
            {/* col 2: name + labels */}
            <td style={{ padding: '6px 12px 6px 28px' }}>
              <div>
                <span style={{ color: xpColors.link, textDecoration: 'underline', fontSize: 13 }}>{instName}</span>
                {isNamespaced && ns && (
                  <span style={{ color: '#888', fontSize: 11, marginLeft: 6 }}>{ns}</span>
                )}
              </div>
              {Object.keys(labels).length > 0 && (
                <div style={{ display: 'flex', flexWrap: 'wrap' as const, gap: 3, marginTop: 3 }}>
                  {Object.entries(labels).map(([k, v]) => (
                    <span
                      key={k}
                      style={{
                        fontSize: 10,
                        background: parsedLabel && matchesLabelFilter({ [k]: v }, parsedLabel) ? '#e3f2fd' : '#f0f0f0',
                        color: parsedLabel && matchesLabelFilter({ [k]: v }, parsedLabel) ? '#1565c0' : '#555',
                        border: parsedLabel && matchesLabelFilter({ [k]: v }, parsedLabel) ? '1px solid #90caf9' : '1px solid #ddd',
                        borderRadius: 3,
                        padding: '1px 5px',
                        whiteSpace: 'nowrap' as const,
                      }}
                    >
                      {k}: {v}
                    </span>
                  ))}
                </div>
              )}
            </td>
            {/* col 3+4+5: group/version/scope — empty */}
            <td style={{ padding: '6px 12px' }} />
            <td style={{ padding: '6px 12px' }} />
            <td style={{ padding: '6px 12px' }} />
            {/* col 6: Ready */}
            <td style={{ padding: '6px 12px', textAlign: 'center' as const }}>
              {readyChip(conditions)}
            </td>
            {/* col 7: Synced */}
            <td style={{ padding: '6px 12px', textAlign: 'center' as const }}>
              {syncedChip(conditions)}
            </td>
            {/* col 8: Age */}
            <td style={{ padding: '6px 12px', fontSize: 12, color: '#888', whiteSpace: 'nowrap' as const }}>
              {created}
            </td>
          </tr>
        );
      })}
    </>
  );
}

// ── Sort types ────────────────────────────────────────────────────────────────

type SortKey = 'kind' | 'group' | 'version' | 'scope' | 'instances';
type SortDir = 'asc' | 'desc';

// ── CRD row ───────────────────────────────────────────────────────────────────

function CRDRow({ crd, providerName, count, statusFilter, labelFilter }: {
  crd: any;
  providerName: string;
  count: { total: number; ready: number; notReady: number; synced: number; notSynced: number };
  statusFilter: StatusFilter;
  labelFilter: string;
}) {
  const history = useHistory();
  const [expanded, setExpanded] = useState(false);

  const group: string = crd.jsonData?.spec?.group ?? '';
  const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
  const kind: string = crd.jsonData?.spec?.names?.kind ?? '';
  const scope: string = crd.jsonData?.spec?.scope ?? '';
  const topVersion: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
  const hasInstances = count.total > 0;

  useEffect(() => {
    if (statusFilter !== 'all' && hasInstances) setExpanded(true);
  }, [statusFilter, hasInstances]);

  return (
    <>
      <tr
        style={{ borderBottom: '1px solid #f0f0f0', cursor: 'pointer' }}
        onClick={() => {
          if (hasInstances) setExpanded((v) => !v);
          else history.push(`${clusterPrefix()}/crossplane/providers/${providerName}/resources/${group}/${plural}`);
        }}
      >
        {/* col 1: chevron */}
        <td style={{ padding: '8px 4px 8px 12px', width: 24 }}>
          {hasInstances ? (
            <span style={{ fontSize: 11, color: '#888', userSelect: 'none' as const }}>
              {expanded ? '▾' : '▸'}
            </span>
          ) : <span style={{ display: 'inline-block', width: 12 }} />}
        </td>
        {/* col 2: Kind */}
        <td style={{ padding: '8px 12px' }}>
          <span style={{ color: xpColors.link, textDecoration: 'underline' }}>{kind}</span>
        </td>
        {/* col 3: Group */}
        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>{group}</td>
        {/* col 4: Version */}
        <td style={{ padding: '8px 12px', fontSize: 12 }}>{topVersion}</td>
        {/* col 5: Scope */}
        <td style={{ padding: '8px 12px' }}>
          <Chip label={scope} size="small"
            style={{ background: scope === 'Cluster' ? xpColors.cluster.bg : xpColors.namespaced.bg, color: '#fff', fontWeight: 600 }} />
        </td>
        {/* col 6: Ready summary */}
        <td style={{ padding: '8px 12px', textAlign: 'center' as const }}>
          {hasInstances && count.notReady > 0 ? (
            <Chip label={`${count.notReady} not ready`} size="small"
              style={{ background: xpColors.notReady.bg, color: '#fff', fontWeight: 600 }} />
          ) : hasInstances ? (
            <Chip label={`${count.ready} ready`} size="small"
              style={{ background: xpColors.ready.bg, color: '#fff', fontWeight: 600 }} />
          ) : <span style={{ color: '#bbb', fontSize: 12 }}>—</span>}
        </td>
        {/* col 7: Synced summary */}
        <td style={{ padding: '8px 12px', textAlign: 'center' as const }}>
          {hasInstances && count.notSynced > 0 ? (
            <Chip label={`${count.notSynced} not synced`} size="small"
              style={{ background: xpColors.notSynced.bg, color: '#fff', fontWeight: 600 }} />
          ) : hasInstances ? (
            <Chip label={`${count.synced} synced`} size="small"
              style={{ background: xpColors.synced.bg, color: '#fff', fontWeight: 600 }} />
          ) : <span style={{ color: '#bbb', fontSize: 12 }}>—</span>}
        </td>
        {/* col 8: Age — instance count */}
        <td style={{ padding: '8px 12px', textAlign: 'right' as const, paddingRight: 20, fontSize: 12, color: '#555' }}>
          {hasInstances ? count.total : '—'}
        </td>
      </tr>
      {expanded && <InstancesSubTable crd={crd} providerName={providerName} statusFilter={statusFilter} labelFilter={labelFilter} />}
    </>
  );
}

// ── Provider section ──────────────────────────────────────────────────────────

function ProviderSection({ provider, hideUnused, search, sortKey, sortDir, onSort, statusFilter, labelFilter }: {
  provider: any;
  hideUnused: boolean;
  search: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  statusFilter: StatusFilter;
  labelFilter: string;
}) {
  const currentRevision: string = provider.jsonData?.status?.currentRevision ?? '';
  const [crds, crdErr] = useCRDsForProvider(provider.metadata.name, currentRevision);
  const counts = useCRDInstanceCounts(
    crds ? crds.filter((c: any) => !NON_MANAGED_PLURALS.has(c.jsonData?.spec?.names?.plural ?? '')) : null
  );

  const loading = crds === null && !crdErr;
  const countsLoading = hideUnused && crds !== null && counts === null;
  const lc = search.toLowerCase();

  const visibleCrds = (() => {
    if (!crds) return [];
    let list = crds.filter((c: any) => !NON_MANAGED_PLURALS.has(c.jsonData?.spec?.names?.plural ?? ''));
    if (hideUnused && counts !== null) {
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
            {lc ? 'No types match your search.' : hideUnused ? 'No resource types with instances.' : 'No CRDs found.'}
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
              <th style={{ padding: '8px 12px', fontWeight: 600, fontSize: 13, textAlign: 'center' as const }}>Ready</th>
              <th style={{ padding: '8px 12px', fontWeight: 600, fontSize: 13, textAlign: 'center' as const }}>Synced</th>
              <SortHeader label="Age / Count" sk="instances" />
            </tr>
          </thead>
          <tbody>
            {visibleCrds.map((crd: any) => (
              <CRDRow key={crd.metadata.name} crd={crd} providerName={provider.metadata.name}
                count={counts?.get(crd.metadata.name) ?? { total: 0, ready: 0, notReady: 0, synced: 0, notSynced: 0 }} statusFilter={statusFilter} labelFilter={labelFilter} />
            ))}
          </tbody>
        </table>
      )}
    </Paper>
  );
}

// ── Main ResourceList ─────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'needs-attention', label: '⚠ Needs Attention' },
  { value: 'ready', label: 'Ready' },
  { value: 'not-ready', label: 'Not Ready' },
  { value: 'synced', label: 'Synced' },
  { value: 'not-synced', label: 'Not Synced' },
];

export default function ResourceList() {
  const history = useHistory();
  const location = useLocation();
  const [providers, providerErr] = Provider.useList();
  const [hideUnused, setHideUnused] = useState(true);
  const [search, setSearch] = useState('');
  const [labelFilter, setLabelFilter] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('kind');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Read initial filter state from URL
  const qp = parseSearch(location.search);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(
    (qp.get('status') as StatusFilter) ?? 'all'
  );
  const [providerFilter, setProviderFilter] = useState<string>(qp.get('provider') ?? 'all');

  // Sync state → URL whenever filters change
  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
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
  const hasActiveFilter = statusFilter !== 'all' || providerFilter !== 'all' || labelFilter !== '';

  return (
    <Box p={3}>
      {/* Active filter banner */}
      {hasActiveFilter && (
        <Box mb={2} display="flex" alignItems="center" gap={1} flexWrap="wrap">
          <Typography variant="caption" color="textSecondary">Filtered:</Typography>
          {statusFilter !== 'all' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: DOT[statusFilter] ?? '#9e9e9e', color: '#fff',
              borderRadius: 10, padding: '2px 10px', fontSize: 11, fontWeight: 600,
            }}>
              {STATUS_OPTIONS.find(o => o.value === statusFilter)?.label}
              <span style={{ cursor: 'pointer', opacity: 0.8, marginLeft: 2 }}
                onClick={() => setStatusFilter('all')}>×</span>
            </span>
          )}
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
          {labelFilter !== '' && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              background: '#1565c0', color: '#fff',
              borderRadius: 10, padding: '2px 10px', fontSize: 11, fontWeight: 600,
            }}>
              🏷 {labelFilter}
              <span style={{ cursor: 'pointer', opacity: 0.8, marginLeft: 2 }}
                onClick={() => setLabelFilter('')}>×</span>
            </span>
          )}
        </Box>
      )}

      {/* Toolbar */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Box>
          <Typography variant="h4">Managed Resources</Typography>
          <Typography variant="body2" color="textSecondary">
            Expand a row to see instances. Sort or filter to find what you need.
          </Typography>
        </Box>
        <Box display="flex" alignItems="center" gap={2} flexWrap="wrap">
          <TextField
            size="small"
            label="Search"
            placeholder="Kind or group…"
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <span style={{ fontSize: 13, opacity: 0.5 }}>🔍</span>
                </InputAdornment>
              ),
            }}
            style={{ minWidth: 200 }}
          />
          <TextField
            size="small"
            label="Label filter"
            placeholder="e.g. region:eu10"
            value={labelFilter}
            onChange={(e: any) => setLabelFilter(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <span style={{ fontSize: 13, opacity: 0.5 }}>🏷</span>
                </InputAdornment>
              ),
              endAdornment: labelFilter ? (
                <InputAdornment position="end">
                  <span style={{ cursor: 'pointer', fontSize: 13, opacity: 0.5 }} onClick={() => setLabelFilter('')}>×</span>
                </InputAdornment>
              ) : null,
            }}
            style={{ minWidth: 220 }}
          />
          <FormControl size="small" style={{ minWidth: 160 }}>
            <InputLabel>Status</InputLabel>
            <Select
              value={statusFilter}
              label="Status"
              onChange={(e: any) => setStatusFilter(e.target.value as StatusFilter)}
            >
              {STATUS_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
          {providerNames.length > 1 && (
            <FormControl size="small" style={{ minWidth: 160 }}>
              <InputLabel>Provider</InputLabel>
              <Select
                value={providerFilter}
                label="Provider"
                onChange={(e: any) => setProviderFilter(e.target.value)}
              >
                <MenuItem value="all">All providers</MenuItem>
                {providerNames.map((n: string) => (
                  <MenuItem key={n} value={n}>{n}</MenuItem>
                ))}
              </Select>
            </FormControl>
          )}
          <FormControlLabel
            control={
              <Checkbox checked={hideUnused} onChange={(e: any) => setHideUnused(e.target.checked)} size="small" />
            }
            label="Hide unused"
          />
        </Box>
      </Box>

      {visibleProviders.map((p: any) => (
        <ProviderSection
          key={p.metadata.name}
          provider={p}
          hideUnused={hideUnused}
          search={search}
          sortKey={sortKey}
          sortDir={sortDir}
          onSort={handleSort}
          statusFilter={statusFilter}
          labelFilter={labelFilter}
        />
      ))}
    </Box>
  );
}
