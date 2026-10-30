import { describe, expect, it } from 'vitest';
import {
  CATEGORY_PALETTE,
  CategoryFields,
  categoryFieldsFromKubeObject,
  categoryKeyOf,
  collectLabelKeys,
  generateCategoryColorMap,
  isSystemLabel,
  MISSING_CATEGORY_SWATCH,
  providerCategoryFromApiVersion,
} from './graphCategories';

function field(overrides: Partial<CategoryFields> = {}): CategoryFields {
  return {
    providerCategory: 'unknown',
    providerConfigName: 'unknown',
    fluxName: null,
    labels: {},
    ...overrides,
  };
}

describe('categoryFieldsFromKubeObject', () => {
  it.each(['plain', 'wrapped'])('extracts categories from a %s resource', shape => {
    const resource = {
      apiVersion: 'account.btp.sap.crossplane.io/v1alpha1',
      metadata: {
        labels: { team: 'platform', 'kustomize.toolkit.fluxcd.io/name': 'from-label' },
        annotations: { 'kustomize.toolkit.fluxcd.io/name': 'from-annotation' },
      },
      spec: { providerConfigRef: { name: 'my-account' } },
    };
    expect(
      categoryFieldsFromKubeObject(shape === 'wrapped' ? { jsonData: resource } : resource)
    ).toEqual({
      providerCategory: 'btp.sap.crossplane.io',
      providerConfigName: 'my-account',
      fluxName: 'from-label',
      labels: resource.metadata.labels,
    });
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

describe('providerCategoryFromApiVersion', () => {
  it('takes the apiGroup before the slash', () => {
    expect(providerCategoryFromApiVersion('iam.aws.crossplane.io/v1beta1')).toBe(
      'iam.aws.crossplane.io'
    );
  });

  it('strips a leading account. prefix', () => {
    expect(providerCategoryFromApiVersion('account.btp.sap.crossplane.io/v1alpha1')).toBe(
      'btp.sap.crossplane.io'
    );
  });

  it('falls back to unknown for empty input', () => {
    expect(providerCategoryFromApiVersion('')).toBe('unknown');
  });
});

describe('categoryKeyOf', () => {
  const f = field({
    providerCategory: 'aws',
    providerConfigName: 'pc-a',
    fluxName: 'ks-1',
    labels: { team: 'blue', '': '' },
  });

  it('returns the field matching the mode', () => {
    expect(categoryKeyOf(f, 'provider')).toBe('aws');
    expect(categoryKeyOf(f, 'providerConfig')).toBe('pc-a');
    expect(categoryKeyOf(f, 'flux')).toBe('ks-1');
    expect(categoryKeyOf(f, 'label', 'team')).toBe('blue');
  });

  it('returns empty string for mode none', () => {
    expect(categoryKeyOf(f, 'none')).toBe('');
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

describe.each(['light', 'dark'] as const)('generateCategoryColorMap (%s)', colorMode => {
  it('returns an empty map for mode none', () => {
    const map = generateCategoryColorMap([field({ providerCategory: 'aws' })], 'none', colorMode);
    expect(map.size).toBe(0);
  });

  it('assigns distinct colors in dropdown sort order', () => {
    const fields = [
      field({ providerCategory: 'b' }),
      field({ providerCategory: 'a' }),
      field({ providerCategory: 'b' }),
    ];
    const map = generateCategoryColorMap(fields, 'provider', colorMode);
    expect([...map.keys()]).toEqual(['a', 'b']);
    expect(new Set(map.values()).size).toBe(2);
  });

  it.each(['provider', 'providerConfig', 'flux', 'label'] as const)(
    'uses every color before repeating and stays stable for %s',
    mode => {
      const fields = Array.from({ length: CATEGORY_PALETTE.length + 1 }, (_, i) =>
        field({
          providerCategory: `p${i}`,
          providerConfigName: `pc${i}`,
          fluxName: `flux${i}`,
          labels: { team: `team${i}` },
        })
      );
      const map = generateCategoryColorMap(fields, mode, colorMode, 'team');
      const colors = [...map.values()];
      expect(new Set(colors.slice(0, CATEGORY_PALETTE.length))).toEqual(
        new Set(CATEGORY_PALETTE.map(color => color[colorMode]))
      );
      expect(colors[CATEGORY_PALETTE.length]).toBe(colors[0]);
      expect(generateCategoryColorMap([...fields].reverse(), mode, colorMode, 'team')).toEqual(map);
    }
  );

  it('uses different first three colors across the four modes', () => {
    const fields = Array.from({ length: 3 }, (_, i) =>
      field({
        providerCategory: `p${i}`,
        providerConfigName: `pc${i}`,
        fluxName: `flux${i}`,
        labels: { team: `team${i}` },
      })
    );
    const colors = (['provider', 'providerConfig', 'flux', 'label'] as const).flatMap(mode => [
      ...generateCategoryColorMap(fields, mode, colorMode, 'team').values(),
    ]);
    expect(new Set(colors).size).toBe(12);
  });

  it('uses the same color sequence for different label keys', () => {
    const fields = [
      field({ labels: { team: 'platform', environment: 'dev' } }),
      field({ labels: { team: 'product', environment: 'prod' } }),
    ];
    expect([...generateCategoryColorMap(fields, 'label', colorMode, 'team').values()]).toEqual([
      ...generateCategoryColorMap(fields, 'label', colorMode, 'environment').values(),
    ]);
  });

  it.each(['flux', 'label'] as const)(
    'keeps missing values grey without consuming a palette color in %s mode',
    mode => {
      const fields = [field({ fluxName: 'ks-1', labels: { team: 'platform' } })];
      const map = generateCategoryColorMap([field(), ...fields], mode, colorMode, 'team');
      expect(map.get(null)).toBe(MISSING_CATEGORY_SWATCH[colorMode]);
      map.delete(null);
      expect(map).toEqual(generateCategoryColorMap(fields, mode, colorMode, 'team'));
    }
  );

  it.each(['flux', 'label'] as const)(
    'keeps the literal default value separate from missing metadata in %s mode',
    mode => {
      const map = generateCategoryColorMap(
        [field({ fluxName: 'default', labels: { team: 'default' } }), field()],
        mode,
        colorMode,
        'team'
      );
      expect([...map.keys()]).toEqual([null, 'default']);
      expect(map.get(null)).toBe(MISSING_CATEGORY_SWATCH[colorMode]);
      expect(map.get('default')).not.toBe(MISSING_CATEGORY_SWATCH[colorMode]);
    }
  );
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
