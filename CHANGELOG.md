# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/).

## [Unreleased]

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
