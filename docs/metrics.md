# Metrics the panel reads

The live state comes from the Kubernetes API. Prometheus adds history: the reconcile history strip (Ready bands per
Kustomization over the time range, ◆ where the revision changed) and the mean reconcile duration beside each row of the strip.
Without Prometheus the panel still works; the strip says what is missing.

All names below were checked against the docs and source on 2026-11-13 and seen in the dev stack.

## Resource state: one of two exporters

The panel asks for `flux_resource_info` first and falls back to `gotk_resource_info` when that returns nothing.

### `flux_resource_info` (Flux Operator)

Exported by the Flux Operator itself, no extra config.
Source: [Flux Operator, FluxReport metrics](https://fluxoperator.dev/docs/crd/fluxreport/#metrics) and
[instance monitoring guide](https://github.com/controlplaneio-fluxcd/flux-operator/blob/main/docs/guides/instance/instance-monitoring.md).

| Label | Used for |
| --- | --- |
| `kind`, `name`, `exported_namespace` | which object |
| `ready` (`True`/`False`/`Unknown`) | the band's state |
| `reason` | why a band is failed |
| `suspended` (`true`/`false`) | suspended bands |
| `revision` | ◆ markers |
| `uid`, `source_name`, `path`, `url`, `ref` | not used |

Query: `flux_resource_info{kind="Kustomization"[,cluster="<cluster>"]}`.

### `gotk_resource_info` (kube-state-metrics)

Plain Flux exports no resource state metrics: `gotk_reconcile_condition` and `gotk_suspend_status` were deprecated
in Flux 2.1 and removed from the controllers in Flux 2.5 ([Flux monitoring, metrics](https://fluxcd.io/flux/monitoring/metrics/),
fluxcd/kustomize-controller#1305). The documented replacement is kube-state-metrics with a custom-resource-state
config, from [fluxcd/flux2-monitoring-example](https://github.com/fluxcd/flux2-monitoring-example/blob/main/monitoring/controllers/kube-prometheus-stack/kube-state-metrics-config.yaml).

This repo ships that config in [`deploy/kube-state-metrics-config.yaml`](../deploy/kube-state-metrics-config.yaml),
cut to the seven kinds the panel reads and extended:

| Label | Upstream | Here |
| --- | --- | --- |
| `name`, `exported_namespace`, `ready`, `suspended` | all kinds | all kinds |
| `customresource_group`, `customresource_kind`, `customresource_version` | added by KSM ([docs](https://github.com/kubernetes/kube-state-metrics/blob/main/docs/metrics/extend/customresourcestate-metrics.md)) | same |
| `revision` | all kinds | all kinds |
| `reason` (Ready condition reason) | no | all kinds, same name as the operator's label |
| `source_name` | Kustomization | Kustomization, HelmRelease, HelmChart |
| `path` | no | Kustomization |
| `url`, `chart_name`, `chart_version`, ... | per kind | kept as upstream |

Query: `gotk_resource_info{customresource_kind="Kustomization"[,cluster="<cluster>"]}`.

kube-state-metrics needs `list` and `watch` on the Flux kinds (the header of the config file has the rule).

## Durations

### `gotk_reconcile_duration_seconds` (Flux controllers)

A histogram every controller exports on `:8080/metrics`, labels `kind`, `name`, `namespace`; buckets
`ExponentialBucketsRange(10e-3, 1800, 10)` ([Flux monitoring, metrics](https://fluxcd.io/flux/monitoring/metrics/),
`fluxcd/pkg/runtime/metrics/recorder.go`). The panel shows the mean over the history range:

```promql
sum by (name, exported_namespace, namespace) (rate(gotk_reconcile_duration_seconds_sum{kind="Kustomization"}[<range>]))
  / sum by (name, exported_namespace, namespace) (rate(gotk_reconcile_duration_seconds_count{kind="Kustomization"}[<range>]))
```

Prometheus must scrape the controllers (a PodMonitor on `flux-system`, as in the monitoring example). A failed
duration query does not hide the strip.

## Several clusters

Set the panel's `cluster` option; every query then gets `cluster="<value>"`. Use one panel per cluster, each with
its own Kubernetes datasource.
