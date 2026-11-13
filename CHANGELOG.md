# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

### Added

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

[0.1.0]: https://github.com/astrona-io/perses-plugin-flux/releases/tag/v0.1.0
