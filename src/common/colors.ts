// Crossplane state color tokens — single source of truth for all health/status colors

export const xpColors = {
  // Ready condition
  ready:      { bg: '#2e7d32', text: '#fff', faint: 'rgba(46,125,50,0.08)'  },
  notReady:   { bg: '#c62828', text: '#fff', faint: 'rgba(198,40,40,0.06)'  },

  // Synced condition
  synced:     { bg: '#1565c0', text: '#fff', faint: 'rgba(21,101,192,0.08)' },
  notSynced:  { bg: '#e65100', text: '#fff', faint: 'rgba(230,81,0,0.08)'   },

  // Combined / provider-level health
  healthy:    { bg: '#2e7d32', text: '#fff', faint: 'rgba(46,125,50,0.08)'  },
  degraded:   { bg: '#c62828', text: '#fff', faint: 'rgba(198,40,40,0.06)'  },
  warning:    { bg: '#e65100', text: '#fff', faint: 'rgba(230,81,0,0.08)'   },
  unknown:    { bg: '#616161', text: '#fff', faint: 'rgba(97,97,97,0.08)'   },

  // Scope chips
  cluster:    { bg: '#1565c0', text: '#fff' },
  namespaced: { bg: '#6a1b9a', text: '#fff' },

  // Link / interactive text
  link: '#1565c0',
};

// Derive a provider's border/dot color from its conditions
export function providerHealthColor(conditions: any[]): string {
  const ready     = conditions.find((c: any) => c.type === 'Ready');
  const healthy   = conditions.find((c: any) => c.type === 'Healthy');
  const installed = conditions.find((c: any) => c.type === 'Installed');
  const allOk = ready?.status === 'True' && healthy?.status === 'True' && installed?.status === 'True';
  const anyErr = ready?.status === 'False' || healthy?.status === 'False' || installed?.status === 'False';
  if (allOk) return xpColors.healthy.bg;
  if (anyErr) return xpColors.degraded.bg;
  return xpColors.warning.bg;
}

// Derive a resource's combined health color (ready+synced)
export function resourceHealthColor(conditions: any[]): string {
  const ready  = conditions.find((c: any) => c.type === 'Ready');
  const synced = conditions.find((c: any) => c.type === 'Synced');
  if (ready?.status === 'False' || synced?.status === 'False') return xpColors.degraded.bg;
  if (ready?.status === 'True'  && synced?.status === 'True')  return xpColors.healthy.bg;
  return xpColors.warning.bg;
}

// Dot swatch for use inside dropdown MenuItems
export const DOT: Record<string, string> = {
  'all':       'transparent',
  'ready':     xpColors.ready.bg,
  'not-ready': xpColors.notReady.bg,
  'synced':    xpColors.synced.bg,
  'not-synced':xpColors.notSynced.bg,
  'healthy':   xpColors.healthy.bg,
  'unhealthy': xpColors.degraded.bg,
};
