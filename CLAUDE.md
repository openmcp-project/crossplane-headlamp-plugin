# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install        # Install dependencies
npm start          # Dev server with hot-reload (requires running Headlamp instance)
npm run build      # Production build → dist/main.js
```

There are no lint or test scripts configured.

## Architecture

This is a [Headlamp](https://headlamp.dev) plugin that provides a UI for managing [Crossplane](https://crossplane.io) providers and their managed resources.

### Plugin System Integration

Headlamp plugins are bundled into a single `dist/main.js` file. The plugin registers itself in [index.tsx](index.tsx) using:
- `registerSidebarEntry()` — adds entries under a "Crossplane" sidebar section
- `registerRoute()` — maps URL paths to React components

All MUI components are accessed via `window.pluginLib.MuiCore` (injected by Headlamp at runtime, not imported). React Router hooks (`useHistory`, `useParams`) are also injected by Headlamp.

### Sidebar & Route Structure

```
Crossplane
├── Overview      → /crossplane/overview
├── Providers     → /crossplane/providers
│   └── /:name                          (ProviderDetail)
│       └── /resources/:group/:plural   (ManagedList)
│           └── /:name                  (ManagedDetail, cluster-scoped)
│           └── /:namespace/:name       (ManagedDetail, namespaced)
└── Resources     → /crossplane/resources
```

All routes include a cluster prefix (`/c/<cluster-name>`) for multi-cluster support. Use `clusterPrefix()` from [src/helpers/index.tsx](src/helpers/index.tsx) to build cross-component links.

### Key Source Files

- [src/common/Resources.tsx](src/common/Resources.tsx) — `KubeObject` subclasses for Crossplane CRs: `Provider`, `ProviderRevision`, `CompositeResourceDefinition`, `Composition`
- [src/helpers/index.tsx](src/helpers/index.tsx) — shared utilities: CRD discovery, status helpers, API proxy compatibility, routing helpers
- [src/providers/](src/providers/) — Provider list and detail views
- [src/managed/](src/managed/) — Managed resource list and detail views
- [src/resources/](src/resources/) — Browse all provider CRDs across providers
- [src/overview/](src/overview/) — Crossplane overview dashboard

### Data Flow

1. **Provider discovery**: `Provider.useList()` fetches `pkg.crossplane.io/v1` Provider CRs
2. **CRD discovery**: `useCRDsForProvider()` reads `ProviderRevision.status.objectRefs` (preferred) or falls back to `useCRDsForGroup()` which filters cluster CRDs by API group
3. **Managed resource instances**: `useCustomResourceList()` in ManagedList queries the API via `ApiProxy`, auto-trying versions `v1alpha1 → v1beta1 → v1`

### Status Conditions

Conditions are color-coded: `True` = green (`#4caf50`), `False` = red (`#f44336`), `Unknown` = orange (`#ff9800`). Use `getConditionStatus()`, `getReadyStatus()`, `getSyncedStatus()` from helpers.

### API Proxy Compatibility

`getApiProxy()` in helpers handles a breaking change in Headlamp v0.39+ where `ApiProxy` moved. Always use this wrapper instead of importing `ApiProxy` directly.

## Deployment

- **Dev**: `npm start` — Headlamp picks up changes via file watch
- **Production**: `npm run build` produces `dist/main.js`; packaged as a tarball (`main.js` + `package.json`)
- **Distribution**: Via Helm ConfigMap/volumes or Headlamp's plugin manager using the tarball URL
- **Releases**: CI builds on git tags matching `v*` and creates a GitHub Release with the tarball
