import { describe, expect, it } from 'vitest';
import { resolveItemRefs } from './references';

const targets = new Map([
  ['manager::ServiceManager', 'sm-target-id'],
  ['account::Subaccount', 'account-target-id'],
  ['space::Space', 'space-target-id'],
  ['other-space::Space', 'other-space-target-id'],
  ['environment::KymaEnvironment', 'environment-target-id'],
  ['environment::ProviderConfig', 'provider-config-target-id'],
  ['aicore::standard::Entitlement', 'entitlement-target-id'],
]);
const resolve = (name: string | undefined, kind: string | undefined) =>
  targets.get(`${name}::${kind}`);

describe('ServiceInstance reference resolution', () => {
  it('keeps the ServiceManager parent without a matching Entitlement', () => {
    const item = {
      spec: {
        forProvider: {
          serviceManagerRef: { name: 'manager' },
          offeringName: 'unmatched',
          planName: 'standard',
        },
      },
    };
    expect(resolveItemRefs(item, 'ServiceInstance', resolve)).toEqual({
      parentId: 'sm-target-id',
      extraIds: [],
    });
  });

  it('keeps the ServiceManager priority and adds only the synthetic Entitlement association', () => {
    const item = {
      spec: {
        forProvider: {
          serviceManagerRef: { name: 'manager' },
          subaccountRef: { name: 'account' },
          offeringName: 'aicore',
          planName: 'standard',
        },
      },
    };
    expect(resolveItemRefs(item, 'ServiceInstance', resolve)).toEqual({
      parentId: 'sm-target-id',
      extraIds: ['entitlement-target-id'],
    });
  });

  it('uses a Subaccount parent when it is the available normal reference', () => {
    const item = { spec: { forProvider: { subaccountRef: { name: 'account' } } } };
    expect(resolveItemRefs(item, 'ServiceInstance', resolve)).toEqual({
      parentId: 'account-target-id',
      extraIds: [],
    });
  });

  it('falls back to the Subaccount when the referenced ServiceManager is missing', () => {
    const item = {
      spec: {
        forProvider: {
          serviceManagerRef: { name: 'missing-manager' },
          subaccountRef: { name: 'account' },
        },
      },
    };
    expect(resolveItemRefs(item, 'ServiceInstance', resolve)).toEqual({
      parentId: 'account-target-id',
      extraIds: [],
    });
  });

  it('retains the Cloud Foundry Space association without inventing an Entitlement', () => {
    const item = {
      spec: { forProvider: { spaceRef: { name: 'space' }, type: 'managed' } },
    };
    expect(resolveItemRefs(item, 'ServiceInstance', resolve)).toEqual({
      parentId: undefined,
      extraIds: ['space-target-id'],
    });
  });
});

describe('reference discovery', () => {
  it('deduplicates additional targets and omits associations to the chosen parent', () => {
    const item = {
      spec: {
        forProvider: {
          serviceManagerRef: { name: 'manager' },
          spaceRef: { name: 'manager' },
          firstRef: { name: 'other' },
          secondRef: { name: 'other' },
        },
      },
    };
    expect(resolveItemRefs(item, 'ServiceInstance', name => name)).toEqual({
      parentId: 'manager',
      extraIds: ['other'],
    });
  });

  it('discovers references directly under spec', () => {
    const item = { spec: { spaceRef: { name: 'space' } } };
    expect(resolveItemRefs(item, 'ServiceInstance', resolve)).toEqual({
      parentId: undefined,
      extraIds: ['space-target-id'],
    });
  });

  it('prefers forProvider when the same reference key also exists directly under spec', () => {
    const item = {
      spec: {
        forProvider: { spaceRef: { name: 'space' } },
        spaceRef: { name: 'other-space' },
      },
    };
    expect(resolveItemRefs(item, 'ServiceInstance', resolve)).toEqual({
      parentId: undefined,
      extraIds: ['space-target-id'],
    });
  });

  it('excludes providerConfigRef for non-Object resources even when its target exists', () => {
    const item = { spec: { providerConfigRef: { name: 'environment' } } };
    expect(resolveItemRefs(item, 'ServiceInstance', resolve)).toEqual({
      parentId: undefined,
      extraIds: [],
    });
  });
});

describe('KymaEnvironment relationships', () => {
  it('prioritizes the Object spec provider config over conventional parents and forProvider', () => {
    const item = {
      spec: {
        providerConfigRef: { name: 'environment' },
        forProvider: {
          providerConfigRef: { name: 'missing-environment' },
          serviceManagerRef: { name: 'manager' },
          subaccountRef: { name: 'account' },
        },
      },
    };
    expect(resolveItemRefs(item, 'Object', resolve)).toEqual({
      parentId: 'environment-target-id',
      extraIds: [],
    });
  });

  it('resolves a KymaModule binding reference to the same-name KymaEnvironment parent', () => {
    const item = {
      spec: { forProvider: { kymaEnvironmentBindingRef: { name: 'environment' } } },
    };
    expect(resolveItemRefs(item, 'KymaModule', resolve)).toEqual({
      parentId: 'environment-target-id',
      extraIds: [],
    });
  });

  it('resolves an Object providerConfigRef to the same-name KymaEnvironment parent', () => {
    const item = { spec: { providerConfigRef: { name: 'environment' } } };
    expect(resolveItemRefs(item, 'Object', resolve)).toEqual({
      parentId: 'environment-target-id',
      extraIds: [],
    });
  });

  it.each([
    {
      kind: 'KymaModule',
      spec: { forProvider: { kymaEnvironmentBindingRef: { name: 'missing-environment' } } },
    },
    {
      kind: 'Object',
      spec: { providerConfigRef: { name: 'missing-environment' } },
    },
  ])('omits the $kind parent when the KymaEnvironment is missing', ({ kind, spec }) => {
    expect(resolveItemRefs({ spec }, kind, resolve)).toEqual({
      parentId: undefined,
      extraIds: [],
    });
  });
});
