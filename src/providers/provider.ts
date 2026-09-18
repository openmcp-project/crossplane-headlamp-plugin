import {KubeCondition, KubeObject} from '@kinvolk/headlamp-plugin/lib/k8s/cluster';

export const PROVIDER_LIST_ROUTE = 'crossplane-providers';
export const PROVIDER_DETAILS_ROUTE = 'crossplane-provider';

export interface ProviderSpec {
    package?: string;
    revisionActivationPolicy?: string;
}

export interface ProviderStatus {
    atPkg?: string;
    currentRevision?: string;
    conditions?: Array<KubeCondition>;
}

export class Provider extends KubeObject {
    static apiVersion = 'pkg.crossplane.io/v1';
    static kind = 'Provider';
    static apiName = 'providers';
    static isNamespaced = false;

    get spec(): ProviderSpec {
        return this.jsonData.spec || {};
    }

    get status(): ProviderStatus {
        return this.jsonData.status || {};
    }

    get installedVersion(): string {
        return this.status.atPkg || this.currentRevision;
    }

    get currentRevision(): string {
        return this.status.currentRevision ?? '';
    }

    get packageRef(): string {
        return this.spec.package ?? '';
    }

    get conditions() {
        return this.status.conditions ?? [];
    }

    getCondition(type: string) {
        return this.conditions.find((c) => c.type === type);
    }

    private parseCondition(type: string, trueText: string, falseText: string) {
        switch (this.getCondition(type)?.status) {
            case 'True':
                return { isTrue: true, text: trueText };
            case 'False':
                return { isTrue: false, text: falseText };
            default:
                return { isTrue: undefined, text: 'Unknown' };
        }
    }

    get health() {
        return this.parseCondition('Healthy', 'Healthy', 'Unhealthy');
    }

    get installStatus() {
        return this.parseCondition('Installed', 'Installed', 'Not Installed');
    }

    static get detailsRoute() {
        return PROVIDER_DETAILS_ROUTE;
    }

    static get listRoute() {
        return PROVIDER_LIST_ROUTE;
    }
}
