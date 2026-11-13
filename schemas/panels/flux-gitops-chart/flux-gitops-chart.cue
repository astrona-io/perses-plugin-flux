package model

// A datasource selector, as Perses writes it: the plugin kind and, optionally, the datasource name.
#selector: close({
	kind:  string
	name?: string
})

// A duration such as 30m, 6h, 1d or 2w.
#duration: =~"^[0-9]+(ms|s|m|h|d|w|y)$"

kind: "FluxGitOpsChart"
spec: close({
	// Kubernetes API, live state (astrona-io/perses-plugin-kubernetes). Default: the project's default KubernetesDatasource.
	kubernetesDatasource?: #selector & {kind: "KubernetesDatasource"}
	// Prometheus, history and durations. Default: the project's default PrometheusDatasource.
	prometheusDatasource?: #selector & {kind: "PrometheusDatasource"}
	// Value of the `cluster` label in Prometheus queries, for dashboards with several clusters. Supports $variables.
	cluster?: string
	// Only these namespaces (cluster-scoped objects are always shown). Empty: all namespaces.
	namespaces?: [...string]
	// The root Kustomization, `name` or `namespace/name`. `auto` (default) means flux-system/flux-system.
	rootKustomization?: string
	defaultView?:       "tree" | "stages" | "sources" | "inventory" | "list" | "flux"
	// Tree layout: parents above their children (`vertical`, default) or left of them (`horizontal`).
	treeDirection?:    "vertical" | "horizontal"
	showSources?:      bool
	showHelmReleases?: bool
	onlyProblems?:     bool
	showPods?:         bool
	// Kinds with more objects than this under one parent are grouped ("8 ServiceMonitors"). Default 2.
	groupThreshold?: int & >=1 & <=100
	// Time range of the history strip. Default: the dashboard's time range.
	historyRange?: #duration
	showHistory?:  bool
	// Link template into the Flux Operator web UI, e.g. https://flux.example.com/resource/${kind}/${namespace}/${name}
	fluxWebUIUrl?: string
	// Commit link template with ${revision} and ${repo}, e.g. https://${repo}/commit/${revision}
	gitCommitUrl?:       string
	enableDeleteImpact?: bool
	// Compare each HelmRelease's chart version with its HelmRepository index, read from source-controller
	// through the API server's service proxy. Needs the services/proxy rule in deploy/rbac.yaml. Default true.
	checkChartUpdates?: bool
})
