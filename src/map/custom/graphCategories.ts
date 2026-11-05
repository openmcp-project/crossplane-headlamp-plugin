import {
  blue,
  blueGrey,
  brown,
  cyan,
  deepOrange,
  deepPurple,
  green,
  grey,
  indigo,
  lightBlue,
  lightGreen,
  pink,
  purple,
  red,
  teal,
} from '@mui/material/colors';

export type CategoryMode = 'provider' | 'providerConfig' | 'flux' | 'label' | 'none';
export type CategoryKey = string | null;

export interface CategoryFields {
  providerCategory: string; // apiGroup, 'account.' prefix stripped; 'unknown' fallback
  providerConfigName: string; // spec.providerConfigRef.name ?? 'unknown'
  fluxName: string | null; // first Flux label/annotation hit, else null
  labels: Record<string, string>;
}

// Paired shades retain each category's hue and keep small text readable, including hover/focus.
export const CATEGORY_PALETTE: ReadonlyArray<{ light: string; dark: string }> = [
  { light: blue[800], dark: blue[100] },
  { light: deepOrange[900], dark: deepOrange[100] },
  { light: green[900], dark: green[100] },
  { light: deepPurple[700], dark: deepPurple[100] },
  { light: lightGreen[900], dark: lightGreen[100] },
  { light: purple[700], dark: purple[100] },
  { light: indigo[700], dark: indigo[100] },
  { light: pink[700], dark: pink[100] },
  { light: lightBlue[900], dark: lightBlue[100] },
  { light: blueGrey[700], dark: blueGrey[100] },
  { light: teal[800], dark: teal[100] },
  { light: cyan[900], dark: cyan[100] },
  { light: brown[700], dark: brown[100] },
  { light: red[800], dark: red[100] },
];

export const MISSING_CATEGORY_SWATCH = { light: grey[700], dark: grey[300] };

// Label-key prefixes that are infrastructure noise, excluded from the
// common-label category mode so user labels aren't drowned out.
const SYSTEM_LABEL_PREFIXES: readonly string[] = [
  'app.kubernetes.io/',
  'kubernetes.io/',
  'helm.sh/',
  'crossplane.io/',
  'pod-template-hash',
];

// Read Flux directly: detectExternalManager prioritizes Helm and would classify
// a Flux HelmRelease carrying helm.sh/chart as Helm.
const FLUX_KEYS = ['kustomize.toolkit.fluxcd.io/name', 'helm.toolkit.fluxcd.io/name'] as const;

export function categoryFieldsFromKubeObject(ko: any): CategoryFields {
  const item = ko?.jsonData ?? ko ?? {};
  const labels: Record<string, string> = item?.metadata?.labels ?? {};
  const annotations: Record<string, string> = item?.metadata?.annotations ?? {};
  const fluxName = FLUX_KEYS.map(k => labels[k] ?? annotations[k]).find(Boolean) ?? null;
  return {
    providerCategory: providerCategoryFromApiVersion(item?.apiVersion ?? ''),
    providerConfigName: item?.spec?.providerConfigRef?.name ?? 'unknown',
    fluxName,
    labels,
  };
}

export function isSystemLabel(key: string): boolean {
  return SYSTEM_LABEL_PREFIXES.some(p => (p.endsWith('/') ? key.startsWith(p) : key === p));
}

/** apiGroup of an apiVersion, minus a leading `account.`; 'unknown' when absent. */
export function providerCategoryFromApiVersion(apiVersion: string): string {
  const domain = apiVersion?.split('/')[0] || '';
  return domain.replace(/^account\./, '') || 'unknown';
}

/** null marks a missing value; '' means categorization is disabled. */
export function categoryKeyOf(
  fields: CategoryFields,
  mode: CategoryMode,
  labelKey?: string
): CategoryKey {
  switch (mode) {
    case 'provider':
      return fields.providerCategory;
    case 'providerConfig':
      return fields.providerConfigName;
    case 'flux':
      return fields.fluxName || null;
    case 'label':
      if (!labelKey || !Object.prototype.hasOwnProperty.call(fields.labels, labelKey)) return null;
      return fields.labels[labelKey] || null;
    default:
      return '';
  }
}

export function categoryLabelOf(key: CategoryKey): string {
  return key ?? 'Not set';
}

/** Assigns colors in dropdown sort order; missing Flux/label values stay grey. */
export function generateCategoryColorMap(
  fields: CategoryFields[],
  mode: CategoryMode,
  colorMode: 'light' | 'dark',
  labelKey?: string
): Map<CategoryKey, string> {
  const map = new Map<CategoryKey, string>();
  if (mode === 'none') return map;

  const keys = new Set<string>();
  for (const f of fields) {
    const key = categoryKeyOf(f, mode, labelKey);
    if (key === null) {
      map.set(null, MISSING_CATEGORY_SWATCH[colorMode]);
    } else if (key) {
      keys.add(key);
    }
  }

  let paletteIndex = { provider: 0, providerConfig: 1, flux: 2, label: 3 }[mode];
  for (const key of [...keys].sort()) {
    map.set(key, CATEGORY_PALETTE[paletteIndex][colorMode]);
    // Step 5 visits all 14 colors before repeating; each mode's first three are disjoint.
    paletteIndex = (paletteIndex + 5) % CATEGORY_PALETTE.length;
  }
  return map;
}

/** Union of non-system label keys across nodes, sorted by frequency then name. */
export function collectLabelKeys(fields: CategoryFields[]): string[] {
  const counts = new Map<string, number>();
  for (const f of fields) {
    for (const k of Object.keys(f.labels ?? {})) {
      if (isSystemLabel(k)) continue;
      counts.set(k, (counts.get(k) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([k]) => k);
}
