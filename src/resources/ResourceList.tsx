import { useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { Provider } from '../common/Resources';
import { useCRDsForProvider, getApiProxy, clusterPrefix, NON_MANAGED_PLURALS } from '../helpers';

const {
  Typography, Box, Chip, CircularProgress, Paper,
  FormControlLabel, Checkbox, TextField, InputAdornment, MenuItem, Select, FormControl, InputLabel,
} = (window as any).pluginLib?.MuiCore ?? {};

// ── URL query helpers ─────────────────────────────────────────────────────────

function parseSearch(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

// ── Status filter types ───────────────────────────────────────────────────────

type StatusFilter = 'all' | 'ready' | 'not-ready' | 'synced' | 'not-synced';

function matchesStatusFilter(item: any, filter: StatusFilter): boolean {
  if (filter === 'all') return true;
  const conditions: any[] = item.status?.conditions ?? [];
  const readyStatus = conditions.find((c: any) => c.type === 'Ready')?.status;
  const syncedStatus = conditions.find((c: any) => c.type === 'Synced')?.status;
  if (filter === 'ready') return readyStatus === 'True';
  if (filter === 'not-ready') return readyStatus !== 'True';
  if (filter === 'synced') return syncedStatus === 'True';
  if (filter === 'not-synced') return syncedStatus !== 'True';
  return true;
}

// ── Instance fetching ─────────────────────────────────────────────────────────

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

function useCRDInstanceCounts(crds: any[] | null): Map<string, number> | null {
  const [counts, setCounts] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    if (!crds) { setCounts(null); return; }
    if (crds.length === 0) { setCounts(new Map()); return; }
    let cancelled = false;
    const result = new Map<string, number>();
    const fetches = crds.map((crd: any) => {
      const group: string = crd.jsonData?.spec?.group ?? '';
      const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
      const ver: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
      if (!group || !plural) { result.set(crd.metadata.name, 0); return Promise.resolve(); }
      return getApiProxy()
        .request(`/apis/${group}/${ver}/${plural}`, { isJSON: true })
        .then((res: any) => { result.set(crd.metadata.name, res?.items?.length ?? 0); })
        .catch(() => { result.set(crd.metadata.name, 0); });
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
    style={{ background: ok ? '#4caf50' : '#f44336', color: '#fff', fontWeight: 600 }} />;
}

function syncedChip(conditions: any[]) {
  const cond = conditions?.find((c: any) => c.type === 'Synced');
  if (!cond) return <Chip label="—" size="small" />;
  const ok = cond.status === 'True';
  return <Chip label={ok ? 'Synced' : 'Not Synced'} size="small"
    style={{ background: ok ? '#1976d2' : '#ff9800', color: '#fff', fontWeight: 600 }} />;
}

// ── Expanded instances sub-table ──────────────────────────────────────────────

function InstancesSubTable({ crd, providerName, statusFilter }: {
  crd: any;
  providerName: string;
  statusFilter: StatusFilter;
}) {
  const history = useHistory();
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
          {statusFilter !== 'all' ? 'No instances match the current filter.' : 'No instances found.'}
        </Typography>
      </Box>
    );
  }

  return (
    <Box style={{ background: '#f9f9f9', borderTop: '1px solid #e8e8e8' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse' }}>
        <thead>
          <tr style={{ borderBottom: '1px solid #e0e0e0', background: '#f0f0f0' }}>
            <th style={{ padding: '6px 12px 6px 40px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: '#555' }}>Name</th>
            {isNamespaced && <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: '#555' }}>Namespace</th>}
            <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: '#555' }}>Ready</th>
            <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: '#555' }}>Synced</th>
            <th style={{ padding: '6px 12px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: '#555' }}>Age</th>
          </tr>
        </thead>
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
            const detailUrl = isNamespaced
              ? `${clusterPrefix()}/crossplane/providers/${providerName}/resources/${group}/${plural}/${ns}/${instName}`
              : `${clusterPrefix()}/crossplane/providers/${providerName}/resources/${group}/${plural}/${instName}`;
            return (
              <tr key={`${ns}/${instName}`}
                style={{
                  borderBottom: '1px solid #ebebeb', cursor: 'pointer',
                  background: (!isReady || !isSynced) ? 'rgba(244,67,54,0.04)' : 'transparent',
                }}
                onClick={() => history.push(detailUrl)}
              >
                <td style={{ padding: '6px 12px 6px 40px' }}>
                  <span style={{ color: '#1976d2', textDecoration: 'underline', fontSize: 13 }}>{instName}</span>
                </td>
                {isNamespaced && <td style={{ padding: '6px 12px', fontSize: 12, color: '#555' }}>{ns}</td>}
                <td style={{ padding: '6px 12px' }}>{readyChip(conditions)}</td>
                <td style={{ padding: '6px 12px' }}>{syncedChip(conditions)}</td>
                <td style={{ padding: '6px 12px', fontSize: 12, color: '#888' }}>{created}</td>
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
  count: number;
  statusFilter: StatusFilter;
}) {
  const history = useHistory();
  const [expanded, setExpanded] = useState(false);

  const group: string = crd.jsonData?.spec?.group ?? '';
  const plural: string = crd.jsonData?.spec?.names?.plural ?? '';
  const kind: string = crd.jsonData?.spec?.names?.kind ?? '';
  const scope: string = crd.jsonData?.spec?.scope ?? '';
  const topVersion: string = crd.jsonData?.spec?.versions?.[0]?.name ?? 'v1alpha1';
  const hasInstances = count > 0;

  // Auto-expand if a status filter is active and there are instances
  useEffect(() => {
    if (statusFilter !== 'all' && hasInstances) setExpanded(true);
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
          <span style={{ color: '#1976d2', textDecoration: 'underline' }}>{kind}</span>
        </td>
        <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>{group}</td>
        <td style={{ padding: '8px 12px', fontSize: 12 }}>{topVersion}</td>
        <td style={{ padding: '8px 12px' }}>
          <Chip label={scope} size="small"
            style={{ background: scope === 'Cluster' ? '#1976d2' : '#7b1fa2', color: '#fff', fontWeight: 600 }} />
        </td>
        <td style={{ padding: '8px 12px', fontWeight: 600, textAlign: 'right' as const, paddingRight: 20 }}>
          {count}
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

function ProviderSection({ provider, hideUnused, search, sortKey, sortDir, onSort, statusFilter }: {
  provider: any;
  hideUnused: boolean;
  search: string;
  sortKey: SortKey;
  sortDir: SortDir;
  onSort: (key: SortKey) => void;
  statusFilter: StatusFilter;
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
    // Exclude infrastructure CRDs that have no Ready/Synced conditions
    let list = crds.filter((c: any) => !NON_MANAGED_PLURALS.has(c.jsonData?.spec?.names?.plural ?? ''));
    if (hideUnused && counts !== null) {
      list = list.filter((c: any) => (counts.get(c.metadata.name) ?? 0) > 0);
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
      else if (sortKey === 'instances') { va = counts?.get(a.metadata.name) ?? 0; vb = counts?.get(b.metadata.name) ?? 0; }
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
              <SortHeader label="Instances" sk="instances" />
            </tr>
          </thead>
          <tbody>
            {visibleCrds.map((crd: any) => (
              <CRDRow key={crd.metadata.name} crd={crd} providerName={provider.metadata.name}
                count={counts?.get(crd.metadata.name) ?? 0} statusFilter={statusFilter} />
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
  const hasActiveFilter = statusFilter !== 'all' || providerFilter !== 'all';

  return (
    <Box p={3}>
      {/* Active filter banner */}
      {hasActiveFilter && (
        <Box mb={2} p={1.5} style={{ background: '#fff3e0', borderRadius: 6, border: '1px solid #ffb74d' }}
          display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="body2">
            <strong>Filtered view:</strong>
            {providerFilter !== 'all' && ` Provider = ${providerFilter}`}
            {statusFilter !== 'all' && ` · Status = ${STATUS_OPTIONS.find(o => o.value === statusFilter)?.label}`}
            {statusFilter !== 'all' && ' — rows auto-expanded'}
          </Typography>
          <span
            style={{ cursor: 'pointer', color: '#1976d2', fontSize: 13, fontWeight: 600 }}
            onClick={() => { setStatusFilter('all'); setProviderFilter('all'); }}
          >
            Clear filter ×
          </span>
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
            placeholder="Search kind or group…"
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
        />
      ))}
    </Box>
  );
}
