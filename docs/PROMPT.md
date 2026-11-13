You are a senior TypeScript/React engineer and Perses contributor who knows Flux CD and the Flux Operator well. Build the Perses plugin described below in this repository (`perses-plugin-flux`). Work autonomously: plan, build, test, document. Open a PR when it's done.

---

# Part 1: What to build. Flux GitOps panel (Flux + Flux Operator)

**Repo:** `astrona-io/perses-plugin-flux`
**Plugin kind(s):** Panel `FluxGitOpsChart` (one panel with several views). Optional small query plugin if needed (see "Data").
The mockups in `docs/mockups/` show the intended views (`tree.png`, `stages.png`, `sources.png`, `inventory.png`, `list.png`, `delete-impact.png`). **Where this prompt is silent, match the mockups' behaviour, layout and styling.**

## Why
The Flux Operator's web UI shows the live state of one cluster. This panel brings Flux into Perses, next to metrics, logs and SLOs, and adds what a live UI can't:
- **history:** how long something was broken, and which commit broke it;
- **deletion impact:** what really disappears, across namespaces, if you delete or prune something;
- **several clusters** on one dashboard.
It is **read-only**. Reconcile, suspend and resume stay in the Flux web UI or `flux` CLI; the panel links there.

## Must support both
1. **Plain Flux** (installed with `flux bootstrap` or Helm): GitRepository, OCIRepository, HelmRepository, HelmChart, Bucket, Kustomization, HelmRelease. Optionally ImageRepository, ImagePolicy, ImageUpdateAutomation, Receiver, Alert/Provider as extra node kinds.
2. **Flux Operator** on top: FluxInstance (desired install: version, components, sync source), **FluxReport** (observed state: distribution version, component readiness, reconciler stats, sync status), **ResourceSet** and ResourceSetInputProvider (generated resources show as children of the ResourceSet), and links into the Flux Operator web UI.
Detect what's installed: if the Flux Operator CRDs exist, use FluxReport for the header and show FluxInstance/ResourceSets in the tree. Otherwise degrade gracefully to plain Flux. Test both in `dev/`.

## Data
Use two upstream/existing datasources. Don't build a new datasource unless you hit a hard blocker (write it in `docs/DECISIONS.md` first).

**A. Kubernetes API, live state**, through the owner's `astrona-io/perses-plugin-kubernetes` datasource (read-only, via the Perses proxy). If it isn't ready yet, build against its documented query interface and use a fixture-backed mock in tests. Read:
- Flux custom resources: `.spec` (sourceRef, path, dependsOn, suspend, prune, interval, chart/version), `.status.conditions` (Ready, Reconciling, Stalled, with reason and message), `.status.lastAppliedRevision`, `.status.lastAttemptedRevision`, the source's `.status.artifact.revision`.
- **Kustomization inventory:** `.status.inventory.entries` (every object it applied).
- **HelmRelease:** `.status.history` (Helm revisions, chart versions, status), plus the objects Helm installed, found by the labels Flux puts on them (`helm.toolkit.fluxcd.io/name` and `/namespace`; verify against current docs).
- Objects applied by kustomize-controller carry `kustomize.toolkit.fluxcd.io/name` and `/namespace` labels. Use them for ownership.
- Workloads → ReplicaSets → Pods via ownerReferences, with pod phase and container state (CrashLoopBackOff, OOMKilled).
- Kubernetes events for Flux objects (drift detected/corrected, upgrade failed, …).
- Annotations: `kustomize.toolkit.fluxcd.io/reconcile: disabled` (shown as **Reconcile disabled**) and `kustomize.toolkit.fluxcd.io/prune: disabled` (shown as **protected**, shield icon).
- Flux Operator: FluxInstance, FluxReport, ResourceSet (and its inventory).

**B. Prometheus, history and durations**
- `gotk_resource_info` from kube-state-metrics custom-resource-state config, with labels including ready, suspended, kind, name, exported_namespace. Ship the recommended KSM config in `deploy/` and extend it with `revision` and `source_name` labels.
- `gotk_reconcile_duration_seconds` from the controllers.
- If the Flux Operator exports its own resource metrics, prefer those and document which ones. **Check the current Flux and Flux Operator monitoring docs; don't guess metric or label names.**
- The **reconcile history** strip (Ready state bands per Kustomization over the time range, revision markers ◆) comes from Prometheus.

## States to show (from conditions and revisions)
| State | How to detect | Look |
|---|---|---|
| Ready | Ready=True and applied revision = source revision | green ♥ ✓ |
| Reconciling | Reconciling=True / Ready=Unknown | spinning icon, blue halo, animated flow on incoming edges |
| Out of sync | source has a newer revision than `lastAppliedRevision` | pulsing amber halo, ↻ |
| Waiting on dependency | reason DependencyNotReady | card slowly fades in and out, ◔ |
| Failed / Stalled | Ready=False (any other reason) | slow red pulse, ✕, message shown |
| Suspended | `spec.suspend: true` | ⏸ purple, static |
| Drift corrected | HelmRelease drift detection event/condition | ≠ amber |
| Reconcile disabled | object annotation | grey ⦸, dashed border |
| Protected from prune | object annotation | 🛡 |
All animations must stop under `prefers-reduced-motion`. Every state also has a text label and an icon (never colour only).

## Views (tabs inside the panel, plus a `defaultView` option)
1. **Tree (default), Argo-CD-style resource tree:** left to right, root Kustomization (or FluxInstance) → Kustomizations → HelmReleases (⎈) and plain objects → everything Helm installed → ReplicaSets → Pods. Cards have a round kind icon on the left edge, the name, health and sync icons under it, a short note (stage, chart, ready count) and a kind tag bottom-right. Thin dashed connectors. Expand/collapse per node (+N / −). Kinds with more than 2 objects under a Helm release are grouped ("8 ServiceMonitors") and expandable. Default: problems expanded, healthy branches collapsed. Real size with horizontal scroll, not shrunk.
2. **Stages:** Kustomizations ordered by their `dependsOn` chain (stage = depth), with sources on the left and `dependsOn` arrows. A failed stage marks everything after it as waiting.
3. **Sources:** a list of all sources with counters (resources delivered, Kustomizations, Helm releases, unhealthy). Show **source chains**: a source created by a Kustomization that another source delivers is indented under it ("defined in infra-controllers"). Clicking a source shows its counts, what creates it and what it creates, which Kustomizations and Helm releases it feeds, and **every resource it delivers grouped by kind down to pods**.
4. **Inventory:** everything the selected Kustomization or HelmRelease manages, grouped by kind, with breadcrumbs.
5. **List:** every Flux object in a sortable table (kind, name, namespace, stage, status, revision/chart, age).
Plus a header with KPI tiles (controllers, sources, Kustomizations, Helm releases, suspended, sync status), a legend, filters (show sources, show Helm releases, only problems), a details drawer (conditions and message, revisions with commit links, Helm history, what this blocks), and the reconcile history strip.

## Deletion impact ("What if I delete…?"), the most important feature
A toggle puts the panel in delete mode. Click any Kustomization, HelmRelease, source, ResourceSet or the root to see what would disappear **without deleting anything**. Compute it as a pure, fully unit-tested function:
- **Kustomization** with `prune: true` (respect `spec.deletionPolicy`; check the current API for its values): every object in its inventory, except objects annotated `prune: disabled`. Child HelmReleases are uninstalled, which removes everything Helm installed.
- **HelmRelease:** Helm uninstall (respect `keepHistory` and similar settings), so all objects with its Helm labels go.
- **Cascades** (repeat until nothing changes):
  - a deleted **Namespace** deletes *everything inside it*, including objects owned by other Kustomizations and objects not in Git at all (operator-created PVCs, hand-made secrets);
  - a deleted **CRD** deletes every custom resource of that type in every namespace;
  - operator-owned workloads go with their custom resource (e.g. Prometheus → StatefulSet), via ownerReferences;
  - a protected Namespace (`prune: disabled`) stops the cascade.
- **Source:** nothing is deleted, but every consumer fails. Show that.
- **Root Kustomization / FluxInstance:** everything.
- **ResourceSet:** its generated objects and their cascades.
Show it impossible to miss:
- a red banner: "57 objects disappear if you delete Kustomization infra-configs, across 3 namespaces. 53 belong to other Kustomizations or to nobody. 2 volumes of data lost.";
- hatched red overlays and badges on every node in every view: will be deleted, loses objects, will fail;
- a report in the drawer: cross-namespace cascade (and through what), data loss (PVCs), what was protected, what fails afterwards, deleted objects grouped by namespace with a "not yours" count;
- "make it safe" tips: `prune: disabled` on Namespaces and CRDs; keep a Namespace in the same Kustomization as its workloads; preview with `flux tree kustomization <name>` / `flux diff kustomization`; suspend first.

## Spec (options → CUE schema)
- `kubernetesDatasource`, `prometheusDatasource` (selectors), `cluster` label for multi-cluster
- `namespaces` filter, `rootKustomization` (default auto: `flux-system`)
- `defaultView`: tree | stages | sources | inventory | list
- `showSources`, `showHelmReleases`, `onlyProblems`, `showPods`, `groupThreshold` (default 2)
- `historyRange` (default dashboard range), `showHistory`
- `fluxWebUIUrl` (link template for the Flux Operator web UI), `gitCommitUrl` (template with `${revision}`, `${repo}`)
- `enableDeleteImpact` (default true)

## Acceptance criteria
- `dev/`: a kind cluster with Flux **and** a second profile with the Flux Operator (FluxInstance + FluxReport + one ResourceSet), Prometheus with the KSM config, Perses with this plugin, the owner's Kubernetes datasource, and a Git or OCI source with a staged setup like the mockups': crds → controllers → configs (which defines Namespaces for other stages) → monitoring (a deliberately failing Helm upgrade) → apps (waiting), plus one suspended Kustomization, one `reconcile: disabled` object, one `prune: disabled` Namespace and an operator-created PVC. Provide a script that pushes a new commit so you can watch the states animate.
- The state mapping is a pure function, unit-tested against real condition fixtures from Flux and Flux Operator objects.
- The deletion-impact engine is a pure function, unit-tested for every cascade above, including the mockups' infra-configs case (cross-namespace, data loss, protected namespace) and the CRD case.
- Tree with 300 nodes stays smooth; collapse and grouping work; horizontal scroll works.
- Works with plain Flux only, Flux Operator only (as installed by it), and both. Missing permissions show a clear message instead of an empty panel.
- Light and dark theme. Reduced motion respected. Readable without colour.
- README: what it shows, the RBAC it needs (read-only, Flux CRDs + Flux Operator CRDs + the objects in inventories + events), the KSM config, Flux vs Flux Operator differences, and screenshots of every view.

## The plugin family this belongs to
This repo is part of the `astrona-io` Perses plugin set. Already built (read them before you start, and match their structure, tooling, CI and README style):
`perses-plugin-oat-results`, `perses-plugin-sankey`, `perses-plugin-statetimeline`, `perses-plugin-honeycomb`, `perses-plugin-geomap`, `perses-plugin-servicegraph`, plus `perses-plugin-kubernetes` (datasource), all under https://github.com/astrona-io.
Reuse the servicegraph plugin's graph and pan/zoom code where it fits; reuse statetimeline for the history strip if its API allows.

---

# Part 2: How to build it (Perses plugin guide)

You are building a **Perses plugin** in this repository. Perses is the CNCF
dashboard project (https://github.com/perses/perses). Its core plugins live in
https://github.com/perses/plugins.


## Ground rules

1. **Copy upstream conventions; don't invent your own.** Before writing code, clone
   `perses/plugins` next to this repo and read 2–3 plugins close to this one.
   Panels: `timeserieschart`, `statushistorychart`, `heatmapchart`, `table`.
   Datasources: `prometheus`, `tempo`, `victorialogs`.
   Match their folder layout, `package.json` (including the `perses` section),
   the CUE schema layout, and the rsbuild / module-federation config.
2. **Scaffold with percli. Never hand-build the directory structure.** Install
   `percli` from the Perses GitHub releases (or `brew install perses/tap/percli`).
   Then check the real flags with `percli plugin --help` and
   `percli plugin generate --help`. Flags change between releases, so don't
   trust memory or this file over `--help`.
   - `percli plugin generate …` scaffolds the module or plugin
   - `percli plugin start` runs it against a local Perses dev server
   - `percli plugin test-schemas` validates the CUE schemas and JSON examples
   - `percli plugin build` produces the distributable archive
3. **Use the latest stable Perses release.** Pin `@perses-dev/*` package versions
   to the release you develop against. Write that release in the README.
4. **Use the shared building blocks:**
   - `@perses-dev/plugin-system` for plugin types and hooks (`useDataQueries`,
     time range, variables)
   - `@perses-dev/components` for UI pieces, legends, tooltips and the ECharts wrapper
   - `@perses-dev/core` for value formatting, units and thresholds
   - Reuse the shared CUE types (`common.#format`, `common.#thresholds`, …) in schemas
5. **Theme-aware only.** No hard-coded colours. Use the MUI theme and the Perses
   chart theme so light and dark mode both work.
6. **Accessibility.** Status must never be shown by colour alone. Use icon,
   label or pattern too. Everything clickable must be reachable by keyboard.
7. **Performance.** Stay smooth at the "large" size named in Part 1.
   Memoise transforms. Don't re-render on hover.
8. **Licence.** Apache-2.0, same as Perses. Only add dependencies with
   compatible licences. Prefer libraries already used upstream (ECharts, MUI).
9. **Stay upstreamable.** Write it so it could be offered to `perses/plugins`
   later: same code style, lint config, tests and docs format. Before you start,
   search `perses/plugins` issues and PRs for this plugin. If someone is already
   building it, stop and report that.

## Local dev environment

Add a `dev/` folder with a `docker-compose.yaml` that starts:
- Perses (official image)
- the data backend this plugin needs (usually Prometheus)
- a **fake-data generator** that emits the metrics, logs or API responses in
  Part 1, with realistic labels and some failure cases

Also provision a demo dashboard that uses the plugin (`dev/dashboards/*.json`),
so `docker compose up` followed by `percli plugin start` shows it working.

## Definition of done

- [ ] Scaffolded with `percli`. Layout matches upstream plugins.
- [ ] CUE schema plus at least one JSON example. `percli plugin test-schemas` passes.
- [ ] Grafana migration (`migrate/` CUE) if Part 1 names a Grafana equivalent.
- [ ] Panel options editor for every option in the spec, with sensible defaults.
- [ ] Unit tests (Jest + React Testing Library) for data transforms and rendering.
      Cover the empty state, error state and large-data cases.
- [ ] Works in light and dark theme. Includes screenshots of both in `docs/`.
- [ ] `percli plugin build` produces an archive. CI builds it on every PR.
- [ ] A GitHub Actions release workflow attaches the archive to a GitHub release on `v*` tags.
- [ ] README covers what it does, install, the data it expects, the options, a screenshot,
      and the Perses version it was tested with.
- [ ] Every acceptance criterion in Part 1 is checked off in the PR description.

## Working style

- Plan first. Write `docs/PLAN.md` covering the data model, component tree,
  schema and open questions before writing code.
- Use small commits with conventional messages (`feat:`, `fix:`, `docs:`, `test:`).
- If something in Part 1 is unclear or seems wrong, record your decision in
  `docs/DECISIONS.md` and keep going. Don't stop for the sake of it.
