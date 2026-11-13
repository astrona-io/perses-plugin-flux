# Plan

## Data model (`src/model/`)

```
fetch.ts        Kubernetes datasource ──▶ RawEstate { lists by group/kind, events } + read failures
estate.ts       RawEstate ──▶ Estate { nodes: Map<id, EstateNode>, root, operator?, report?, controllers }
state.ts        conditions + spec + revisions ──▶ FluxState (pure)
views.ts        Estate ──▶ tree layout, stages, sources, inventory, list, KPIs (pure)
delete-impact.ts Estate + target ──▶ DeleteImpact { deleted, fails, protected, data loss, by namespace } (pure)
history.ts      Prometheus ──▶ Ready bands, revision markers, mean durations per Kustomization
```

- **Node id**: `group|Kind|namespace|name`, the same key an inventory entry parses to, so inventory-only objects
  (kinds the panel does not read) still get a node, marked not live.
- **Edges**: `managedBy` (inventory, Helm labels, Kustomize labels, FluxInstance/ResourceSet inventory),
  `ownerIds` (ownerReferences), `sourceRef`, `dependsOn`.
- **State** per node, from `state.ts`: ready, reconciling, outofsync, waiting, failed, suspended, drift, disabled,
  unknown; plus `protected` (prune disabled) and a short note.

## Component tree (`src/panels/flux-gitops-chart/`)

```
FluxGitOpsChart (plugin)            options, CUE schema, settings editor
└─ FluxGitOpsChartComponent         datasource clients ──▶ useFluxData ──▶ FluxGitOpsView
   ├─ Header                        KPI tiles, view tabs, filters, delete-mode toggle, legend, problems
   ├─ delete banner
   ├─ TreeView                      real-size cards and SVG connectors in a scroll box
   ├─ OtherViews                    Stages, Sources, Inventory, List
   ├─ HistoryStrip                  Prometheus bands and markers
   └─ Drawer                        details or the delete-impact report
```

Everything derived is memoised from the estate and the options; hover changes no state.

## Schema

`schemas/panels/flux-gitops-chart/flux-gitops-chart.cue`, every option optional, closed struct, datasource
selectors constrained to `KubernetesDatasource` and `PrometheusDatasource`. Examples in `tests/valid` and
`tests/invalid`.

## Open questions, answered in DECISIONS.md

- How to read objects the Kubernetes datasource cannot read metadata-only (ConfigMaps, Secrets, CRDs): from the
  inventory, marked "not read".
- Which exporter to use for history: the operator's `flux_resource_info` first, else KSM `gotk_resource_info`.
- What deleting a FluxInstance really removes: Flux, not the workloads.
- Suspended objects at deletion: nothing is pruned.
