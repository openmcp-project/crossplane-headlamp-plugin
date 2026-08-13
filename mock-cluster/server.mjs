#!/usr/bin/env node
/**
 * Mock Kubernetes API server for local Crossplane plugin development.
 *
 * Serves realistic Crossplane mock data so the plugin can be tested inside
 * the real Headlamp desktop app — all buttons, panels, and navigation work.
 *
 * Usage:
 *   node mock-cluster/server.mjs [--scenario small|medium|large]
 *
 * Then add to kubeconfig:
 *   node mock-cluster/server.mjs --print-kubeconfig >> ~/.kube/config
 *
 * In Headlamp: switch to the "crossplane-mock" cluster.
 *
 * Server runs on http://localhost:9647 (no TLS — Headlamp connects directly).
 * Headlamp must be configured to allow insecure clusters (or use the kubeconfig
 * entry this script prints which sets insecure-skip-tls-verify).
 */

import http from 'http';
import { URL } from 'url';

const PORT = 9647;
const SCENARIO = process.argv.includes('--scenario')
  ? process.argv[process.argv.indexOf('--scenario') + 1]
  : 'small';

if (process.argv.includes('--print-kubeconfig')) {
  console.log(`
- cluster:
    server: http://localhost:${PORT}
    insecure-skip-tls-verify: true
  name: crossplane-mock
- context:
    cluster: crossplane-mock
    user: crossplane-mock-user
  name: crossplane-mock
- name: crossplane-mock-user
  user: {}
`);
  process.exit(0);
}

// ── Data generators ───────────────────────────────────────────────────────────

const ENVS = ['production', 'staging', 'dev', 'qa'];
const TEAMS = ['platform', 'backend', 'frontend', 'data', 'security'];
const FLUX_RELEASES = ['infra-core', 'app-services', 'data-platform', 'monitoring'];

function makeConditions(state) {
  if (state === 'ready') return [
    { type: 'Ready', status: 'True', reason: 'Available', lastTransitionTime: '2024-03-01T10:00:00Z' },
    { type: 'Synced', status: 'True', reason: 'ReconcileSuccess', lastTransitionTime: '2024-03-01T10:00:00Z' },
  ];
  if (state === 'degraded') return [
    { type: 'Ready', status: 'False', reason: 'ReconcileError', message: 'provider returned error: 403 Forbidden — check ProviderConfig credentials', lastTransitionTime: '2024-03-05T08:00:00Z' },
    { type: 'Synced', status: 'False', reason: 'ReconcileError', message: 'provider returned error: 403 Forbidden', lastTransitionTime: '2024-03-05T08:00:00Z' },
  ];
  return []; // unknown
}

function makeMR({ name, provider, group, kind, plural, providerConfig = 'default', health = 'ready', namespace, labels = {}, xr, claim, version = 'v1beta1', forProvider = {} }) {
  const annotations = {};
  if (xr) annotations['crossplane.io/composite'] = xr;
  if (claim) {
    annotations['crossplane.io/claim-name'] = claim.name;
    annotations['crossplane.io/claim-namespace'] = claim.namespace;
  }
  return {
    apiVersion: `${group}/${version}`,
    kind,
    metadata: {
      name,
      uid: `uid-${name}`,
      namespace: namespace ?? undefined,
      creationTimestamp: '2024-01-15T10:00:00Z',
      labels,
      annotations: Object.keys(annotations).length ? annotations : undefined,
      resourceVersion: '12345',
    },
    spec: { forProvider: { region: 'eu-west-1', ...forProvider }, providerConfigRef: { name: providerConfig } },
    status: { conditions: makeConditions(health) },
    // FlatMR fields for the plugin's helpers
    _providerName: provider,
    _group: group,
    _kind: kind,
    _plural: plural,
    _scope: namespace ? 'Namespaced' : 'Cluster',
  };
}

function makeMRBatch({ count, provider, group, kind, plural, namePrefix, providerConfigs = ['default'], healthDist = [0.7, 0.2, 0.1], labelFn, xrPrefix, claimNamespace }) {
  return Array.from({ length: count }, (_, i) => {
    const roll = i / count;
    const health = roll < healthDist[0] ? 'ready' : roll < healthDist[0] + healthDist[1] ? 'degraded' : 'unknown';
    const providerConfig = providerConfigs[i % providerConfigs.length];
    const xr = xrPrefix ? `${xrPrefix}-${Math.floor(i / 3)}` : undefined;
    const claim = xr && claimNamespace ? { name: `claim-${Math.floor(i / 3)}`, namespace: claimNamespace } : undefined;
    return makeMR({
      name: `${namePrefix}-${String(i + 1).padStart(3, '0')}`,
      provider, group, kind, plural, providerConfig, health,
      labels: labelFn ? labelFn(i) : {},
      xr, claim,
    });
  });
}

const envLabel = i => ({ environment: ENVS[i % ENVS.length], team: TEAMS[i % TEAMS.length] });
const fluxLabel = i => ({ 'helm.toolkit.fluxcd.io/name': FLUX_RELEASES[i % FLUX_RELEASES.length], environment: ENVS[i % ENVS.length] });

function smallLandscape() {
  // Covers all graph cases:
  //   A) Claim → XR → multiple MRs  (webapp-storage: S3 bucket + IAM role)
  //   B) Claim → XR → single MR, degraded  (webapp-db: RDS instance)
  //   C) XR without Claim (cluster-owned)  (xr-network-prod: VPC + Subnet)
  //   D) Multi-provider XR with Claim  (xr-backup-store: Azure RG + Account)
  //   E) Standalone MRs with no XR  (platform-logs-bucket, legacy-ci-role)
  return [
    // A: ObjectStorageClaim/webapp-storage in production → xr-webapp-storage
    makeMR({ name: 'webapp-assets-bucket', provider: 'provider-aws', group: 's3.aws.upbound.io', kind: 'Bucket', plural: 'buckets', providerConfig: 'production', health: 'ready', xr: 'xr-webapp-storage', claim: { name: 'webapp-storage', namespace: 'production' }, labels: { environment: 'production', app: 'webapp' } }),
    makeMR({ name: 'webapp-irsa-role',     provider: 'provider-aws', group: 'iam.aws.upbound.io', kind: 'Role', plural: 'roles', providerConfig: 'production', health: 'ready', xr: 'xr-webapp-storage', claim: { name: 'webapp-storage', namespace: 'production' }, labels: { environment: 'production', app: 'webapp' } }),

    // B: PostgreSQLInstanceClaim/webapp-db in production → xr-webapp-db (degraded)
    makeMR({ name: 'webapp-postgres', provider: 'provider-aws', group: 'rds.aws.upbound.io', kind: 'Instance', plural: 'instances', providerConfig: 'production', health: 'degraded', xr: 'xr-webapp-db', claim: { name: 'webapp-db', namespace: 'production' }, labels: { environment: 'production', app: 'webapp' } }),

    // C: xr-network-prod — cluster-owned shared infra, no Claim
    makeMR({ name: 'prod-vpc',      provider: 'provider-aws', group: 'ec2.aws.upbound.io', kind: 'VPC',    plural: 'vpcs',    providerConfig: 'production', health: 'ready', xr: 'xr-network-prod', labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'prod-subnet-a', provider: 'provider-aws', group: 'ec2.aws.upbound.io', kind: 'Subnet', plural: 'subnets', providerConfig: 'production', health: 'ready', xr: 'xr-network-prod', labels: { environment: 'production', team: 'platform' } }),

    // D: AzureStorageClaim/backup-storage in production → xr-backup-store
    makeMR({ name: 'backup-rg',      provider: 'provider-azure', group: 'azure.upbound.io',         kind: 'ResourceGroup', plural: 'resourcegroups', providerConfig: 'default', health: 'ready',   xr: 'xr-backup-store', claim: { name: 'backup-storage', namespace: 'production' }, labels: { environment: 'production' } }),
    makeMR({ name: 'backup-account', provider: 'provider-azure', group: 'storage.azure.upbound.io', kind: 'Account',        plural: 'accounts',        providerConfig: 'default', health: 'degraded', xr: 'xr-backup-store', claim: { name: 'backup-storage', namespace: 'production' }, labels: { environment: 'production' } }),

    // E: Standalone (no XR, no Claim)
    makeMR({ name: 'platform-logs-bucket', provider: 'provider-aws', group: 's3.aws.upbound.io',  kind: 'Bucket', plural: 'buckets', providerConfig: 'platform', health: 'ready',   labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'legacy-ci-role',       provider: 'provider-aws', group: 'iam.aws.upbound.io', kind: 'Role',   plural: 'roles',   providerConfig: 'default',  health: 'unknown', labels: { environment: 'staging',    team: 'backend' } }),

    // F: BTP direct resources — no XR, no Claim (SAP BTP Crossplane provider)
    // Subaccount → ServiceManager → ServiceInstance → ServiceBinding
    // Refs are wired via spec.forProvider.*Ref so the graph shows the dependency chain.
    makeMR({ name: 'dev-subaccount',          provider: 'provider-btp', group: 'account.btp.sap.crossplane.io', kind: 'Subaccount',      plural: 'subaccounts',      version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'dev', team: 'platform' }, forProvider: { displayName: 'Dev Subaccount', region: 'eu10', subdomain: 'dev-subaccount-abc123' } }),
    makeMR({ name: 'dev-service-manager',     provider: 'provider-btp', group: 'account.btp.sap.crossplane.io', kind: 'ServiceManager',  plural: 'servicemanagers',  version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'dev', team: 'platform' }, forProvider: { subaccountRef: { name: 'dev-subaccount' } } }),
    makeMR({ name: 'dev-destination-svc',     provider: 'provider-btp', group: 'account.btp.sap.crossplane.io', kind: 'ServiceInstance', plural: 'serviceinstances', version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'dev', app: 'webapp', team: 'backend' }, forProvider: { subaccountRef: { name: 'dev-subaccount' }, serviceManagerRef: { name: 'dev-service-manager' }, offeringName: 'destination', planName: 'lite' } }),
    makeMR({ name: 'dev-destination-binding', provider: 'provider-btp', group: 'account.btp.sap.crossplane.io', kind: 'ServiceBinding',  plural: 'servicebindings',  version: 'v1alpha1', providerConfig: 'btp-default', health: 'degraded', labels: { environment: 'dev', app: 'webapp', team: 'backend' }, forProvider: { subaccountRef: { name: 'dev-subaccount' }, serviceInstanceRef: { name: 'dev-destination-svc' } } }),
  ];
}

function mediumLandscape() {
  // ~27 MRs across 3 namespaces, 2 providers, 3 AWS ProviderConfigs + 1 Azure.
  // Graph cases covered:
  //   • XR with 3 MRs from 2 groups (xr-cart-storage: S3 x2 + IAM Role)
  //   • Single-MR XR that is degraded (xr-cart-db)
  //   • XR with 3 same-group MRs, one unknown (xr-analytics-lake)
  //   • XR with 2 MRs sharing a ProviderConfig (xr-analytics-db, no Claim)
  //   • XR representing network infra — wide (xr-network-prod: VPC + 3 Subnets)
  //   • XR for staging network (xr-network-staging)
  //   • EKS XR — 2 different kinds under one XR (xr-eks-platform)
  //   • Azure XR with Claim, one MR degraded (xr-azure-backup)
  //   • 4 standalone MRs of varying health
  return [
    // ── E-Commerce: Cart Service (namespace: ecommerce) ─────────────────────
    // cart-storage → xr-cart-storage: S3 Bucket x2 + IAM Role
    makeMR({ name: 'cart-assets-us', provider: 'provider-aws', group: 's3.aws.upbound.io', kind: 'Bucket', plural: 'buckets', providerConfig: 'production', health: 'ready',    xr: 'xr-cart-storage', claim: { name: 'cart-storage', namespace: 'ecommerce' }, labels: { environment: 'production', app: 'cart', team: 'backend' } }),
    makeMR({ name: 'cart-assets-eu', provider: 'provider-aws', group: 's3.aws.upbound.io', kind: 'Bucket', plural: 'buckets', providerConfig: 'production', health: 'ready',    xr: 'xr-cart-storage', claim: { name: 'cart-storage', namespace: 'ecommerce' }, labels: { environment: 'production', app: 'cart', team: 'backend' } }),
    makeMR({ name: 'cart-s3-irsa',   provider: 'provider-aws', group: 'iam.aws.upbound.io', kind: 'Role', plural: 'roles',   providerConfig: 'production', health: 'ready',    xr: 'xr-cart-storage', claim: { name: 'cart-storage', namespace: 'ecommerce' }, labels: { environment: 'production', app: 'cart' } }),
    // cart-db → xr-cart-db: single RDS instance, degraded
    makeMR({ name: 'cart-postgres', provider: 'provider-aws', group: 'rds.aws.upbound.io', kind: 'Instance', plural: 'instances', providerConfig: 'production', health: 'degraded', xr: 'xr-cart-db', claim: { name: 'cart-db', namespace: 'ecommerce' }, labels: { environment: 'production', app: 'cart' } }),

    // ── Data Platform (namespace: data) ─────────────────────────────────────
    // analytics-lake → xr-analytics-lake: S3 Bucket x3, last one unknown
    makeMR({ name: 'analytics-raw',       provider: 'provider-aws', group: 's3.aws.upbound.io', kind: 'Bucket', plural: 'buckets', providerConfig: 'staging', health: 'ready',   xr: 'xr-analytics-lake', claim: { name: 'analytics-lake', namespace: 'data' }, labels: { environment: 'staging', team: 'data' } }),
    makeMR({ name: 'analytics-processed', provider: 'provider-aws', group: 's3.aws.upbound.io', kind: 'Bucket', plural: 'buckets', providerConfig: 'staging', health: 'ready',   xr: 'xr-analytics-lake', claim: { name: 'analytics-lake', namespace: 'data' }, labels: { environment: 'staging', team: 'data' } }),
    makeMR({ name: 'analytics-archive',   provider: 'provider-aws', group: 's3.aws.upbound.io', kind: 'Bucket', plural: 'buckets', providerConfig: 'staging', health: 'unknown', xr: 'xr-analytics-lake', claim: { name: 'analytics-lake', namespace: 'data' }, labels: { environment: 'staging', team: 'data' } }),
    // xr-analytics-db: cluster-owned (no Claim), RDS primary + replica
    makeMR({ name: 'analytics-postgres-primary', provider: 'provider-aws', group: 'rds.aws.upbound.io', kind: 'Instance', plural: 'instances', providerConfig: 'staging', health: 'ready', xr: 'xr-analytics-db', labels: { environment: 'staging', team: 'data' } }),
    makeMR({ name: 'analytics-postgres-replica', provider: 'provider-aws', group: 'rds.aws.upbound.io', kind: 'Instance', plural: 'instances', providerConfig: 'staging', health: 'ready', xr: 'xr-analytics-db', labels: { environment: 'staging', team: 'data' } }),

    // ── Shared Network Infrastructure (no Claims) ────────────────────────────
    makeMR({ name: 'prod-vpc',      provider: 'provider-aws', group: 'ec2.aws.upbound.io', kind: 'VPC',    plural: 'vpcs',    providerConfig: 'production', health: 'ready', xr: 'xr-network-prod', labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'prod-subnet-a', provider: 'provider-aws', group: 'ec2.aws.upbound.io', kind: 'Subnet', plural: 'subnets', providerConfig: 'production', health: 'ready', xr: 'xr-network-prod', labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'prod-subnet-b', provider: 'provider-aws', group: 'ec2.aws.upbound.io', kind: 'Subnet', plural: 'subnets', providerConfig: 'production', health: 'ready', xr: 'xr-network-prod', labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'prod-subnet-c', provider: 'provider-aws', group: 'ec2.aws.upbound.io', kind: 'Subnet', plural: 'subnets', providerConfig: 'production', health: 'ready', xr: 'xr-network-prod', labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'staging-vpc',      provider: 'provider-aws', group: 'ec2.aws.upbound.io', kind: 'VPC',    plural: 'vpcs',    providerConfig: 'staging', health: 'ready', xr: 'xr-network-staging', labels: { environment: 'staging', team: 'platform' } }),
    makeMR({ name: 'staging-subnet-a', provider: 'provider-aws', group: 'ec2.aws.upbound.io', kind: 'Subnet', plural: 'subnets', providerConfig: 'staging', health: 'ready', xr: 'xr-network-staging', labels: { environment: 'staging', team: 'platform' } }),
    makeMR({ name: 'staging-subnet-b', provider: 'provider-aws', group: 'ec2.aws.upbound.io', kind: 'Subnet', plural: 'subnets', providerConfig: 'staging', health: 'ready', xr: 'xr-network-staging', labels: { environment: 'staging', team: 'platform' } }),

    // ── Platform EKS (no Claim) ──────────────────────────────────────────────
    makeMR({ name: 'platform-eks',         provider: 'provider-aws', group: 'eks.aws.upbound.io', kind: 'Cluster',   plural: 'clusters',   providerConfig: 'production', health: 'ready', xr: 'xr-eks-platform', labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'platform-eks-nodes',   provider: 'provider-aws', group: 'eks.aws.upbound.io', kind: 'NodeGroup', plural: 'nodegroups', providerConfig: 'production', health: 'ready', xr: 'xr-eks-platform', labels: { environment: 'production', team: 'platform' } }),

    // ── Azure DR Backup (namespace: production) ──────────────────────────────
    // azure-backup → xr-azure-backup: RG + Account x2, one degraded
    makeMR({ name: 'backup-rg-prod',     provider: 'provider-azure', group: 'azure.upbound.io',         kind: 'ResourceGroup', plural: 'resourcegroups', providerConfig: 'default', health: 'ready',    xr: 'xr-azure-backup', claim: { name: 'azure-backup', namespace: 'production' }, labels: { environment: 'production' } }),
    makeMR({ name: 'backup-storage-hot', provider: 'provider-azure', group: 'storage.azure.upbound.io', kind: 'Account',        plural: 'accounts',        providerConfig: 'default', health: 'ready',    xr: 'xr-azure-backup', claim: { name: 'azure-backup', namespace: 'production' }, labels: { environment: 'production' } }),
    makeMR({ name: 'backup-storage-cold', provider: 'provider-azure', group: 'storage.azure.upbound.io', kind: 'Account',       plural: 'accounts',        providerConfig: 'default', health: 'degraded', xr: 'xr-azure-backup', claim: { name: 'azure-backup', namespace: 'production' }, labels: { environment: 'production' } }),

    // ── Standalone MRs (no XR) ───────────────────────────────────────────────
    makeMR({ name: 'platform-audit-logs', provider: 'provider-aws', group: 's3.aws.upbound.io',    kind: 'Bucket',        plural: 'buckets',        providerConfig: 'default',    health: 'ready',    labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'legacy-admin-role',   provider: 'provider-aws', group: 'iam.aws.upbound.io',   kind: 'Role',          plural: 'roles',          providerConfig: 'default',    health: 'unknown',  labels: { environment: 'production', team: 'security' } }),
    makeMR({ name: 'dev-sandbox-bucket',  provider: 'provider-aws', group: 's3.aws.upbound.io',    kind: 'Bucket',        plural: 'buckets',        providerConfig: 'staging',    health: 'ready',    labels: { environment: 'staging',    team: 'backend' } }),
    makeMR({ name: 'broken-ec2-sg',       provider: 'provider-aws', group: 'ec2.aws.upbound.io',   kind: 'SecurityGroup', plural: 'securitygroups', providerConfig: 'default',    health: 'degraded', labels: { environment: 'production', team: 'platform' } }),

    // ── BTP direct resources — applied without Compositions ──────────────────
    // Prod subaccount with ServiceManager → 2x ServiceInstance → 2x ServiceBinding.
    // Entitlement references subaccount. CF environment uses CloudManagement ref.
    makeMR({ name: 'prod-subaccount',           provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'Subaccount',              plural: 'subaccounts',              version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', team: 'platform' }, forProvider: { displayName: 'Production Subaccount', region: 'eu10', subdomain: 'prod-subaccount-xyz' } }),
    makeMR({ name: 'prod-service-manager',      provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceManager',          plural: 'servicemanagers',          version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', team: 'platform' }, forProvider: { subaccountRef: { name: 'prod-subaccount' } } }),
    makeMR({ name: 'prod-destination-svc',      provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceInstance',         plural: 'serviceinstances',         version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', app: 'shop', team: 'backend'  }, forProvider: { subaccountRef: { name: 'prod-subaccount' }, serviceManagerRef: { name: 'prod-service-manager' }, offeringName: 'destination',  planName: 'lite' } }),
    makeMR({ name: 'prod-connectivity-svc',     provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceInstance',         plural: 'serviceinstances',         version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', app: 'shop', team: 'backend'  }, forProvider: { subaccountRef: { name: 'prod-subaccount' }, serviceManagerRef: { name: 'prod-service-manager' }, offeringName: 'connectivity', planName: 'lite' } }),
    makeMR({ name: 'prod-destination-binding',  provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceBinding',          plural: 'servicebindings',          version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', app: 'shop', team: 'backend'  }, forProvider: { subaccountRef: { name: 'prod-subaccount' }, serviceInstanceRef: { name: 'prod-destination-svc' } } }),
    makeMR({ name: 'prod-connectivity-binding', provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceBinding',          plural: 'servicebindings',          version: 'v1alpha1', providerConfig: 'btp-default', health: 'degraded', labels: { environment: 'production', app: 'shop', team: 'backend'  }, forProvider: { subaccountRef: { name: 'prod-subaccount' }, serviceInstanceRef: { name: 'prod-connectivity-svc' } } }),
    makeMR({ name: 'prod-cis-entitlement',      provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'Entitlement',             plural: 'entitlements',             version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', team: 'platform'             }, forProvider: { subaccountRef: { name: 'prod-subaccount' }, serviceName: 'cis', servicePlanName: 'local' } }),
    makeMR({ name: 'prod-cloud-management',     provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'CloudManagement',         plural: 'cloudmanagements',         version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', team: 'platform'             }, forProvider: { subaccountRef: { name: 'prod-subaccount' }, serviceManagerRef: { name: 'prod-service-manager' } } }),
    makeMR({ name: 'prod-cf-environment',       provider: 'provider-btp', group: 'environment.btp.sap.crossplane.io', kind: 'CloudFoundryEnvironment', plural: 'cloudfoundryenvironments', version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', team: 'platform'             }, forProvider: { cloudManagementRef: { name: 'prod-cloud-management' }, subaccountRef: { name: 'prod-subaccount' }, landscape: 'cf-eu10' } }),
  ];
}

function largeLandscape() {
  // ~110 MRs across 4 providers, 5 ProviderConfigs, 3 namespaces.
  // Anchor chains give the graph meaningful named nodes.
  // Batch resources add volume for performance/layout testing.
  const C_PROD  = ['production', 'production-eu', 'team-platform'];
  const C_STAG  = ['staging', 'team-data'];
  const C_ALL   = [...C_PROD, ...C_STAG, 'default'];

  const anchors = [
    // ── Shop service (namespace: shop) ──────────────────────────────────────
    // shop-storage → xr-shop-storage: S3 x3 + IAM Role + IAM Policy (5 MRs)
    makeMR({ name: 'shop-static-assets', provider: 'provider-aws', group: 's3.aws.upbound.io',   kind: 'Bucket', plural: 'buckets', providerConfig: 'production',    health: 'ready',   xr: 'xr-shop-storage', claim: { name: 'shop-storage', namespace: 'shop' }, labels: { environment: 'production', app: 'shop' } }),
    makeMR({ name: 'shop-user-uploads',  provider: 'provider-aws', group: 's3.aws.upbound.io',   kind: 'Bucket', plural: 'buckets', providerConfig: 'production',    health: 'ready',   xr: 'xr-shop-storage', claim: { name: 'shop-storage', namespace: 'shop' }, labels: { environment: 'production', app: 'shop' } }),
    makeMR({ name: 'shop-backups-eu',    provider: 'provider-aws', group: 's3.aws.upbound.io',   kind: 'Bucket', plural: 'buckets', providerConfig: 'production-eu', health: 'ready',   xr: 'xr-shop-storage', claim: { name: 'shop-storage', namespace: 'shop' }, labels: { environment: 'production', app: 'shop' } }),
    makeMR({ name: 'shop-s3-irsa-role',  provider: 'provider-aws', group: 'iam.aws.upbound.io',  kind: 'Role',   plural: 'roles',   providerConfig: 'production',    health: 'ready',   xr: 'xr-shop-storage', claim: { name: 'shop-storage', namespace: 'shop' }, labels: { environment: 'production', app: 'shop' } }),
    makeMR({ name: 'shop-s3-policy',     provider: 'provider-aws', group: 'iam.aws.upbound.io',  kind: 'Policy', plural: 'policies', providerConfig: 'production',   health: 'ready',   xr: 'xr-shop-storage', claim: { name: 'shop-storage', namespace: 'shop' }, labels: { environment: 'production', app: 'shop' } }),
    // shop-db → xr-shop-db: RDS primary + replica + subnet group (3 MRs)
    makeMR({ name: 'shop-pg-primary',    provider: 'provider-aws', group: 'rds.aws.upbound.io',  kind: 'Instance',    plural: 'instances',    providerConfig: 'production', health: 'ready', xr: 'xr-shop-db', claim: { name: 'shop-db', namespace: 'shop' }, labels: { environment: 'production', app: 'shop' } }),
    makeMR({ name: 'shop-pg-replica',    provider: 'provider-aws', group: 'rds.aws.upbound.io',  kind: 'Instance',    plural: 'instances',    providerConfig: 'production', health: 'ready', xr: 'xr-shop-db', claim: { name: 'shop-db', namespace: 'shop' }, labels: { environment: 'production', app: 'shop' } }),
    makeMR({ name: 'shop-db-subnetgrp',  provider: 'provider-aws', group: 'rds.aws.upbound.io',  kind: 'SubnetGroup', plural: 'subnetgroups', providerConfig: 'production', health: 'ready', xr: 'xr-shop-db', claim: { name: 'shop-db', namespace: 'shop' }, labels: { environment: 'production', app: 'shop' } }),
    // shop-cache → xr-shop-cache: ElastiCache + Security Group (2 MRs)
    makeMR({ name: 'shop-redis',    provider: 'provider-aws', group: 'elasticache.aws.upbound.io', kind: 'Cluster',       plural: 'clusters',       providerConfig: 'production', health: 'ready', xr: 'xr-shop-cache', claim: { name: 'shop-cache', namespace: 'shop' }, labels: { environment: 'production', app: 'shop' } }),
    makeMR({ name: 'shop-redis-sg', provider: 'provider-aws', group: 'ec2.aws.upbound.io',         kind: 'SecurityGroup', plural: 'securitygroups', providerConfig: 'production', health: 'ready', xr: 'xr-shop-cache', claim: { name: 'shop-cache', namespace: 'shop' }, labels: { environment: 'production', app: 'shop' } }),

    // ── Analytics service (namespace: analytics) ─────────────────────────────
    // event-lake → xr-analytics-lake: S3 x3, one degraded (3 MRs)
    makeMR({ name: 'analytics-events-raw',       provider: 'provider-aws', group: 's3.aws.upbound.io', kind: 'Bucket', plural: 'buckets', providerConfig: 'team-data', health: 'ready',    xr: 'xr-analytics-lake', claim: { name: 'event-lake', namespace: 'analytics' }, labels: { environment: 'production', team: 'data' } }),
    makeMR({ name: 'analytics-events-processed', provider: 'provider-aws', group: 's3.aws.upbound.io', kind: 'Bucket', plural: 'buckets', providerConfig: 'team-data', health: 'ready',    xr: 'xr-analytics-lake', claim: { name: 'event-lake', namespace: 'analytics' }, labels: { environment: 'production', team: 'data' } }),
    makeMR({ name: 'analytics-cold-archive',     provider: 'provider-aws', group: 's3.aws.upbound.io', kind: 'Bucket', plural: 'buckets', providerConfig: 'team-data', health: 'degraded', xr: 'xr-analytics-lake', claim: { name: 'event-lake', namespace: 'analytics' }, labels: { environment: 'production', team: 'data' } }),
    // analytics-db → xr-analytics-db: cluster-owned (no Claim), RDS x2 (2 MRs)
    makeMR({ name: 'analytics-pg-lakehouse',  provider: 'provider-aws', group: 'rds.aws.upbound.io', kind: 'Instance', plural: 'instances', providerConfig: 'team-data', health: 'ready', xr: 'xr-analytics-db', claim: { name: 'analytics-db', namespace: 'analytics' }, labels: { environment: 'production', team: 'data' } }),
    makeMR({ name: 'analytics-pg-metastore',  provider: 'provider-aws', group: 'rds.aws.upbound.io', kind: 'Instance', plural: 'instances', providerConfig: 'team-data', health: 'ready', xr: 'xr-analytics-db', claim: { name: 'analytics-db', namespace: 'analytics' }, labels: { environment: 'production', team: 'data' } }),

    // ── Platform Infrastructure (no Claims) ──────────────────────────────────
    // xr-network-prod: VPC + 3 Subnets + Internet Gateway (5 MRs)
    makeMR({ name: 'prod-vpc-main',  provider: 'provider-aws', group: 'ec2.aws.upbound.io', kind: 'VPC',             plural: 'vpcs',             providerConfig: 'team-platform', health: 'ready', xr: 'xr-network-prod', labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'prod-subnet-a',  provider: 'provider-aws', group: 'ec2.aws.upbound.io', kind: 'Subnet',          plural: 'subnets',          providerConfig: 'team-platform', health: 'ready', xr: 'xr-network-prod', labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'prod-subnet-b',  provider: 'provider-aws', group: 'ec2.aws.upbound.io', kind: 'Subnet',          plural: 'subnets',          providerConfig: 'team-platform', health: 'ready', xr: 'xr-network-prod', labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'prod-subnet-c',  provider: 'provider-aws', group: 'ec2.aws.upbound.io', kind: 'Subnet',          plural: 'subnets',          providerConfig: 'team-platform', health: 'ready', xr: 'xr-network-prod', labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'prod-igw',       provider: 'provider-aws', group: 'ec2.aws.upbound.io', kind: 'InternetGateway', plural: 'internetgateways', providerConfig: 'team-platform', health: 'ready', xr: 'xr-network-prod', labels: { environment: 'production', team: 'platform' } }),
    // xr-eks-prod: EKS Cluster + 2 NodeGroups (3 MRs)
    makeMR({ name: 'prod-eks',              provider: 'provider-aws', group: 'eks.aws.upbound.io', kind: 'Cluster',   plural: 'clusters',   providerConfig: 'team-platform', health: 'ready', xr: 'xr-eks-prod', labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'prod-eks-ng-app',       provider: 'provider-aws', group: 'eks.aws.upbound.io', kind: 'NodeGroup', plural: 'nodegroups', providerConfig: 'team-platform', health: 'ready', xr: 'xr-eks-prod', labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'prod-eks-ng-data',      provider: 'provider-aws', group: 'eks.aws.upbound.io', kind: 'NodeGroup', plural: 'nodegroups', providerConfig: 'team-platform', health: 'ready', xr: 'xr-eks-prod', labels: { environment: 'production', team: 'platform' } }),

    // ── Azure cross-cloud DR (namespace: production) ──────────────────────────
    // azure-dr → xr-azure-dr: RG + Account x2 + SQL Server (4 MRs), one degraded
    makeMR({ name: 'dr-rg-prod',       provider: 'provider-azure', group: 'azure.upbound.io',         kind: 'ResourceGroup', plural: 'resourcegroups', providerConfig: 'production', health: 'ready',    xr: 'xr-azure-dr', claim: { name: 'azure-dr', namespace: 'production' }, labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'dr-storage-hot',   provider: 'provider-azure', group: 'storage.azure.upbound.io', kind: 'Account',        plural: 'accounts',        providerConfig: 'production', health: 'ready',    xr: 'xr-azure-dr', claim: { name: 'azure-dr', namespace: 'production' }, labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'dr-storage-cold',  provider: 'provider-azure', group: 'storage.azure.upbound.io', kind: 'Account',        plural: 'accounts',        providerConfig: 'production', health: 'degraded', xr: 'xr-azure-dr', claim: { name: 'azure-dr', namespace: 'production' }, labels: { environment: 'production', team: 'platform' } }),
    makeMR({ name: 'dr-sql-server',    provider: 'provider-azure', group: 'sql.azure.upbound.io',     kind: 'Server',         plural: 'servers',         providerConfig: 'production', health: 'ready',    xr: 'xr-azure-dr', claim: { name: 'azure-dr', namespace: 'production' }, labels: { environment: 'production', team: 'platform' } }),

    // ── GCP data offload (namespace: data) ────────────────────────────────────
    // gcs-lake → xr-gcp-lake: GCS Bucket x2 (2 MRs)
    makeMR({ name: 'gcs-events-raw',       provider: 'provider-gcp', group: 'storage.gcp.upbound.io', kind: 'Bucket',          plural: 'buckets',          providerConfig: 'team-data', health: 'ready', xr: 'xr-gcp-lake', claim: { name: 'gcs-lake', namespace: 'data' }, labels: { environment: 'production', team: 'data' } }),
    makeMR({ name: 'gcs-events-processed', provider: 'provider-gcp', group: 'storage.gcp.upbound.io', kind: 'Bucket',          plural: 'buckets',          providerConfig: 'team-data', health: 'ready', xr: 'xr-gcp-lake', claim: { name: 'gcs-lake', namespace: 'data' }, labels: { environment: 'production', team: 'data' } }),
    // gcp-db → xr-gcp-db: Cloud SQL (1 MR)
    makeMR({ name: 'cloudsql-analytics', provider: 'provider-gcp', group: 'sql.gcp.upbound.io', kind: 'DatabaseInstance', plural: 'databaseinstances', providerConfig: 'team-data', health: 'ready', xr: 'xr-gcp-db', claim: { name: 'gcp-db', namespace: 'data' }, labels: { environment: 'production', team: 'data' } }),

    // ── BTP direct resources — 3 subaccounts (dev/staging/prod), full stacks ──
    // No XR, no Claim. Refs wired via spec.forProvider.*Ref so the graph shows
    // the real dependency chain: Subaccount ← SM ← Instance ← Binding.
    // dev subaccount stack
    makeMR({ name: 'btp-dev-subaccount',          provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'Subaccount',              plural: 'subaccounts',              version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'dev',        team: 'platform' }, forProvider: { displayName: 'Dev Subaccount', region: 'eu10', subdomain: 'dev-sa-abc' } }),
    makeMR({ name: 'btp-dev-sm',                  provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceManager',          plural: 'servicemanagers',          version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'dev',        team: 'platform' }, forProvider: { subaccountRef: { name: 'btp-dev-subaccount' } } }),
    makeMR({ name: 'btp-dev-destination-svc',     provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceInstance',         plural: 'serviceinstances',         version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'dev',        team: 'backend'  }, forProvider: { subaccountRef: { name: 'btp-dev-subaccount' }, serviceManagerRef: { name: 'btp-dev-sm' }, offeringName: 'destination', planName: 'lite' } }),
    makeMR({ name: 'btp-dev-destination-binding', provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceBinding',          plural: 'servicebindings',          version: 'v1alpha1', providerConfig: 'btp-default', health: 'unknown',  labels: { environment: 'dev',        team: 'backend'  }, forProvider: { subaccountRef: { name: 'btp-dev-subaccount' }, serviceInstanceRef: { name: 'btp-dev-destination-svc' } } }),

    // staging subaccount stack
    makeMR({ name: 'btp-staging-subaccount',      provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'Subaccount',              plural: 'subaccounts',              version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'staging',    team: 'platform' }, forProvider: { displayName: 'Staging Subaccount', region: 'eu10', subdomain: 'staging-sa-def' } }),
    makeMR({ name: 'btp-staging-sm',              provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceManager',          plural: 'servicemanagers',          version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'staging',    team: 'platform' }, forProvider: { subaccountRef: { name: 'btp-staging-subaccount' } } }),
    makeMR({ name: 'btp-staging-xsuaa-svc',       provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceInstance',         plural: 'serviceinstances',         version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'staging',    app: 'shop', team: 'backend'  }, forProvider: { subaccountRef: { name: 'btp-staging-subaccount' }, serviceManagerRef: { name: 'btp-staging-sm' }, offeringName: 'xsuaa', planName: 'application' } }),
    makeMR({ name: 'btp-staging-destination-svc', provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceInstance',         plural: 'serviceinstances',         version: 'v1alpha1', providerConfig: 'btp-default', health: 'degraded', labels: { environment: 'staging',    app: 'shop', team: 'backend'  }, forProvider: { subaccountRef: { name: 'btp-staging-subaccount' }, serviceManagerRef: { name: 'btp-staging-sm' }, offeringName: 'destination', planName: 'lite' } }),
    makeMR({ name: 'btp-staging-xsuaa-binding',   provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceBinding',          plural: 'servicebindings',          version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'staging',    app: 'shop', team: 'backend'  }, forProvider: { subaccountRef: { name: 'btp-staging-subaccount' }, serviceInstanceRef: { name: 'btp-staging-xsuaa-svc' } } }),
    makeMR({ name: 'btp-staging-cis-entitlement', provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'Entitlement',             plural: 'entitlements',             version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'staging',    team: 'platform' }, forProvider: { subaccountRef: { name: 'btp-staging-subaccount' }, serviceName: 'cis', servicePlanName: 'local' } }),
    makeMR({ name: 'btp-staging-cf-env',          provider: 'provider-btp', group: 'environment.btp.sap.crossplane.io', kind: 'CloudFoundryEnvironment', plural: 'cloudfoundryenvironments', version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'staging',    team: 'platform' }, forProvider: { subaccountRef: { name: 'btp-staging-subaccount' }, landscape: 'cf-eu10' } }),

    // prod subaccount stack — full set
    makeMR({ name: 'btp-prod-subaccount',         provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'Subaccount',              plural: 'subaccounts',              version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', team: 'platform' }, forProvider: { displayName: 'Production Subaccount', region: 'eu10', subdomain: 'prod-sa-xyz' } }),
    makeMR({ name: 'btp-prod-sm',                 provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceManager',          plural: 'servicemanagers',          version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', team: 'platform' }, forProvider: { subaccountRef: { name: 'btp-prod-subaccount' } } }),
    makeMR({ name: 'btp-prod-connectivity-svc',   provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceInstance',         plural: 'serviceinstances',         version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', app: 'shop', team: 'backend'  }, forProvider: { subaccountRef: { name: 'btp-prod-subaccount' }, serviceManagerRef: { name: 'btp-prod-sm' }, offeringName: 'connectivity', planName: 'lite' } }),
    makeMR({ name: 'btp-prod-destination-svc',    provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceInstance',         plural: 'serviceinstances',         version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', app: 'shop', team: 'backend'  }, forProvider: { subaccountRef: { name: 'btp-prod-subaccount' }, serviceManagerRef: { name: 'btp-prod-sm' }, offeringName: 'destination', planName: 'lite' } }),
    makeMR({ name: 'btp-prod-cloud-logging-svc',  provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceInstance',         plural: 'serviceinstances',         version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', team: 'platform'             }, forProvider: { subaccountRef: { name: 'btp-prod-subaccount' }, serviceManagerRef: { name: 'btp-prod-sm' }, offeringName: 'cloud-logging', planName: 'standard' } }),
    makeMR({ name: 'btp-prod-connectivity-bind',  provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceBinding',          plural: 'servicebindings',          version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', app: 'shop', team: 'backend'  }, forProvider: { subaccountRef: { name: 'btp-prod-subaccount' }, serviceInstanceRef: { name: 'btp-prod-connectivity-svc' } } }),
    makeMR({ name: 'btp-prod-destination-bind',   provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceBinding',          plural: 'servicebindings',          version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', app: 'shop', team: 'backend'  }, forProvider: { subaccountRef: { name: 'btp-prod-subaccount' }, serviceInstanceRef: { name: 'btp-prod-destination-svc' } } }),
    makeMR({ name: 'btp-prod-logging-bind',       provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'ServiceBinding',          plural: 'servicebindings',          version: 'v1alpha1', providerConfig: 'btp-default', health: 'degraded', labels: { environment: 'production', team: 'platform'             }, forProvider: { subaccountRef: { name: 'btp-prod-subaccount' }, serviceInstanceRef: { name: 'btp-prod-cloud-logging-svc' } } }),
    makeMR({ name: 'btp-prod-cis-entitlement',    provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'Entitlement',             plural: 'entitlements',             version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', team: 'platform'             }, forProvider: { subaccountRef: { name: 'btp-prod-subaccount' }, serviceName: 'cis', servicePlanName: 'local' } }),
    makeMR({ name: 'btp-prod-cloud-management',   provider: 'provider-btp', group: 'account.btp.sap.crossplane.io',     kind: 'CloudManagement',         plural: 'cloudmanagements',         version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', team: 'platform'             }, forProvider: { subaccountRef: { name: 'btp-prod-subaccount' }, serviceManagerRef: { name: 'btp-prod-sm' } } }),
    makeMR({ name: 'btp-prod-cf-environment',     provider: 'provider-btp', group: 'environment.btp.sap.crossplane.io', kind: 'CloudFoundryEnvironment', plural: 'cloudfoundryenvironments', version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', team: 'platform'             }, forProvider: { cloudManagementRef: { name: 'btp-prod-cloud-management' }, subaccountRef: { name: 'btp-prod-subaccount' }, landscape: 'cf-eu10' } }),
    makeMR({ name: 'btp-prod-kyma-environment',   provider: 'provider-btp', group: 'environment.btp.sap.crossplane.io', kind: 'KymaEnvironment',         plural: 'kymaenvironments',         version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', team: 'platform'             }, forProvider: { subaccountRef: { name: 'btp-prod-subaccount' } } }),
    makeMR({ name: 'btp-prod-role-collection',    provider: 'provider-btp', group: 'security.btp.sap.crossplane.io',    kind: 'RoleCollection',          plural: 'rolecollections',          version: 'v1alpha1', providerConfig: 'btp-default', health: 'ready',    labels: { environment: 'production', team: 'security'             }, forProvider: { subaccountRef: { name: 'btp-prod-subaccount' } } }),
  ];

  // Batch-generated bulk resources (groups of 3 MRs share one XR, claims in 'teams' namespace)
  const bulk = [
    ...makeMRBatch({ count: 12, provider: 'provider-aws', group: 's3.aws.upbound.io',             kind: 'Bucket',        plural: 'buckets',        namePrefix: 'tmbucket',  providerConfigs: C_ALL,  labelFn: envLabel,  xrPrefix: 'xr-team-storage', claimNamespace: 'teams' }),
    ...makeMRBatch({ count: 10, provider: 'provider-aws', group: 'rds.aws.upbound.io',             kind: 'Instance',      plural: 'instances',      namePrefix: 'tmdb',      providerConfigs: C_PROD, labelFn: envLabel,  xrPrefix: 'xr-team-db',      claimNamespace: 'teams' }),
    ...makeMRBatch({ count: 8,  provider: 'provider-aws', group: 'iam.aws.upbound.io',             kind: 'Role',          plural: 'roles',          namePrefix: 'svcacct',   providerConfigs: ['default', 'production'], labelFn: fluxLabel }),
    ...makeMRBatch({ count: 8,  provider: 'provider-aws', group: 'ec2.aws.upbound.io',             kind: 'SecurityGroup', plural: 'securitygroups', namePrefix: 'sg',        providerConfigs: ['production', 'staging'], labelFn: envLabel }),
    ...makeMRBatch({ count: 10, provider: 'provider-azure', group: 'azure.upbound.io',             kind: 'ResourceGroup', plural: 'resourcegroups', namePrefix: 'rg',        providerConfigs: ['default', 'production'], labelFn: envLabel }),
    ...makeMRBatch({ count: 8,  provider: 'provider-azure', group: 'storage.azure.upbound.io',     kind: 'Account',       plural: 'accounts',       namePrefix: 'st',        providerConfigs: ['default'], labelFn: fluxLabel }),
    ...makeMRBatch({ count: 8,  provider: 'provider-gcp',   group: 'storage.gcp.upbound.io',       kind: 'Bucket',        plural: 'buckets',        namePrefix: 'gcsbatch',  providerConfigs: ['team-data'], labelFn: fluxLabel }),
    ...makeMRBatch({ count: 5,  provider: 'provider-kubernetes', group: 'kubernetes.crossplane.io', kind: 'Object',        plural: 'objects',        namePrefix: 'k8s-obj',   providerConfigs: ['default'], labelFn: fluxLabel }),
  ];

  return [...anchors, ...bulk];
}

// ── Build data model from FlatMR items ────────────────────────────────────────

function buildDataModel(items) {
  const byProvider = new Map();
  for (const item of items) {
    if (!byProvider.has(item._providerName)) byProvider.set(item._providerName, new Map());
    const key = `${item._group}/${item._plural}`;
    if (!byProvider.get(item._providerName).has(key)) byProvider.get(item._providerName).set(key, []);
    byProvider.get(item._providerName).get(key).push(item);
  }

  const providers = [];
  const providerRevisions = [];
  const crds = [];
  const crdByName = new Map();
  const instancesByPlural = new Map();
  const instanceByName = new Map();
  // providerConfigsByGroup['aws.upbound.io'] = [{ name, apiVersion, ... }, ...]
  const providerConfigsByGroup = new Map();

  for (const [providerName, byPlural] of byProvider) {
    const revName = `${providerName}-rev001`;
    const objectRefs = [];

    // Derive the provider's base API group from the first CRD group
    // e.g. 's3.aws.upbound.io' → 'aws.upbound.io'
    const firstGroup = [...byPlural.values()][0]?.[0]?._group ?? '';
    const groupParts = firstGroup.split('.');
    // Drop the service prefix (s3, rds, …) — keep the last two or three segments
    const providerGroup = groupParts.length > 2
      ? groupParts.slice(1).join('.')
      : firstGroup;

    // Collect unique providerConfig names used across all MRs for this provider
    const configNames = new Set();
    for (const groupItems of byPlural.values()) {
      for (const item of groupItems) {
        const cfgName = item.spec?.providerConfigRef?.name;
        if (cfgName) configNames.add(cfgName);
      }
    }

    // ProviderConfig CRD
    const pcCrdName = `providerconfigs.${providerGroup}`;
    if (!crdByName.has(pcCrdName)) {
      const pcCrd = {
        apiVersion: 'apiextensions.k8s.io/v1',
        kind: 'CustomResourceDefinition',
        metadata: { name: pcCrdName, uid: `crd-${pcCrdName}`, creationTimestamp: '2024-01-01T00:00:00Z', resourceVersion: '100' },
        spec: {
          group: providerGroup,
          names: { kind: 'ProviderConfig', plural: 'providerconfigs', singular: 'providerconfig', listKind: 'ProviderConfigList' },
          scope: 'Cluster',
          versions: [{ name: 'v1beta1', served: true, storage: true, schema: { openAPIV3Schema: { type: 'object', properties: {} } } }],
        },
        status: { conditions: [{ type: 'NamesAccepted', status: 'True' }, { type: 'Established', status: 'True' }] },
        jsonData: {
          spec: {
            group: providerGroup,
            names: { kind: 'ProviderConfig', plural: 'providerconfigs', singular: 'providerconfig' },
            scope: 'Cluster',
            versions: [{ name: 'v1beta1', served: true, storage: true }],
          },
        },
      };
      crdByName.set(pcCrdName, pcCrd);
      crds.push(pcCrd);
    }
    objectRefs.push({ kind: 'CustomResourceDefinition', name: pcCrdName });

    // ProviderConfig instances
    const pcInstances = [...configNames].map(cfgName => ({
      apiVersion: `${providerGroup}/v1beta1`,
      kind: 'ProviderConfig',
      metadata: { name: cfgName, uid: `pc-${providerName}-${cfgName}`, creationTimestamp: '2024-01-15T10:00:00Z', resourceVersion: '400' },
      spec: { credentials: { source: 'Secret', secretRef: { namespace: 'crossplane-system', name: `${providerName}-creds`, key: 'credentials' } } },
      status: {
        conditions: [
          { type: 'Ready', status: 'True', reason: 'Available', lastTransitionTime: '2024-03-01T10:00:00Z' },
        ],
        users: Math.floor(Math.random() * 20) + 1,
      },
    }));
    if (!providerConfigsByGroup.has(providerGroup)) providerConfigsByGroup.set(providerGroup, []);
    providerConfigsByGroup.get(providerGroup).push(...pcInstances);
    for (const pc of pcInstances) instanceByName.set(pc.metadata.name, pc);

    for (const [, groupItems] of byPlural) {
      const first = groupItems[0];
      const crdName = `${first._plural}.${first._group}`;
      if (!crdByName.has(crdName)) {
        const crd = {
          apiVersion: 'apiextensions.k8s.io/v1',
          kind: 'CustomResourceDefinition',
          metadata: { name: crdName, uid: `crd-${crdName}`, creationTimestamp: '2024-01-01T00:00:00Z', resourceVersion: '100' },
          spec: {
            group: first._group,
            names: { kind: first._kind, plural: first._plural, singular: first._plural.replace(/s$/, ''), listKind: `${first._kind}List` },
            scope: first._scope === 'Namespaced' ? 'Namespaced' : 'Cluster',
            versions: [{ name: 'v1beta1', served: true, storage: true, schema: { openAPIV3Schema: { type: 'object', properties: {} } } }],
          },
          status: { conditions: [{ type: 'NamesAccepted', status: 'True' }, { type: 'Established', status: 'True' }] },
          jsonData: {
            spec: {
              group: first._group,
              names: { kind: first._kind, plural: first._plural, singular: first._plural.replace(/s$/, '') },
              scope: first._scope === 'Namespaced' ? 'Namespaced' : 'Cluster',
              versions: [{ name: 'v1beta1', served: true, storage: true }],
            },
          },
        };
        crdByName.set(crdName, crd);
        crds.push(crd);
      }
      objectRefs.push({ kind: 'CustomResourceDefinition', name: crdName });

      for (const inst of groupItems) {
        if (!instancesByPlural.has(first._plural)) instancesByPlural.set(first._plural, []);
        instancesByPlural.get(first._plural).push(inst);
        instanceByName.set(inst.metadata.name, inst);
      }
    }

    const rev = {
      apiVersion: 'pkg.crossplane.io/v1',
      kind: 'ProviderRevision',
      metadata: { name: revName, uid: `rev-${revName}`, creationTimestamp: '2024-01-10T08:00:00Z', resourceVersion: '200',
        labels: { 'pkg.crossplane.io/package-name': providerName } },
      spec: { desiredState: 'Active', package: `xpkg.upbound.io/upbound/${providerName}:v1.0.0`, revision: 1 },
      status: { conditions: [{ type: 'Healthy', status: 'True' }], objectRefs },
      jsonData: { status: { objectRefs } },
    };
    providerRevisions.push(rev);

    providers.push({
      apiVersion: 'pkg.crossplane.io/v1',
      kind: 'Provider',
      metadata: { name: providerName, uid: `prov-${providerName}`, creationTimestamp: '2024-01-10T08:00:00Z', resourceVersion: '300' },
      spec: { package: `xpkg.upbound.io/upbound/${providerName}:v1.0.0`, revisionActivationPolicy: 'Automatic' },
      status: {
        currentRevision: revName,
        conditions: [
          { type: 'Installed', status: 'True', reason: 'ActivePackageRevision', lastTransitionTime: '2024-03-01T10:00:00Z' },
          { type: 'Healthy', status: 'True', reason: 'HealthyPackageRevision', lastTransitionTime: '2024-03-01T10:00:00Z' },
          { type: 'Ready', status: 'True', reason: 'HealthyPackageRevision', lastTransitionTime: '2024-03-01T10:00:00Z' },
        ],
      },
      jsonData: {
        spec: { package: `xpkg.upbound.io/upbound/${providerName}:v1.0.0` },
        status: {
          currentRevision: revName,
          conditions: [
            { type: 'Installed', status: 'True', reason: 'ActivePackageRevision' },
            { type: 'Healthy', status: 'True', reason: 'HealthyPackageRevision' },
            { type: 'Ready', status: 'True', reason: 'HealthyPackageRevision' },
          ],
        },
      },
    });
  }

  return { providers, providerRevisions, crds, crdByName, instancesByPlural, instanceByName, providerConfigsByGroup };
}

// ── Pick scenario ─────────────────────────────────────────────────────────────

const scenarioItems = SCENARIO === 'large' ? largeLandscape()
  : SCENARIO === 'medium' ? mediumLandscape()
  : smallLandscape();

const DATA = buildDataModel(scenarioItems);

console.log(`✓ Mock cluster ready — scenario: ${SCENARIO}`);
console.log(`  ${DATA.providers.length} providers, ${DATA.crds.length} CRDs, ${scenarioItems.length} managed resources`);

// ── Helpers ───────────────────────────────────────────────────────────────────

function list(kind, apiVersion, items) {
  return { kind: `${kind}List`, apiVersion, metadata: { resourceVersion: '999' }, items };
}

function notFound(res, path) {
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ kind: 'Status', apiVersion: 'v1', status: 'Failure', message: `${path} not found`, reason: 'NotFound', code: 404 }));
}

function ok(res, body) {
  const payload = JSON.stringify(body);
  res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) });
  res.end(payload);
}

function handleWatch(res) {
  // Return an empty watch response — keeps connections alive without real events
  res.writeHead(200, { 'Content-Type': 'application/json', 'Transfer-Encoding': 'chunked' });
  // Send a periodic bookmark event so Headlamp's watch loop stays healthy
  const iv = setInterval(() => {
    try {
      res.write(JSON.stringify({ type: 'BOOKMARK', object: { kind: 'Status', metadata: { resourceVersion: '999' } } }) + '\n');
    } catch {
      clearInterval(iv);
    }
  }, 15000);
  res.on('close', () => clearInterval(iv));
}

// ── Router ────────────────────────────────────────────────────────────────────

function route(req, res) {
  const u = new URL(req.url, `http://localhost:${PORT}`);
  const path = u.pathname;
  const isWatch = u.searchParams.get('watch') === 'true' || u.searchParams.get('watch') === '1';
  const method = req.method;

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (method === 'OPTIONS') { res.writeHead(204); res.end(); return; }

  if (isWatch) { handleWatch(res); return; }

  // ── k8s discovery ──────────────────────────────────────────────────────────
  if (path === '/version') return ok(res, { gitVersion: 'v1.29.0', major: '1', minor: '29' });
  if (path === '/api') return ok(res, { kind: 'APIVersions', versions: ['v1'], serverAddressByClientCIDRs: [] });
  if (path === '/api/v1') return ok(res, { kind: 'APIResourceList', groupVersion: 'v1', resources: [
    { name: 'namespaces', singularName: '', namespaced: false, kind: 'Namespace', verbs: ['list', 'get', 'watch'] },
    { name: 'pods', singularName: '', namespaced: true, kind: 'Pod', verbs: ['list', 'get', 'watch'] },
  ]});
  if (path === '/api/v1/namespaces') return ok(res, list('Namespace', 'v1', [
    { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'crossplane-system', uid: 'ns-xp', creationTimestamp: '2024-01-01T00:00:00Z', resourceVersion: '1' }, status: { phase: 'Active' } },
    { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'production', uid: 'ns-prod', creationTimestamp: '2024-01-01T00:00:00Z', resourceVersion: '2' }, status: { phase: 'Active' } },
    { apiVersion: 'v1', kind: 'Namespace', metadata: { name: 'default', uid: 'ns-def', creationTimestamp: '2024-01-01T00:00:00Z', resourceVersion: '3' }, status: { phase: 'Active' } },
  ]));
  if (path === '/apis') return ok(res, { kind: 'APIGroupList', apiVersion: 'v1', groups: [
    { name: 'pkg.crossplane.io', versions: [{ groupVersion: 'pkg.crossplane.io/v1', version: 'v1' }], preferredVersion: { groupVersion: 'pkg.crossplane.io/v1', version: 'v1' } },
    { name: 'apiextensions.k8s.io', versions: [{ groupVersion: 'apiextensions.k8s.io/v1', version: 'v1' }], preferredVersion: { groupVersion: 'apiextensions.k8s.io/v1', version: 'v1' } },
    { name: 'apiextensions.crossplane.io', versions: [{ groupVersion: 'apiextensions.crossplane.io/v1', version: 'v1' }], preferredVersion: { groupVersion: 'apiextensions.crossplane.io/v1', version: 'v1' } },
    { name: 'authorization.k8s.io', versions: [{ groupVersion: 'authorization.k8s.io/v1', version: 'v1' }], preferredVersion: { groupVersion: 'authorization.k8s.io/v1', version: 'v1' } },
  ]});

  // ── RBAC ──────────────────────────────────────────────────────────────────
  if (path === '/apis/authorization.k8s.io/v1/selfsubjectaccessreviews' && method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => ok(res, { apiVersion: 'authorization.k8s.io/v1', kind: 'SelfSubjectAccessReview', status: { allowed: true } }));
    return;
  }

  // ── Crossplane compositions / XRDs ────────────────────────────────────────
  if (path === '/apis/apiextensions.crossplane.io/v1/compositions') return ok(res, list('Composition', 'apiextensions.crossplane.io/v1', []));
  if (path === '/apis/apiextensions.crossplane.io/v1/compositeresourcedefinitions') return ok(res, list('CompositeResourceDefinition', 'apiextensions.crossplane.io/v1', []));

  // ── Providers ─────────────────────────────────────────────────────────────
  if (path === '/apis/pkg.crossplane.io/v1/providers') return ok(res, list('Provider', 'pkg.crossplane.io/v1', DATA.providers));
  const providerMatch = path.match(/^\/apis\/pkg\.crossplane\.io\/v1\/providers\/([^/]+)$/);
  if (providerMatch) {
    const p = DATA.providers.find(p => p.metadata.name === providerMatch[1]);
    return p ? ok(res, p) : notFound(res, path);
  }

  // ── Provider revisions ────────────────────────────────────────────────────
  if (path === '/apis/pkg.crossplane.io/v1/providerrevisions') return ok(res, list('ProviderRevision', 'pkg.crossplane.io/v1', DATA.providerRevisions));
  const revMatch = path.match(/^\/apis\/pkg\.crossplane\.io\/v1\/providerrevisions\/([^/]+)$/);
  if (revMatch) {
    const r = DATA.providerRevisions.find(r => r.metadata.name === revMatch[1]);
    return r ? ok(res, r) : notFound(res, path);
  }

  // ── CRDs ──────────────────────────────────────────────────────────────────
  if (path === '/apis/apiextensions.k8s.io/v1/customresourcedefinitions') {
    const selector = u.searchParams.get('labelSelector') ?? '';
    const filtered = selector
      ? DATA.crds.filter(c => DATA.providerRevisions.some(rev =>
          (rev.status?.objectRefs ?? []).some((r) => r.name === c.metadata.name) &&
          rev.metadata.labels?.['pkg.crossplane.io/package-name'] &&
          selector.includes(rev.metadata.labels['pkg.crossplane.io/package-name'])
        ))
      : DATA.crds;
    return ok(res, list('CustomResourceDefinition', 'apiextensions.k8s.io/v1', filtered));
  }
  const crdMatch = path.match(/^\/apis\/apiextensions\.k8s\.io\/v1\/customresourcedefinitions\/([^/]+)$/);
  if (crdMatch) {
    const c = DATA.crdByName.get(crdMatch[1]);
    return c ? ok(res, c) : notFound(res, path);
  }

  // ── Managed resource instances ────────────────────────────────────────────
  // Match: /apis/{group}/{version}/{plural}
  const mrListMatch = path.match(/^\/apis\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (mrListMatch) {
    const [, group, version, plural] = mrListMatch;
    const apiVersion = `${group}/${version}`;
    // ProviderConfigs: look up by group
    if (plural === 'providerconfigs') {
      const configs = DATA.providerConfigsByGroup.get(group) ?? [];
      return ok(res, list('ProviderConfig', apiVersion, configs));
    }
    const instances = DATA.instancesByPlural.get(plural);
    if (instances) {
      return ok(res, list(instances[0].kind, apiVersion, instances));
    }
    // Unknown plural — return empty list (Headlamp may probe random paths)
    return ok(res, { kind: 'List', apiVersion: 'v1', metadata: {}, items: [] });
  }

  // Match: /apis/{group}/{version}/{plural}/{name}
  const mrItemMatch = path.match(/^\/apis\/([^/]+)\/([^/]+)\/([^/]+)\/([^/]+)$/);
  if (mrItemMatch) {
    const [, , , , name] = mrItemMatch;
    const item = DATA.instanceByName.get(name);
    if (item) return ok(res, item);
    // Try CRD by name
    const crd = DATA.crdByName.get(name);
    if (crd) return ok(res, crd);
    return notFound(res, path);
  }

  // ── API group discovery (for dynamic group paths) ─────────────────────────
  const apiGroupMatch = path.match(/^\/apis\/([^/]+)\/([^/]+)$/);
  if (apiGroupMatch) {
    return ok(res, { kind: 'APIResourceList', groupVersion: `${apiGroupMatch[1]}/${apiGroupMatch[2]}`, resources: [] });
  }

  // ── Fallback ──────────────────────────────────────────────────────────────
  console.log(`  [unhandled] ${method} ${path}`);
  notFound(res, path);
}

// ── Start server ──────────────────────────────────────────────────────────────

const server = http.createServer(route);
server.listen(PORT, '127.0.0.1', () => {
  console.log(`\nMock k8s cluster listening on http://localhost:${PORT}`);
  console.log('\nTo add to kubeconfig, run:');
  console.log(`  node mock-cluster/server.mjs --print-kubeconfig >> ~/.kube/config`);
  console.log('\nThen in Headlamp: switch cluster → crossplane-mock\n');
});

server.on('error', err => {
  console.error('Server error:', err.message);
  process.exit(1);
});
