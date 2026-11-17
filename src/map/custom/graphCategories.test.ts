import { describe, expect, it } from 'vitest';
import {
  assignCategoryColors,
  CATEGORY_PALETTE,
  CategoryFields,
  categoryFieldsFromKubeObject,
  categoryKeyOf,
  collectLabelKeys,
  isSystemLabel,
  MISSING_CATEGORY_SWATCH,
} from './graphCategories';

function field(overrides: Partial<CategoryFields> = {}): CategoryFields {
  return {
    fluxName: null,
    kind: null,
    labels: {},
    ...overrides,
  };
}

describe('categoryFieldsFromKubeObject', () => {
  it.each(['plain', 'wrapped'])('extracts categories from a %s resource', shape => {
    const resource = {
      apiVersion: 'account.btp.sap.crossplane.io/v1alpha1',
      kind: 'Subaccount',
      metadata: {
        labels: { team: 'platform', 'kustomize.toolkit.fluxcd.io/name': 'from-label' },
        annotations: { 'kustomize.toolkit.fluxcd.io/name': 'from-annotation' },
      },
    };
    expect(
      categoryFieldsFromKubeObject(shape === 'wrapped' ? { jsonData: resource } : resource)
    ).toEqual({
      fluxName: 'from-label',
      kind: 'Subaccount',
      labels: resource.metadata.labels,
    });
  });

  it('reads the kind from an unwrapped resource _kind fallback', () => {
    expect(categoryFieldsFromKubeObject({ _kind: 'ServiceInstance' }).kind).toBe('ServiceInstance');
  });

  it.each(['kustomize.toolkit.fluxcd.io/name', 'helm.toolkit.fluxcd.io/name'])(
    'reads the Flux name from the %s annotation',
    key => {
      const fields = categoryFieldsFromKubeObject({
        metadata: { annotations: { [key]: 'default' } },
      });
      expect(fields.fluxName).toBe('default');
      expect(categoryKeyOf(fields, 'flux')).toBe('default');
    }
  );

  it('keeps Flux ownership when Helm labels are also present', () => {
    const fields = categoryFieldsFromKubeObject({
      metadata: {
        labels: { 'helm.sh/chart': 'chart-1.0', 'helm.toolkit.fluxcd.io/name': 'release' },
      },
    });
    expect(fields.fluxName).toBe('release');
  });

  it('preserves absent Flux metadata as null', () => {
    expect(categoryFieldsFromKubeObject({})).toEqual(field());
  });
});

describe('categoryKeyOf', () => {
  const f = field({
    fluxName: 'ks-1',
    labels: { team: 'blue', '': '' },
  });

  it('returns the field matching the mode', () => {
    expect(categoryKeyOf(f, 'flux')).toBe('ks-1');
    expect(categoryKeyOf(f, 'label', 'team')).toBe('blue');
  });

  it('buckets empty and missing label values under null', () => {
    expect(categoryKeyOf(f, 'label', 'missing')).toBeNull();
    expect(categoryKeyOf(f, 'label', '')).toBeNull();
    expect(categoryKeyOf(field({ labels: { team: '' } }), 'label', 'team')).toBeNull();
  });

  it('buckets empty and missing Flux names under null', () => {
    expect(categoryKeyOf(field({ fluxName: '' }), 'flux')).toBeNull();
    expect(categoryKeyOf(field(), 'flux')).toBeNull();
  });

  it.each(['constructor', 'toString', 'hasOwnProperty'])('only reads an own %s label', key => {
    expect(categoryKeyOf(field({ labels: { [key]: 'billing' } }), 'label', key)).toBe('billing');
    expect(categoryKeyOf(field(), 'label', key)).toBeNull();
  });
});

describe.each(['light', 'dark'] as const)('assignCategoryColors (%s)', colorMode => {
  it('colors distinct keys in sorted order and keeps null grey without a palette color', () => {
    const map = assignCategoryColors(['b', null, 'a', 'b'], colorMode);
    expect([...map.keys()]).toEqual([null, 'a', 'b']);
    expect(map.get(null)).toBe(MISSING_CATEGORY_SWATCH[colorMode]);
    expect(map.get('a')).toBe(CATEGORY_PALETTE[0][colorMode]);
    expect(map.get('b')).toBe(CATEGORY_PALETTE[1][colorMode]);
  });

  it('uses every color before repeating and stays stable when keys change order', () => {
    const keys = Array.from({ length: CATEGORY_PALETTE.length + 1 }, (_, i) => `kind${i}`);
    const map = assignCategoryColors(keys, colorMode);
    const colors = [...map.values()];
    expect(colors.slice(0, CATEGORY_PALETTE.length)).toEqual(
      CATEGORY_PALETTE.map(color => color[colorMode])
    );
    expect(colors[CATEGORY_PALETTE.length]).toBe(colors[0]);
    expect(assignCategoryColors([...keys].reverse(), colorMode)).toEqual(map);
  });

  it('keeps a literal default value separate from missing metadata', () => {
    const map = assignCategoryColors(['default', null], colorMode);
    expect([...map.keys()]).toEqual([null, 'default']);
    expect(map.get(null)).toBe(MISSING_CATEGORY_SWATCH[colorMode]);
    expect(map.get('default')).toBe(CATEGORY_PALETTE[0][colorMode]);
  });
});

describe('isSystemLabel', () => {
  it('flags infrastructure label prefixes', () => {
    expect(isSystemLabel('app.kubernetes.io/name')).toBe(true);
    expect(isSystemLabel('kubernetes.io/foo')).toBe(true);
    expect(isSystemLabel('crossplane.io/claim')).toBe(true);
    expect(isSystemLabel('pod-template-hash')).toBe(true);
  });

  it('keeps user labels', () => {
    expect(isSystemLabel('team')).toBe(false);
    expect(isSystemLabel('env')).toBe(false);
  });
});

describe('collectLabelKeys', () => {
  it('filters system labels and sorts by frequency then name', () => {
    const fields = [
      field({ labels: { team: 'a', env: 'prod', 'app.kubernetes.io/name': 'x' } }),
      field({ labels: { team: 'b' } }),
      field({ labels: { env: 'dev', zone: 'eu' } }),
    ];
    // team:2, env:2, zone:1 → by count desc then name asc: env, team, zone.
    expect(collectLabelKeys(fields)).toEqual(['env', 'team', 'zone']);
  });

  it('returns an empty list when only system labels are present', () => {
    expect(collectLabelKeys([field({ labels: { 'kubernetes.io/x': '1' } })])).toEqual([]);
  });
});
