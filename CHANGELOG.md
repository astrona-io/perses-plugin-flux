# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

## [0.2.0] - 2026-11-13

### Added

- **Flux resources view** (`defaultView: flux`): the Flux installation, its controllers and per-kind counts by
  state. With the Flux Operator it reads the FluxInstance and the FluxReport (`components`, `reconcilers`, `sync`);
  without it, the controller Deployments and the panel's own counts. It names its source, shows a failed read as an
  error instead of zero, and adds reconciles per minute and mean duration per kind from
  `gotk_reconcile_duration_seconds` when Prometheus is set.
- Chart updates for HelmReleases: a "Chart update" column in the List view and a row in the drawer
  (`1.2.3 → 1.4.0`, in range or needs a bump). Read from the Helm repository index source-controller already
  serves, through the API server's service proxy, lazily and once per index digest. New option
  `checkChartUpdates` (default `true`). Adds the `yaml` and `semver` dependencies.
  **Known limitation:** the Kubernetes datasource v0.1.0 refuses allow-list patterns that contain `proxy`, so the
  index cannot be read yet and every cell shows "✕ no access" (set `checkChartUpdates: false` to hide them). The
  shipped `deploy/rbac.yaml` and `deploy/kubernetes-datasource.json` do not grant the index path.
- Tree pages: the tree tab opens on the top-level Flux objects (those no other Flux object manages); clicking a card
  with children opens its page, and a breadcrumb ("All resources › flux-system/apps › …") leads back. A "Flux root"
  link keeps the root's drawer reachable.
- Tree direction: top to bottom (default) or left to right, as a toggle in the tree tab and the panel option
  `treeDirection: vertical | horizontal`.
- Sources tab: double-click a source, or use its "Show in tree ›" button, to open its page in the tree with
  everything that uses it unfolded.

### Changed

- Cards that open a page have an "i" button for the details drawer; clicking the card itself navigates.
- The tree is top to bottom by default (it was left to right).

## [0.1.0] - 2026-11-13

### Added

- `FluxGitOpsChart` panel: Flux and Flux Operator objects as a tree, stages, sources, inventory and a
  sortable list, with KPI tiles, a legend, filters, a details drawer and a reconcile history strip.
- Deletion impact ("What if I delete…?"): a pure, unit-tested engine for Kustomizations (deletion
  policy, `prune: disabled`), HelmReleases, sources, ResourceSets, FluxInstances and the root, with
  Namespace, CRD and ownerReference cascades, shown as a banner, overlays and a report.
- Live state through the Kubernetes datasource (astrona-io/perses-plugin-kubernetes), history through
  Prometheus: the Flux Operator's `flux_resource_info`, or `gotk_resource_info` from kube-state-metrics.
- `deploy/`: read-only RBAC, the datasource allow-list, and an extended kube-state-metrics config.
- A `dev/` stack with two profiles (plain Flux, Flux Operator) and a staged fleet with every state.

[Unreleased]: https://github.com/astrona-io/perses-plugin-flux/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/astrona-io/perses-plugin-flux/releases/tag/v0.2.0
[0.1.0]: https://github.com/astrona-io/perses-plugin-flux/releases/tag/v0.1.0
