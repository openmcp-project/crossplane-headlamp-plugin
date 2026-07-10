# Crossplane — Headlamp Plugin

A [Headlamp](https://headlamp.dev) plugin that adds a Crossplane section to the sidebar with dedicated views for managing your Crossplane resources.

## What it does

- Adds a **Crossplane** sidebar section to Headlamp
- Provides views for **Providers**, **Managed Resources**, and **Compositions**
- Integrates natively into the Headlamp UI

## Installation

Install via Headlamp's built-in plugin manager by searching for **Crossplane** on [ArtifactHub](https://artifacthub.io/packages/headlamp/crossplane-ui-plugin/headlamp_crossplane).

## Manual deploy via ConfigMap

1. Download `main.js` from the [latest release](https://github.com/openmcp-project/crossplane-ui-plugin/releases).

2. Create the ConfigMap:

   ```bash
   kubectl create configmap headlamp-crossplane-plugin \
     --from-file=main.js=main.js \
     -n headlamp --dry-run=client -o yaml | kubectl apply -f -
   ```

3. Mount it into your Headlamp deployment:

   ```yaml
   volumes:
     - name: crossplane-plugin
       configMap:
         name: headlamp-crossplane-plugin
   volumeMounts:
     - name: crossplane-plugin
       mountPath: /headlamp/plugins/headlamp-crossplane/main.js
       subPath: main.js
   ```

## Support & Contributing

Bug reports and feature requests via [GitHub Issues](https://github.com/openmcp-project/crossplane-ui-plugin/issues).
Contributions welcome — see the [Contribution Guidelines](https://github.com/openmcp-project/.github/blob/main/CONTRIBUTING.md).

## License

Copyright © Linux Foundation Europe. See [LICENSE](https://github.com/openmcp-project/crossplane-ui-plugin/blob/main/LICENSE).
