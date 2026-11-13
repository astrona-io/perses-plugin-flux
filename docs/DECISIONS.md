# Decisions

Where the spec in [PROMPT.md](PROMPT.md) was silent, unclear or did not fit, this records what was done and why.
Every Flux fact cites the doc page or, where the docs are silent, the source file it was read from (all checked
2026-11-13 against `main`). "Seen in the dev stack" means Flux v2.10.0 and Flux Operator v0.62.1 on kind with
Kubernetes v1.37.0.

## Spec deviations

| Spec says | Done instead | Why |
| --- | --- | --- |
| Jest + React Testing Library | Vitest + React Testing Library (jsdom) | The sibling plugins (`perses-plugin-kubernetes`, `-servicegraph`, `-honeycomb`) and the `percli plugin generate` scaffold for Perses v0.55.1 use Vitest. Same API, one tool across the family. |
| `dev/docker-compose.yaml` | `dev/up.sh <profile>`: a kind cluster per profile | Flux, the Flux Operator and kube-state-metrics need a real API server, CRDs and controllers. A compose file with a fake-data generator could not show real conditions, inventories, Helm drift or events. The kind clusters run under podman (`KIND_EXPERIMENTAL_PROVIDER=podman`). |
| Fake-data generator | A real fleet pushed as OCI artifacts to a local registry, plus `dev/push-commit.sh` | The states come from the controllers themselves. `push-commit.sh <profile> healthy\|broken\|bump` pushes a new commit so the states change. |
| Grafana migration | None | Part 1 names no Grafana equivalent. Flux's Grafana dashboards are time series and tables over the same metrics, not a resource tree. |
| Reuse servicegraph's graph and pan/zoom | Own tree layout, opening at real size on a canvas with our own pan and zoom (CSS transform, no dependency), top to bottom by default, left to right as an option | The spec asks for real size, not shrunk. servicegraph lays out a force/ELK graph and zooms it to fit, which shrinks cards. A tree layout is a few dozen lines (`src/model/views.ts`, `layoutTree`) and stays testable as a pure function. Since 0.3.0 the canvas pans and zooms (large estates needed it); it still opens at 100%, and Fit to view never zooms past 100%. See [Tree navigation](#tree-navigation). |
| Reuse statetimeline for the history strip | Own small SVG strip (`HistoryStrip.tsx`) | statetimeline is a panel plugin, not an exported component, and needs its own query. The strip draws Ready bands and revision markers (◆) per Kustomization from one Prometheus query. |
| Optional query plugin | None | The panel reads both datasources directly: the Kubernetes datasource's list client and Prometheus via `useDatasourceClient`. No new datasource or query kind was needed. |

## Gaps in perses-plugin-kubernetes v0.1.0

That repo was not changed (HEAD `1d75842`). Every workaround below is read-only, goes through the Perses proxy and
lives in this plugin.

1. **Fixed `Accept: application/json` header** (`src/datasources/kubernetes-datasource/KubernetesDatasource.tsx` L40).
   No `PartialObjectMetadataList`, so there is no metadata-only read. The panel therefore does not list ConfigMaps,
   Secrets, ServiceAccounts, CRDs or arbitrary custom resources: that would pull their full bodies (Secret data
   included) through the proxy. Inventory entries of those kinds are drawn from the inventory id alone, dashed, with
   the note "not read". Delete impact still counts them, because the inventory says they exist.
2. **No HTTP status on errors** (L54 throws `new Error(message)`). The panel classifies failures from the message
   (`src/model/fetch.ts`, `classifyError`): the API server's `... is forbidden` (403), `the server could not find the
   requested resource` (404, CRD not installed), and the Perses proxy's own two 403s (see below).
3. **List paths only** (L64). No GET of a single object, so the drawer shows what the list returned.
4. **Paging limit 500, `maxItems` default 5000, then truncated, no watch.** The panel passes `maxItems`, reports
   truncated lists in a warning and refreshes on the dashboard's refresh interval.
5. **The proxy needs the API server's IP as a /32.** In Perses v0.55.1, `datasource.proxy.allowed_networks:
   [10.96.0.0/16]` refused `10.96.0.1` (log: "the IP address 10.96.0.1 is part of a denied network") while allowing
   Prometheus in the same /16. Adding `10.96.0.1/32` fixed it (`dev/k8s/perses.yaml`). The panel recognises the
   proxy's message (`the datasource destination is not allowed by the Perses server configuration`) and shows one
   error that says how to find the IP, instead of one line per list.

## Reading Flux

- **State mapping** (`src/model/state.ts`) is a pure function of conditions, spec and revisions, in this order:
  suspended (`spec.suspend`), reconcile disabled (annotation or label `kustomize.toolkit.fluxcd.io/reconcile:
  disabled`, matched case-insensitively), Ready=False with reason `DependencyNotReady` = waiting, Stalled=True or
  Ready=False = failed, Reconciling=True or Ready=Unknown = reconciling, drift, out of sync, Ready=True = ready.
  Condition types and reasons: [Kustomization API, Status](https://fluxcd.io/flux/components/kustomize/kustomizations/#kustomization-status),
  [HelmRelease API, Conditions](https://fluxcd.io/flux/components/helm/helmreleases/#conditions),
  `fluxcd/helm-controller/api/v2/condition_types.go`.
- **HelmRelease revision** comes from `status.history[0].chartVersion`. The v2 status type has no
  `lastAppliedRevision` (`fluxcd/helm-controller/api/v2/helmrelease_types.go`); history is newest first
  ([HelmRelease API, History](https://fluxcd.io/flux/components/helm/helmreleases/#history)).
- **Out of sync**: a Kustomization whose `lastAppliedRevision` differs from its source's
  `status.artifact.revision`, while not reconciling.
- **OCI sources and commit links.** Seen in the dev stack: an OCIRepository's `artifact.revision` is
  `latest@sha256:<digest>`; the Git commit is in `artifact.metadata["org.opencontainers.image.revision"]`
  (`main@sha1:<sha>`) and the repository in `org.opencontainers.image.source`; a Kustomization carries it as
  `status.lastAppliedOriginRevision`. The drawer shows that as "Commit" and builds `gitCommitUrl` from it.
- **Drift.** helm-controller 1.6+ sets `Drifted=True/DriftDetected` ([HelmRelease API, Drift detection](https://fluxcd.io/flux/components/helm/helmreleases/#drift-detection)).
  Seen in the dev stack with `driftDetection.mode: enabled`: after the correction the condition is
  `Drifted=False/NoDriftDetected` within seconds, and only the events remain (Warning `DriftDetected`, Normal
  `DriftCorrected`). So a release also shows **Drift corrected** for one hour after either event.
- **Ownership**: the Kustomization inventory (`status.inventory.entries[].id` = `<ns>_<name>_<group>_<kind>`, parsed
  from the right, `__` decodes to `:`; [Kustomization API, Inventory](https://fluxcd.io/flux/components/kustomize/kustomizations/#inventory),
  `fluxcd/cli-utils/pkg/object/objmetadata.go`), then the HelmRelease inventory (helm-controller 1.5+, Flux 2.8+;
  [HelmRelease API, Inventory](https://fluxcd.io/flux/components/helm/helmreleases/#inventory)), then the labels
  `helm.toolkit.fluxcd.io/name|namespace` (`fluxcd/helm-controller/internal/postrender/common_renderer.go`) and
  `kustomize.toolkit.fluxcd.io/name|namespace` (`fluxcd/pkg/ssa/manager.go`, `SetOwnerLabels`), then
  ownerReferences. Before Flux 2.8 a HelmRelease has no inventory; the labels still find what it installed.
- **A HelmChart is shown under its HelmRelease.** source-controller creates it as `<hr-namespace>-<hr-name>` in the
  source's namespace (seen: `flux-system/monitoring-metrics-gateway`).
- **Stages** are the depth in the `dependsOn` graph; the tree also orders Kustomizations by stage. A cycle does not
  hang (tested).

## Delete impact

`src/model/delete-impact.ts` is a pure function over the estate; `delete-impact.test.ts` covers each case.

- **Kustomization**, by `spec.deletionPolicy` ([Kustomization API, Deletion policy](https://fluxcd.io/flux/components/kustomize/kustomizations/#deletion-policy)):
  `MirrorPrune` (default) deletes the inventory only with `prune: true`; `Delete` and `WaitForTermination` always
  delete it; `Orphan` deletes nothing. Objects annotated `kustomize.toolkit.fluxcd.io/prune: disabled` stay.
- **A suspended Kustomization or HelmRelease deletes nothing when deleted**, and objects annotated
  `kustomize.toolkit.fluxcd.io/reconcile: disabled` are never pruned. For suspension the docs are silent; the controller skips the
  garbage collection when `spec.suspend` is true (`finalizerShouldDeleteResources`,
  `fluxcd/kustomize-controller/internal/controller/kustomization_controller.go`) and helm-controller only uninstalls
  "if the resource has not been suspended" (`fluxcd/helm-controller/internal/controller/helmrelease_controller.go`).
  The report says so.
- **HelmRelease**: uninstall removes everything with its inventory or labels, except objects annotated
  `helm.sh/resource-policy: keep` (Helm behaviour, not in the Flux docs) and CRDs from `crds/` (the HelmRelease API
  quotes Helm: no support for deleting CRDs). `uninstall.keepHistory` keeps release history only, not objects.
- **FluxInstance deletion removes Flux, not workloads.** The operator docs say it uninstalls Flux "without affecting
  any Flux-managed workloads"; the uninstaller removes the finalizers from all Flux objects first
  (`controlplaneio-fluxcd/flux-operator/internal/controller/fluxinstance_uninstaller.go`). So the report lists the
  Flux objects and controllers that go and marks the workloads as left behind, unmanaged.
- **ResourceSet** garbage-collects what it generated, except `fluxcd.controlplane.io/prune: disabled`
  ([ResourceSet, Garbage collection](https://fluxoperator.dev/docs/crd/resourceset/)).
- **Cascades** repeat until nothing changes: a Namespace takes everything in it (also objects of other owners and
  objects in no inventory); a CRD takes every custom resource of its kind; ownerReferences take dependents. A
  protected Namespace stops its cascade.
- **Sources** delete nothing; every consumer is marked "will fail".

## Flux resources view

`src/model/flux-resources.ts` is a pure function over the estate and the read failures; the view is
`FluxResourcesView.tsx`. Field names were checked against `controlplaneio-fluxcd/flux-operator` `main` on 2026-11-13.

- **With the Flux Operator, the numbers are the operator's.** The FluxReport `spec`
  (`api/v1/fluxreport_types.go`, [FluxReport docs](https://fluxoperator.dev/docs/crd/fluxreport/)):
  `distribution{version,status,entitlement,managedBy}`, `cluster{serverVersion,platform,nodes}`,
  `operator{apiVersion,version,platform}`, `components[]{name,ready,status,image}`,
  `reconcilers[]{apiVersion,kind,stats{running,failing,suspended,totalSize}}` and `sync{id,path,ready,status,source}`.
  The only accepted FluxReport name is `flux` (a CEL rule on the type). The report is refreshed on the operator's
  interval, so the view says it can lag a few minutes.
- **The FluxInstance adds what was asked for** (`api/v1/fluxinstance_types.go`,
  [FluxInstance docs](https://fluxoperator.dev/docs/crd/fluxinstance/)): `spec.distribution{version,registry,artifact}`,
  `spec.components[]`, `spec.sync{kind,url,ref,path}`, and from status `lastAppliedRevision`, `lastAttemptedRevision`,
  `lastArtifactRevision` and `components[]{name,repository,tag,digest}`. Ready comes from its conditions, as on every
  node.
- **Reconciler stats, as the operator counts them** (`internal/reporter/reconcilers.go`): `running` is total minus
  suspended, so the view's Total is `running + suspended`; `failing` is Ready=False with a reason other than
  `DependencyNotReady`, not suspended; suspension wins over the Ready condition; `totalSize` is the sum of
  `status.artifact.size`. Components (`internal/reporter/components.go`) are the Deployments in the operator's
  namespace, Ready when kstatus says Current, status `"<kstatus> <message>"`, image of the first container.
- **Without the operator, the panel counts.** Controllers are the live `apps/Deployment`s whose name matches the
  Flux controllers (ready/desired replicas, first container image, tag as the version). Per-kind counts are the
  panel's display states bucketed: Ready (ready, drift corrected, reconcile disabled), Reconciling (reconciling, out
  of sync), Waiting, Failed, Suspended; Unknown is in Total only. They cover only the namespaces the panel reads, and
  the view says so.
- **A failed read shows its error, never zeros.** A list that failed (forbidden, proxy, network) gives that kind a
  "Not read" row with the message, and a failed Deployment list replaces the controllers table with the error. A 404
  means the API is not served and says "not installed". The operator installed but no FluxReport is a warning, not
  an empty table.
- **Reconcile rate and mean duration per kind** come from Prometheus when the Prometheus datasource is set:
  `sum by (kind) (rate(gotk_reconcile_duration_seconds_count[<range>]))` and `…_sum / …_count`, one point at the end
  of the dashboard range. Only this tab runs the query.

## Metrics and Prometheus

See [metrics.md](metrics.md). In short: `flux_resource_info` from the Flux Operator is preferred, else
`gotk_resource_info` from kube-state-metrics, and `gotk_reconcile_duration_seconds` for durations. The shipped KSM
config (`deploy/kube-state-metrics-config.yaml`) is the upstream one from `fluxcd/flux2-monitoring-example`, cut to
the seven kinds the panel reads and extended with `reason` on every kind, `path` on Kustomization and `source_name`
on HelmRelease and HelmChart (upstream already has `revision` and `source_name` on Kustomization).

## Chart updates

- **Not available with the Kubernetes datasource v0.1.0.** Its schema refuses every `allowedEndpoints` pattern that
  contains `proxy` (`kubernetes-datasource.cue`), and Perses rejects the whole datasource when one does. So
  `deploy/kubernetes-datasource.json` and `deploy/rbac.yaml` leave the index path and the `services/proxy` rule out,
  and the cells show "✕ no access". The design below stays in the code for a datasource release that admits this one
  exact, operator-supplied path.

- **Read the index source-controller already serves, not the chart repository.** A HelmRepository's
  `status.artifact.url` points at source-controller's own Service. The panel reads it through the Kubernetes API
  service proxy (`/api/v1/namespaces/<ns>/services/source-controller:80/proxy/<path>`) via the datasource's Perses
  proxy URL. No new network egress from Perses, no credentials for private chart repositories, and the versions are
  the ones Flux itself sees.
- **Security**: this is the one subresource the panel uses. The RBAC rule is `get` on `services/proxy` with
  `resourceNames: [source-controller, source-controller:80]` (the API server authorizes a service proxy request
  against the Service name; both forms are listed so it works whichever the API server passes). The allow-list
  pattern only admits `GET .../services/source-controller:80/proxy/helmrepository/<ns>/<name>/index-<hex>.yaml`, so
  charts, Git/OCI artifacts and other Services stay unreachable even with a broader RBAC grant. The panel builds the
  path from the artifact URL and refuses to request anything that does not match the same pattern
  (`INDEX_PROXY_PATH` in `src/model/chart-updates.ts`).
- **Plain fetch on the datasource's proxy URL**: the Kubernetes datasource client only lists, with a JSON Accept
  header; the index is YAML. The reader takes `options.datasourceUrl` from the datasource client, so it goes through
  the same Perses proxy and allow-list.
- **Lazy, at most once per digest**: the index can be tens of MB for large public repositories. It is read only when
  the List view is open (all HelmReleases) or a HelmRelease's drawer is (that one), only for HelmRepositories that
  back a HelmRelease. The request path contains the index digest, so it changes exactly when source-controller
  fetched a new index. A module cache keyed by datasource and HelmRepository holds the parsed version lists (not the
  text) for the current path; a new digest replaces the entry, a newly needed chart re-reads with the union, and a
  failed read is retried after a minute on the next refresh.
- **Parsing**: a JSON index is parsed whole. A YAML index is cut by a line scan to the block of each needed chart
  under `entries:` (the layout Helm and source-controller write), which is then parsed; a full YAML parse is the
  fallback only for indexes up to 2 MB.
- **Dependencies**: [`yaml`](https://github.com/eemeli/yaml) (no dependencies, YAML 1.2, maintained) for the
  index, loaded with a dynamic import only when an index is read; [`semver`](https://github.com/npm/node-semver)
  (npm's own) for comparison and ranges. Both were already in the lockfile as transitive dependencies. Flux uses
  Masterminds/semver, whose `,` (AND) becomes a space for node-semver; anything node-semver cannot read is shown as
  "range unknown" rather than guessed.
- **Prereleases** count only when the installed version is one, like Helm's default constraint handling.
- **Not checked, said so**: OCI HelmRepositories and `chartRef` to an OCIRepository (versions are registry tags),
  `chartRef` to a HelmChart, and charts from a GitRepository or Bucket (no index of versions). The cell says "not
  checked" with the reason; it never claims "newest".
- **Errors are errors**: a refused RBAC or allow-list check, a NetworkPolicy, a missing chart or artifact all show
  "✕ no access" / "✕ not read" with the message and, for the first two, which `deploy/` file fixes it.
- **Option `checkChartUpdates`** (default `true`) turns it off without changing RBAC.

## Panel internals

- **Prometheus is queried with `useDatasourceClient`**, not `useTimeSeriesQueries`, because the panel has no query
  editor: both datasources are options of the panel.
- **The datasource pickers exclude variables**: the panel needs one concrete datasource of each kind.
- **The view remounts when an option that seeds state changes** (`defaultView`, `treeDirection`, `onlyProblems`, the
  filters), so the editor preview follows the options.

## Tree navigation

One big tree of a whole fleet was hard to read, so the tree tab is a set of pages with a breadcrumb.

- **The first page is the top-level Flux objects**: every Flux object (source, Kustomization, HelmRelease,
  ResourceSet, input provider) that no other Flux object manages. "Managed" is the same parent the tree always used:
  inventory (`managedBy`), then ownerReferences. The "start" (the root Kustomization, the FluxInstance, and the
  Kustomization(s) the FluxInstance syncs, which apply everything else) is not a card: on a Flux Operator cluster the
  FluxInstance would otherwise be the only card on the first page. Objects the start applies count as top level.
  FluxReports are never cards. `topLevel` and `treePath` in `src/model/views.ts` hold the rules.
- **No Flux object is ever dropped.** A repository can manage itself through a loop: a ResourceSet generates
  Kustomizations, one of which (through others) applies the ResourceSet again. Every member then has a parent, none is
  top level, and before 0.3.0 the loop and everything under it was unreachable. `childIndex` now cuts every loop above
  one entry, chosen by kind (FluxInstance, ResourceSet, Kustomization, HelmRelease, then name), and that entry shows at
  the top level. Only objects a FluxInstance actually applies (its inventory) count as start; an object whose parent
  could not be found is not folded into the start any more. As a last check, `topLevel` adds any Flux object not
  reachable from the top level.
- **The namespace selector filters Flux objects only, in the browser.** It lists the namespaces that hold Flux
  objects; an object whose parent is outside the selection shows at the top level, and plain objects under a shown
  Flux object always show. It is separate from the `namespaces` option, which limits what the panel reads.
- **The start stays reachable**: a "Flux root" link in the tree bar opens its drawer (and, in delete mode, picks it
  as the target), so the root's inventory and delete impact are still one click away.
- **The first page is a wrapping grid, not a tree**: there are no edges between top-level objects, and a grid shows
  many more of them per screen in both directions. Each card says how many objects are under it.
- **Clicking a card with children opens its page**: that object at the top, always open, and its children laid out as
  before (problem branches open, healthy ones collapsed, grouping, filters). A card that opens a page has a "›" and
  its accessible name ends in "open its page". The breadcrumb ("All resources › flux-system/apps › observability")
  lists the parents up to the start; every crumb is a button back to that page, the last is `aria-current="page"`.
- **The drawer moved to an "i" button on cards that open a page** ("Details of flux-system/apps (Kustomization)").
  Clicking the card navigates, which is the common action; the button keeps the drawer one click away, is a real
  `<button>` in the tab order, and works with Enter and Space. Cards without children still open the drawer on click.
  In delete mode pages do not open: a click picks the delete target, as before, and the breadcrumb still works.
- **Grouping splits leaves from branches.** Under one parent, children with nothing below them (no children, no
  page) go into one mixed box ("12 resources", kind chips, state counts), closed by default; children with their own
  children are grouped by kind ("15 Kustomizations", ready, failing and suspended counts), open by default, so
  sub-branches stay together. Both apply above `groupThreshold`. Failing leaves stay outside the box as their own
  cards, and a group with a failing member opens and takes the failing colour, so a problem is never folded away. In
  delete mode a group card shows the worst impact among its members.
- **A source's page shows what uses it**: the Kustomizations and HelmReleases whose `sourceRef` points at it, one
  level unfolded. A source has no children in the ownership tree, so without this its page would be empty.
- **Sources tab, double-click a row** to open that source's page in the tree tab. Double-click is not reachable from a
  keyboard, so each row also has a "Show in tree ›" button with the same effect. A single click still opens the
  drawer.
- **Direction is a view choice, not a layout choice.** `layoutTree` returns depth (level) and leaf slot (row) only;
  `TreeView` maps them to x/y. Top to bottom (`treeDirection: vertical`) is the default; left to right stays
  available as a toggle in the tree bar and as the option. Cards keep their size in both directions.
- **Pan and zoom are ours, about 200 lines** (`usePanZoom.ts`): a CSS transform on the canvas, wheel and pinch zoom on
  the cursor, drag to pan, Fit to view (also double-click on empty canvas), 100%, and the keys `+`, `−` and `0`. A
  pointer that moves more than 4 px is a drag, and the click that ends it is swallowed, so a drag never opens a page.
  Every page opens at 100%, top left. A pan/zoom library would add a dependency for this little.
- **Module federation shares what the percli scaffold shares** (React, `@emotion/*`, the `@perses-dev/*` packages);
  MUI is bundled, as in the upstream plugins. The theme reaches the panel through the shared emotion context.

## Dev stack and allow-list

- **The fleet is an OCI artifact in a local registry** (`flux push artifact`), so no Git server is needed. The Flux
  Operator profile patches the FluxInstance's OCIRepository with `insecure: true` through `spec.kustomize.patches`
  ([FluxInstance, Kustomize patches](https://fluxoperator.dev/docs/crd/fluxinstance/)) because the registry is plain
  HTTP.
- **The allow-list lives in `deploy/kubernetes-datasource.json`** and is checked in CI by a Go test that uses Go's
  `regexp`, the engine the Perses proxy uses: every path the panel requests must match, and writes, other methods,
  secrets, configmaps, subresources and path tricks must not.
