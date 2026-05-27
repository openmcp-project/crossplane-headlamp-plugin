# headlamp-crossplane-plugin

A [Headlamp™](https://headlamp.dev) plugin that adds a Crossplane section to the sidebar with views for Providers, Managed Resources, and Compositions.

## Development

### Prerequisites

- Node.js >= 18
- npm

### Install dependencies

```bash
npm install
```

### Local development with ui-frontend-open-source (recommended)

The fastest way to iterate is from the parent `ui-frontend-open-source` repo using the Taskfile tasks. This builds both plugins and hot-syncs them directly into the running Headlamp pod — no restart needed.

**One-time setup** (creates the kind cluster, deploys Headlamp, port-forwards to `localhost:8090`):

```bash
# from ui-frontend-open-source/
task headlamp:setup
```

**Every time you change plugin code** (builds + syncs both plugins live into the pod):

```bash
# from ui-frontend-open-source/
task headlamp:deploy-plugins
```

Then hard-refresh the browser (`Cmd+Shift+R`) to pick up the new build.

> **Important:** The build entry point is `src/index.tsx`. Do **not** edit the root `index.tsx` — it is not used by the build tool and will be ignored.

### Build for production

```bash
npm run build
# Output: dist/main.js
```

### Test locally in-cluster

1. Build the plugin:

```bash
npm run build
```

2. Create a ConfigMap from the build output:

```bash
kubectl create configmap headlamp-crossplane-plugin \
  --from-file=main.js=dist/main.js \
  --from-file=package.json=package.json \
  -n headlamp --dry-run=client -o yaml | kubectl apply -f -
```

3. Install (or upgrade) Headlamp mounting the ConfigMap as a plugin volume. Add these overrides to your local `values.local.yaml`:

```yaml
headlamp:
  volumes:
    - name: crossplane-plugin
      configMap:
        name: headlamp-crossplane-plugin
  volumeMounts:
    - name: crossplane-plugin
      mountPath: /headlamp/user-plugins/headlamp-crossplane/main.js
      subPath: main.js
    - name: crossplane-plugin
      mountPath: /headlamp/user-plugins/headlamp-crossplane/package.json
      subPath: package.json
```

```bash
helm upgrade --install headlamp ../headlamp-deployment/helm/ \
  -n headlamp --create-namespace \
  -f ../headlamp-deployment/helm/values.yaml \
  -f values.local.yaml
```

4. To iterate: rebuild, re-apply the ConfigMap, then restart the pod:

```bash
npm run build
kubectl create configmap headlamp-crossplane-plugin \
  --from-file=main.js=dist/main.js \
  --from-file=package.json=package.json \
  -n headlamp --dry-run=client -o yaml | kubectl apply -f -
kubectl rollout restart deployment headlamp -n headlamp
```

## Release

Releases are automated via GitHub Actions (`.github/workflows/release.yml`).

Push a semver tag to trigger a build and publish a GitHub Release with the plugin tarball:

```bash
git tag v1.0.0
git push origin v1.0.0
```

The workflow produces `headlamp-crossplane.tar.gz` containing `main.js` and `package.json`, which is what the Headlamp `pluginsManager` expects.

## Consuming in the deployment chart

In `headlamp-deployment` set:

```yaml
headlamp:
  pluginsManager:
    configContent: |
      plugins:
        - name: headlamp-crossplane
          source: https://github.com/<your-org>/headlamp-crossplane-plugin/releases/latest/download/headlamp-crossplane.tar.gz
```

## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/openmcp-project/crossplane-headlamp-plugin/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](https://github.com/openmcp-project/.github/blob/main/CONTRIBUTING.md).

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](https://github.com/openmcp-project/.github/blob/main/CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright © Linux Foundation Europe. OpenControlPlane is a project of NeoNephos Foundation. For applicable policies including privacy policy, terms of use and trademark usage guidelines, please see https://linuxfoundation.eu. Linux is a registered trademark of Linus Torvalds.
Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/openmcp-project/crossplane-headlamp-plugin).

<p align="center"><img alt="NeoNephos foundation logo" src="https://raw.githubusercontent.com/neonephos/.github/refs/heads/main/assets/logo.svg" width="400"/></p>
