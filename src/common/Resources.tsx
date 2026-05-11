import { K8s } from '@kinvolk/headlamp-plugin/lib';

// makeKubeObject was removed from K8s in Headlamp v0.39+.
// Fall back to grabbing the base KubeObject class from an existing ResourceClass.
const makeKubeObject: (name: string) => any =
  (K8s as any).makeKubeObject ??
  (() => Object.getPrototypeOf(K8s.ResourceClasses.CustomResourceDefinition));

// Provider – pkg.crossplane.io/v1
export class Provider extends makeKubeObject('Provider') {
  static apiVersion = 'pkg.crossplane.io/v1';
  static kind = 'Provider';
  static apiName = 'providers';
  static isNamespaced = false;

  get spec(): any { return this.jsonData.spec; }
  get status(): any { return this.jsonData.status; }

  get installedVersion(): string {
    return this.status?.atPkg ?? this.status?.currentRevision ?? '';
  }

  get packageRef(): string {
    return this.spec?.package ?? '';
  }

  get conditions(): any[] {
    return this.status?.conditions ?? [];
  }

  getCondition(type: string) {
    return this.conditions.find((c: any) => c.type === type);
  }
}

// ProviderRevision – pkg.crossplane.io/v1
export class ProviderRevision extends makeKubeObject('ProviderRevision') {
  static apiVersion = 'pkg.crossplane.io/v1';
  static kind = 'ProviderRevision';
  static apiName = 'providerrevisions';
  static isNamespaced = false;

  get spec(): any { return this.jsonData.spec; }
  get status(): any { return this.jsonData.status; }

  get conditions(): any[] {
    return this.status?.conditions ?? [];
  }
}

// CompositeResourceDefinition – apiextensions.crossplane.io/v1
export class CompositeResourceDefinition extends makeKubeObject('CompositeResourceDefinition') {
  static apiVersion = 'apiextensions.crossplane.io/v1';
  static kind = 'CompositeResourceDefinition';
  static apiName = 'compositeresourcedefinitions';
  static isNamespaced = false;

  get spec(): any { return this.jsonData.spec; }
  get status(): any { return this.jsonData.status; }

  get conditions(): any[] {
    return this.status?.conditions ?? [];
  }
}

// Composition – apiextensions.crossplane.io/v1
export class Composition extends makeKubeObject('Composition') {
  static apiVersion = 'apiextensions.crossplane.io/v1';
  static kind = 'Composition';
  static apiName = 'compositions';
  static isNamespaced = false;

  get spec(): any { return this.jsonData.spec; }
  get status(): any { return this.jsonData.status; }

  get compositeTypeRef(): { apiVersion: string; kind: string } {
    return this.spec?.compositeTypeRef ?? { apiVersion: '', kind: '' };
  }
}
