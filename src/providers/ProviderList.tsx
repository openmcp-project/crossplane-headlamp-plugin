import { useEffect, useState } from 'react';
import { useHistory, useLocation } from 'react-router-dom';
import { Provider } from '../common/Resources';
import { clusterPrefix } from '../helpers';

const {
  Typography, Box, Chip, CircularProgress, TextField, InputAdornment,
  FormControl, InputLabel, Select, MenuItem,
} = (window as any).pluginLib?.MuiCore ?? {};

// ── URL helper ────────────────────────────────────────────────────────────────

function parseSearch(search: string): URLSearchParams {
  return new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
}

// ── Types ─────────────────────────────────────────────────────────────────────

type ProviderStatusFilter = 'all' | 'healthy' | 'unhealthy';
type SortKey = 'name' | 'version' | 'installed' | 'healthy' | 'ready' | 'age';
type SortDir = 'asc' | 'desc';

// ── Condition chip ────────────────────────────────────────────────────────────

function conditionChip(conditions: any[], type: string) {
  const cond = conditions?.find((c: any) => c.type === type);
  if (!cond) return <Chip label="Unknown" size="small" />;
  const ok = cond.status === 'True';
  return (
    <Chip label={ok ? type : `Not ${type}`} size="small"
      style={{ background: ok ? '#4caf50' : '#f44336', color: '#fff', fontWeight: 600 }} />
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: ProviderStatusFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'healthy', label: 'Healthy' },
  { value: 'unhealthy', label: 'Unhealthy' },
];

export default function ProviderList() {
  const history = useHistory();
  const location = useLocation();
  const [providers, error] = Provider.useList();

  const qp = parseSearch(location.search);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<ProviderStatusFilter>(
    (qp.get('status') as ProviderStatusFilter) ?? 'all'
  );
  const [sortKey, setSortKey] = useState<SortKey>('name');
  const [sortDir, setSortDir] = useState<SortDir>('asc');

  // Sync state → URL
  useEffect(() => {
    const params = new URLSearchParams();
    if (statusFilter !== 'all') params.set('status', statusFilter);
    const newSearch = params.toString() ? `?${params.toString()}` : '';
    if (location.search !== newSearch) {
      history.replace({ ...location, search: newSearch });
    }
  }, [statusFilter]);

  function handleSort(key: SortKey) {
    if (sortKey === key) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortKey(key); setSortDir('asc'); }
  }

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
        <Typography color="error">Failed to load providers: {String(error)}</Typography>
      </Box>
    );
  }

  const lc = search.toLowerCase();

  const filtered = (providers ?? []).filter((p: any) => {
    const conditions: any[] = p.jsonData?.status?.conditions ?? [];
    const isHealthy = conditions.find((c: any) => c.type === 'Healthy')?.status === 'True';
    if (statusFilter === 'healthy' && !isHealthy) return false;
    if (statusFilter === 'unhealthy' && isHealthy) return false;
    if (lc) {
      const name: string = p.metadata?.name ?? '';
      const pkg: string = p.jsonData?.spec?.package ?? '';
      return name.toLowerCase().includes(lc) || pkg.toLowerCase().includes(lc);
    }
    return true;
  });

  const sorted = [...filtered].sort((a: any, b: any) => {
    let va: any, vb: any;
    const condVal = (p: any, type: string) =>
      p.jsonData?.status?.conditions?.find((c: any) => c.type === type)?.status ?? '';
    if (sortKey === 'name') { va = a.metadata?.name ?? ''; vb = b.metadata?.name ?? ''; }
    else if (sortKey === 'version') {
      va = a.jsonData?.status?.atPkg ?? a.jsonData?.status?.currentRevision ?? '';
      vb = b.jsonData?.status?.atPkg ?? b.jsonData?.status?.currentRevision ?? '';
    }
    else if (sortKey === 'installed') { va = condVal(a, 'Installed'); vb = condVal(b, 'Installed'); }
    else if (sortKey === 'healthy') { va = condVal(a, 'Healthy'); vb = condVal(b, 'Healthy'); }
    else if (sortKey === 'ready') { va = condVal(a, 'Ready'); vb = condVal(b, 'Ready'); }
    else if (sortKey === 'age') {
      va = a.metadata?.creationTimestamp ?? '';
      vb = b.metadata?.creationTimestamp ?? '';
    }
    if (va < vb) return sortDir === 'asc' ? -1 : 1;
    if (va > vb) return sortDir === 'asc' ? 1 : -1;
    return 0;
  });

  const hasActiveFilter = statusFilter !== 'all' || !!lc;

  const SortHeader = ({ label, sk, align = 'left' }: { label: string; sk: SortKey; align?: string }) => (
    <th onClick={() => handleSort(sk)}
      style={{
        padding: '8px 12px', fontWeight: 600, cursor: 'pointer',
        userSelect: 'none' as const, textAlign: align as any, whiteSpace: 'nowrap' as const,
      }}>
      {label}
      {sortKey === sk && <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>{sortDir === 'asc' ? '▲' : '▼'}</span>}
    </th>
  );

  return (
    <Box p={3}>
      {/* Active filter banner */}
      {hasActiveFilter && (
        <Box mb={2} p={1.5} style={{ background: '#fff3e0', borderRadius: 6, border: '1px solid #ffb74d' }}
          display="flex" alignItems="center" justifyContent="space-between">
          <Typography variant="body2">
            <strong>Filtered view:</strong>
            {statusFilter !== 'all' && ` Status = ${STATUS_OPTIONS.find(o => o.value === statusFilter)?.label}`}
            {lc && ` · Search = "${search}"`}
          </Typography>
          <span
            style={{ cursor: 'pointer', color: '#1976d2', fontSize: 13, fontWeight: 600 }}
            onClick={() => { setStatusFilter('all'); setSearch(''); }}
          >
            Clear filter ×
          </span>
        </Box>
      )}

      {/* Toolbar */}
      <Box display="flex" alignItems="center" justifyContent="space-between" mb={2} flexWrap="wrap" gap={1}>
        <Typography variant="h4">Crossplane Providers</Typography>
        <Box display="flex" alignItems="center" gap={2}>
          <TextField
            size="small"
            placeholder="Search name or package…"
            value={search}
            onChange={(e: any) => setSearch(e.target.value)}
            InputProps={{
              startAdornment: (
                <InputAdornment position="start">
                  <span style={{ fontSize: 13, opacity: 0.5 }}>🔍</span>
                </InputAdornment>
              ),
            }}
            style={{ minWidth: 220 }}
          />
          <FormControl size="small" style={{ minWidth: 150 }}>
            <InputLabel>Health</InputLabel>
            <Select value={statusFilter} label="Health"
              onChange={(e: any) => setStatusFilter(e.target.value as ProviderStatusFilter)}>
              {STATUS_OPTIONS.map((o) => (
                <MenuItem key={o.value} value={o.value}>{o.label}</MenuItem>
              ))}
            </Select>
          </FormControl>
        </Box>
      </Box>

      {sorted.length === 0 ? (
        <Typography color="textSecondary">
          {hasActiveFilter ? 'No providers match the current filter.' : 'No providers installed.'}
        </Typography>
      ) : (
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '2px solid #e0e0e0', textAlign: 'left', background: '#fafafa' }}>
              <SortHeader label="Name" sk="name" />
              <SortHeader label="Package" sk="name" />
              <SortHeader label="Version" sk="version" />
              <SortHeader label="Installed" sk="installed" />
              <SortHeader label="Healthy" sk="healthy" />
              <SortHeader label="Ready" sk="ready" />
              <SortHeader label="Age" sk="age" />
            </tr>
          </thead>
          <tbody>
            {sorted.map((p: any) => {
              const conditions: any[] = p.jsonData?.status?.conditions ?? [];
              const version = p.jsonData?.status?.atPkg ?? p.jsonData?.status?.currentRevision ?? '—';
              const created = p.metadata?.creationTimestamp
                ? new Date(p.metadata.creationTimestamp).toLocaleDateString()
                : '—';
              const isHealthy = conditions.find((c: any) => c.type === 'Healthy')?.status === 'True';
              const isReady = conditions.find((c: any) => c.type === 'Ready')?.status === 'True';
              const rowBad = !isHealthy || !isReady;
              return (
                <tr key={p.metadata.name}
                  style={{
                    borderBottom: '1px solid #f0f0f0', cursor: 'pointer',
                    background: rowBad ? 'rgba(244,67,54,0.03)' : 'transparent',
                  }}
                  onClick={() => history.push(`${clusterPrefix()}/crossplane/providers/${p.metadata.name}`)}
                >
                  <td style={{ padding: '8px 12px' }}>
                    <span style={{ color: '#1976d2', textDecoration: 'underline' }}>{p.metadata.name}</span>
                  </td>
                  <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12, maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const }}>
                    {p.jsonData?.spec?.package ?? '—'}
                  </td>
                  <td style={{ padding: '8px 12px' }}>{version}</td>
                  <td style={{ padding: '8px 12px' }}>{conditionChip(conditions, 'Installed')}</td>
                  <td style={{ padding: '8px 12px' }}>{conditionChip(conditions, 'Healthy')}</td>
                  <td style={{ padding: '8px 12px' }}>{conditionChip(conditions, 'Ready')}</td>
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
