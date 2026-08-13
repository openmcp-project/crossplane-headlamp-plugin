# headlamp-crossplane-plugin

A [Headlamp™](https://headlamp.dev) plugin that adds a Crossplane section to the sidebar with views for Providers, Managed Resources, and Compositions.

## Development

### Prerequisites

- Node.js >= 18
- npm
- `kind`, `kubectl`, `helm` (for local cluster)

```bash
npm install
```

### Local development (recommended)

The cluster setup and plugin iteration is managed centrally from the `ui-frontend` repo. Both this plugin and the kiosk plugin are built and synced together.

**One-time setup** (creates the kind cluster, deploys Headlamp with latest ArtifactHub plugin releases, port-forwards to `localhost:8090`):

```bash
# from ui-frontend/ or from this repo
task dev
```

**Every time you change plugin code** (builds + hot-syncs all local plugins into the pod, no restart needed):

```bash
# from ui-frontend/ or from this repo
task update
```

Then hard-refresh the browser (`Cmd+Shift+R`) to pick up the new build.

> **Important:** The build entry point is `src/index.tsx`. Do **not** edit the root `index.tsx` — it is not used by the build tool and will be ignored.

### Offline development (no cluster required)

A standalone mock server under `mock-cluster/` mimics the Kubernetes/Crossplane API so you can develop and test the plugin UI without a live cluster.

**Start the mock server:**

```bash
task mock              # small landscape (~10 resources, default)
task mock:medium       # ~30 resources
task mock:large        # ~120 resources, 4 providers
```

On first run the server adds a `crossplane-mock` entry to `~/.kube/config`. Open Headlamp, select the `crossplane-mock` cluster, and the plugin loads against the mock data.

### Build for production

```bash
npm run build
# Output: dist/main.js
```

## Release

Trigger a release via the [GitHub Actions release workflow](../../actions/workflows/release.yml) by clicking **Run workflow** and entering the semver version (e.g. `v0.1.0`). The workflow:

- Checks the tag doesn't already exist
- Builds the plugin and uploads `main.js` + a `headlamp-crossplane-<version>.tar.gz` as GitHub Release assets
- Creates the git tag and GitHub Release with auto-generated notes
- Opens a PR with the updated `artifacthub/<version>/artifacthub-pkg.yml` — merge it to complete the ArtifactHub publish

Once the PR is merged, the plugin is installable via Headlamp's plugin manager using its ArtifactHub URL.

> **First-time setup:** See the [ArtifactHub Headlamp plugins documentation](https://artifacthub.io/docs/topics/repositories/headlamp-plugins/). Register the repository on [artifacthub.io](https://artifacthub.io) (type: Headlamp, packages URL: `https://github.com/openmcp-project/crossplane-ui-plugin/artifacthub`), then fill in the `repositoryID` and owner email in `artifacthub/artifacthub-repo.yml`.

## Support, Feedback, Contributing

This project is open to feature requests/suggestions, bug reports etc. via [GitHub issues](https://github.com/openmcp-project/crossplane-headlamp-plugin/issues). Contribution and feedback are encouraged and always welcome. For more information about how to contribute, the project structure, as well as additional contribution information, see our [Contribution Guidelines](https://github.com/openmcp-project/.github/blob/main/CONTRIBUTING.md).

## Code of Conduct

We as members, contributors, and leaders pledge to make participation in our community a harassment-free experience for everyone. By participating in this project, you agree to abide by its [Code of Conduct](https://github.com/openmcp-project/.github/blob/main/CODE_OF_CONDUCT.md) at all times.

## Licensing

Copyright © Linux Foundation Europe. OpenControlPlane is a project of NeoNephos Foundation. For applicable policies including privacy policy, terms of use and trademark usage guidelines, please see https://linuxfoundation.eu. Linux is a registered trademark of Linus Torvalds.
Please see our [LICENSE](LICENSE) for copyright and license information. Detailed information including third-party components and their licensing/copyright information is available [via the REUSE tool](https://api.reuse.software/info/github.com/openmcp-project/crossplane-headlamp-plugin).

<p align="center"><img alt="NeoNephos foundation logo" src="https://raw.githubusercontent.com/neonephos/.github/refs/heads/main/assets/logo.svg" width="400"/></p>
