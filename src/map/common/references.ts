interface DiscoveredRef {
  refKey: string;
  name: string;
}

/** Infers the target kind from a reference key, e.g. serviceManagerRef → ServiceManager. */
function inferKindFromRefKey(refKey: string): string {
  const stripped = refKey.replace(/Ref$/, '');
  if (!stripped) return '';
  return stripped[0].toUpperCase() + stripped.slice(1);
}

/**
 * Finds the resource references a Crossplane managed resource points at, by
 * scanning `spec.forProvider` (then `spec`) for keys ending in `Ref` whose value
 * is `{ name }`. `providerConfigRef` is excluded — it's universally present and
 * never links to another graph node by convention.
 */
function discoverRefs(item: any): DiscoveredRef[] {
  const spec = item?.spec ?? item?.jsonData?.spec;
  if (!spec || typeof spec !== 'object') return [];

  const isRefShape = (v: any): v is { name: string } =>
    !!v && typeof v === 'object' && typeof v.name === 'string';

  const out: DiscoveredRef[] = [];
  const seen = new Set<string>();

  const forProvider = spec.forProvider;
  if (forProvider && typeof forProvider === 'object') {
    for (const k of Object.keys(forProvider)) {
      if (!/Ref$/.test(k) || !isRefShape(forProvider[k])) continue;
      out.push({ refKey: k, name: forProvider[k].name });
      seen.add(k);
    }
  }

  for (const k of Object.keys(spec)) {
    if (k === 'forProvider' || k === 'providerConfigRef') continue;
    if (!/Ref$/.test(k) || seen.has(k) || !isRefShape(spec[k])) continue;
    out.push({ refKey: k, name: spec[k].name });
  }

  return out;
}

/** Earlier keys take priority when several parent references resolve. */
const PARENT_KEYS = ['serviceManagerRef', 'subaccountRef', 'kymaEnvironmentBindingRef'];

/** Resolves one parent and additional associations, including the three BTP-specific mappings. */
export function resolveItemRefs(
  item: any,
  kind: string,
  resolveRef: (refName: string | undefined, targetKind: string | undefined) => string | undefined
): { parentId: string | undefined; extraIds: string[] } {
  const refs = discoverRefs(item);
  const providerConfigName = item?.spec?.providerConfigRef?.name;
  if (kind === 'Object' && providerConfigName !== undefined) {
    refs.push({ refKey: 'providerConfigRef', name: providerConfigName });
  }

  let parentId: string | undefined;
  let parentPriority = 0;
  const extraIds = new Set<string>();

  for (const ref of refs) {
    const isObjectConfig = kind === 'Object' && ref.refKey === 'providerConfigRef';
    // The binding and provider config are not managed nodes; their names identify the environment.
    const targetKind =
      isObjectConfig || (kind === 'KymaModule' && ref.refKey === 'kymaEnvironmentBindingRef')
        ? 'KymaEnvironment'
        : inferKindFromRefKey(ref.refKey);
    const name = isObjectConfig && providerConfigName !== undefined ? providerConfigName : ref.name;
    const id = resolveRef(name, targetKind);
    if (!id) continue;

    const index = PARENT_KEYS.indexOf(ref.refKey);
    const priority = isObjectConfig ? 100 : index >= 0 ? PARENT_KEYS.length - index : 0;
    if (priority > 0) {
      if (priority > parentPriority) {
        parentId = id;
        parentPriority = priority;
      }
    } else {
      extraIds.add(id);
    }
  }

  // BTP ServiceInstances associate with Entitlements by offering + plan, without an explicit ref.
  if (kind === 'ServiceInstance') {
    const { offeringName, planName } = item?.spec?.forProvider ?? {};
    if (offeringName && planName) {
      const entitlementId = resolveRef(`${offeringName}::${planName}`, 'Entitlement');
      if (entitlementId) extraIds.add(entitlementId);
    }
  }

  if (parentId) extraIds.delete(parentId);
  return { parentId, extraIds: [...extraIds] };
}
