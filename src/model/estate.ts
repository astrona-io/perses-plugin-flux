// Builds the panel's object graph (the "estate") from raw Kubernetes lists: every Flux object,
// every object a Kustomization, HelmRelease, ResourceSet or FluxInstance manages (from inventories
// and ownership labels), and the workloads, ReplicaSets and Pods under them (from ownerReferences).
// Pure: the fetch layer hands it plain lists, tests hand it fixtures.

import type { Condition, CrossRef, KubeEvent, KubeObject } from './kube';
import { arr, conditionOf, groupOf, num, rec, str } from './kube';
import {
  HELM_NAME,
  HELM_NAMESPACE,
  KUSTOMIZE_NAME,
  KUSTOMIZE_NAMESPACE,
  RESOURCESET_NAME,
  RESOURCESET_NAMESPACE,
  isHelmKept,
  isPruneDisabled,
  isReconcileDisabled,
} from './labels';
import type { FluxState, PodStatusInput, StateResult } from './state';
import { mapPodState, mapState, mapWorkloadState } from './state';

export type FluxRole =
  | 'source'
  | 'kustomization'
  | 'helmrelease'
  | 'fluxinstance'
  | 'fluxreport'
  | 'resourceset'
  | 'inputprovider'
  | 'image'
  | 'notification';

export interface HelmRevision {
  version?: number;
  chartName?: string;
  chartVersion?: string;
  appVersion?: string;
  status?: string;
  action?: string;
  lastDeployed?: string;
}

export interface EstateNode {
  /** `<group>|<kind>|<namespace>|<name>`; group and namespace may be empty. */
  id: string;
  group: string;
  kind: string;
  namespace: string;
  name: string;
  /** The Flux role, for Flux and Flux Operator objects. */
  role?: FluxRole;
  state: FluxState;
  reason?: string;
  message?: string;
  /** A short line for cards (chart version, ready count, pod reasons...). */
  note?: string;
  /** True when the object was read from the API; false when only an inventory entry names it. */
  live: boolean;
  createdAt?: string;
  /** `prune: disabled`: Flux never deletes it. */
  protected: boolean;
  /** `reconcile: disabled`: Flux leaves it alone. */
  reconcileDisabled: boolean;
  /** `helm.sh/resource-policy: keep`: Helm keeps it on uninstall. */
  helmKeep: boolean;
  /** The Flux object that applied it (Kustomization, HelmRelease, ResourceSet or FluxInstance). */
  managedBy?: string;
  /** ownerReferences, as ids (the owner may not be in the estate). */
  ownerIds: string[];
  conditions?: Condition[];
  // Flux objects
  suspended?: boolean;
  sourceRef?: string;
  dependsOn?: string[];
  inventory?: string[];
  prune?: boolean;
  deletionPolicy?: string;
  path?: string;
  interval?: string;
  url?: string;
  chart?: string;
  chartVersion?: string;
  /** The chart version range: `spec.chart.spec.version` on a HelmRelease, `spec.version` on a HelmChart. */
  chartRange?: string;
  /** For a HelmRepository: `spec.type` (`default`, i.e. HTTP, or `oci`). */
  repoType?: string;
  /** For a source: `status.artifact.url`, where source-controller serves the artifact in the cluster. */
  artifactUrl?: string;
  appliedRevision?: string;
  attemptedRevision?: string;
  sourceRevision?: string;
  /**
   * The Git commit behind an OCI or Bucket artifact: `lastAppliedOriginRevision` on a
   * Kustomization, the `org.opencontainers.image.revision` artifact metadata on a source.
   */
  originRevision?: string;
  /** The `org.opencontainers.image.source` artifact metadata: the Git repository behind an OCI artifact. */
  originUrl?: string;
  helmHistory?: HelmRevision[];
  keepHistory?: boolean;
  /** For HelmReleases: the HelmChart helm-controller made for it. */
  helmChart?: string;
  // Kubernetes objects
  /** For a CRD: `<group>/<plural>` it defines. */
  defines?: { group: string; plural: string };
  /** For a PersistentVolumeClaim: the requested size. */
  storage?: string;
  /** For a Deployment, StatefulSet or DaemonSet: ready and desired replicas, and the container images. */
  replicas?: { ready: number; desired: number };
  images?: string[];
  events?: KubeEvent[];
}

/**
 * The FluxReport's `spec` (fluxcd.controlplane.io/v1, `api/v1/fluxreport_types.go` in
 * controlplaneio-fluxcd/flux-operator). Stats are undefined when the report leaves them out, never 0.
 */
export interface FluxReportSummary {
  id: string;
  name: string;
  namespace: string;
  distribution?: { version?: string; status?: string; entitlement?: string; managedBy?: string };
  components: Array<{ name: string; image?: string; ready: boolean; status?: string }>;
  reconcilers: Array<{
    kind: string;
    apiVersion?: string;
    running?: number;
    failing?: number;
    suspended?: number;
    totalSize?: string;
  }>;
  sync?: { id?: string; path?: string; source?: string; status?: string; ready: boolean };
  operatorVersion?: string;
  operatorPlatform?: string;
  cluster?: { serverVersion?: string; platform?: string; nodes?: number };
}

/** The FluxInstance's spec and status (fluxcd.controlplane.io/v1, `api/v1/fluxinstance_types.go`). */
export interface FluxInstanceSummary {
  id: string;
  /** `spec.distribution`: the version (semver range), registry and optional distribution artifact. */
  version?: string;
  registry?: string;
  artifact?: string;
  /** `spec.components`: the controllers it installs. */
  components: string[];
  /** `spec.sync`: the source Flux syncs the cluster from. */
  sync?: { kind?: string; url?: string; ref?: string; path?: string };
  lastAppliedRevision?: string;
  lastAttemptedRevision?: string;
  lastArtifactRevision?: string;
  /** `status.components`: the images it applied. */
  images: Array<{ name: string; repository?: string; tag?: string; digest?: string }>;
}

export interface Estate {
  nodes: Map<string, EstateNode>;
  /** The root: the FluxInstance (operator) or the root Kustomization, if found. */
  root?: string;
  report?: FluxReportSummary;
  instance?: FluxInstanceSummary;
  /** Controllers: from the FluxReport, or from the Flux Deployments. */
  controllers: { ready: number; total: number };
  /** Which optional APIs answered (Flux Operator, image automation...). */
  operator: boolean;
}

/** Everything the fetch layer read, keyed by resource (see `RESOURCES` in fetch.ts). */
export interface RawEstate {
  lists: Record<string, KubeObject[]>;
  events?: KubeEvent[];
}

export interface BuildOptions {
  /** Name of the root Kustomization; `auto` (or empty) means flux-system. */
  rootKustomization?: string;
  /** Only objects in these namespaces (cluster-scoped objects always pass). Empty: all. */
  namespaces?: string[];
  /** Events newer than this (ms since epoch) count as recent, for drift. */
  now?: number;
}

const FLUX_GROUPS: Record<string, FluxRole> = {
  'source.toolkit.fluxcd.io': 'source',
  'source.extensions.fluxcd.io': 'source',
  'kustomize.toolkit.fluxcd.io': 'kustomization',
  'helm.toolkit.fluxcd.io': 'helmrelease',
  'image.toolkit.fluxcd.io': 'image',
  'notification.toolkit.fluxcd.io': 'notification',
};

const OPERATOR_KINDS: Record<string, FluxRole> = {
  FluxInstance: 'fluxinstance',
  FluxReport: 'fluxreport',
  ResourceSet: 'resourceset',
  ResourceSetInputProvider: 'inputprovider',
};

export function nodeId(group: string, kind: string, namespace: string, name: string): string {
  return `${group}|${kind}|${namespace}|${name}`;
}

export function parseId(id: string): { group: string; kind: string; namespace: string; name: string } {
  const [group = '', kind = '', namespace = '', ...rest] = id.split('|');
  return { group, kind, namespace, name: rest.join('|') };
}

/**
 * An inventory entry id: `<namespace>_<name>_<group>_<kind>`. The namespace is empty for
 * cluster-scoped objects, the group for the core API; a `:` in a name is written `__`.
 * Parsed from the right, as fluxcd/cli-utils does.
 */
export function parseInventoryId(entry: string): string | undefined {
  const k = entry.lastIndexOf('_');
  if (k <= 0) return undefined;
  const kind = entry.slice(k + 1);
  const rest = entry.slice(0, k);
  const g = rest.lastIndexOf('_');
  if (g < 0) return undefined;
  const group = rest.slice(g + 1);
  const nsName = rest.slice(0, g);
  const n = nsName.indexOf('_');
  if (n < 0 || kind === '') return undefined;
  const namespace = nsName.slice(0, n);
  const name = nsName.slice(n + 1).replaceAll('__', ':');
  if (name === '') return undefined;
  return nodeId(group, kind, namespace, name);
}

export function roleOf(group: string, kind: string): FluxRole | undefined {
  if (group === 'fluxcd.controlplane.io') return OPERATOR_KINDS[kind];
  const role = FLUX_GROUPS[group];
  if (role === 'source' || role === undefined) return role;
  return role;
}

/** English plurals the way CRDs usually spell them; used to match custom resources to their CRD. */
export function pluralCandidates(kind: string): string[] {
  const k = kind.toLowerCase();
  const out = [k, `${k}s`, `${k}es`];
  if (k.endsWith('y')) out.push(`${k.slice(0, -1)}ies`);
  return out;
}

function crossRefId(ref: CrossRef | undefined, defaultNamespace: string, group: string): string | undefined {
  if (ref === undefined || ref.name === undefined || ref.name === '') return undefined;
  const g = ref.apiVersion !== undefined ? groupOf(ref.apiVersion) : group;
  return nodeId(g, ref.kind ?? '', ref.namespace ?? defaultNamespace, ref.name);
}

const SOURCE_GROUP = 'source.toolkit.fluxcd.io';

function sourceGroupFor(kind: string | undefined): string {
  if (kind === 'ExternalArtifact') return SOURCE_GROUP;
  return SOURCE_GROUP;
}

function asCrossRef(value: unknown): CrossRef | undefined {
  const r = rec(value);
  const name = str(r?.name);
  if (r === undefined || name === undefined) return undefined;
  return { name, kind: str(r.kind), namespace: str(r.namespace), apiVersion: str(r.apiVersion) };
}

function inventoryIds(obj: KubeObject): string[] | undefined {
  const inv = rec(obj.status?.inventory);
  if (inv === undefined) return undefined;
  const ids: string[] = [];
  for (const e of arr(inv.entries)) {
    const id = str(rec(e)?.id);
    const parsed = id === undefined ? undefined : parseInventoryId(id);
    if (parsed !== undefined) ids.push(parsed);
  }
  return ids;
}

function baseNode(obj: KubeObject, group: string, kind: string): EstateNode {
  const md = obj.metadata ?? {};
  const namespace = md.namespace ?? '';
  const name = md.name ?? '';
  return {
    id: nodeId(group, kind, namespace, name),
    group,
    kind,
    namespace,
    name,
    state: 'unknown',
    live: true,
    createdAt: md.creationTimestamp,
    protected: isPruneDisabled(md.annotations) || isPruneDisabled(md.labels),
    reconcileDisabled: isReconcileDisabled(md.annotations) || isReconcileDisabled(md.labels),
    helmKeep: isHelmKept(md.annotations),
    ownerIds: (md.ownerReferences ?? []).map((o) => nodeId(groupOf(o.apiVersion), o.kind, namespace, o.name)),
  };
}

function setState(node: EstateNode, result: StateResult & { note?: string }): void {
  node.state = result.state;
  node.reason = result.reason;
  node.message = result.message;
  if (result.note !== undefined) node.note = result.note;
}

/** Fills the Flux-specific fields of a Flux or Flux Operator node. */
function fluxFields(node: EstateNode, obj: KubeObject, role: FluxRole): void {
  const spec = obj.spec ?? {};
  const status = obj.status ?? {};
  node.role = role;
  node.conditions = status.conditions;
  node.suspended = spec.suspend === true;
  node.interval = str(spec.interval);
  node.url = str(spec.url) ?? str(spec.endpoint);
  node.dependsOn = arr(spec.dependsOn)
    .map((d) => asCrossRef(d))
    .filter((d): d is CrossRef => d !== undefined)
    .map((d) => nodeId(node.group, d.kind ?? node.kind, d.namespace ?? node.namespace, d.name));
  if (node.dependsOn.length === 0) delete node.dependsOn;
  const inventory = inventoryIds(obj);
  if (inventory !== undefined) node.inventory = inventory;
  node.appliedRevision = str(status.lastAppliedRevision);
  node.attemptedRevision = str(status.lastAttemptedRevision);
  const artifact = rec(status.artifact);
  if (role === 'source') {
    node.appliedRevision = str(artifact?.revision);
    node.artifactUrl = str(artifact?.url);
  }
  node.originRevision = str(status.lastAppliedOriginRevision);
  const artifactMeta = rec(artifact?.metadata);
  if (role === 'source' && artifactMeta !== undefined) {
    node.originRevision = str(artifactMeta['org.opencontainers.image.revision']);
    node.originUrl = str(artifactMeta['org.opencontainers.image.source']);
  }

  if (role === 'kustomization') {
    node.sourceRef = crossRefId(asCrossRef(spec.sourceRef), node.namespace, SOURCE_GROUP);
    if (node.sourceRef !== undefined) {
      const ref = parseId(node.sourceRef);
      node.sourceRef = nodeId(sourceGroupFor(ref.kind), ref.kind, ref.namespace, ref.name);
    }
    node.prune = spec.prune === true;
    node.deletionPolicy = str(spec.deletionPolicy) ?? 'MirrorPrune';
    node.path = str(spec.path);
    if (node.path !== undefined) node.note = node.path;
  }

  if (role === 'helmrelease') {
    const chartSpec = rec(rec(spec.chart)?.spec);
    const chartRef = asCrossRef(spec.chartRef);
    if (chartRef !== undefined) {
      node.sourceRef = nodeId(
        SOURCE_GROUP,
        chartRef.kind ?? 'OCIRepository',
        chartRef.namespace ?? node.namespace,
        chartRef.name,
      );
    } else if (chartSpec !== undefined) {
      const ref = asCrossRef(chartSpec.sourceRef);
      if (ref !== undefined)
        node.sourceRef = nodeId(SOURCE_GROUP, ref.kind ?? '', ref.namespace ?? node.namespace, ref.name);
      node.chart = str(chartSpec.chart);
      node.chartRange = str(chartSpec.version);
    }
    const helmChart = str(status.helmChart);
    if (helmChart !== undefined && helmChart.includes('/')) {
      const [ns = '', name = ''] = helmChart.split('/');
      node.helmChart = nodeId(SOURCE_GROUP, 'HelmChart', ns, name);
    }
    node.helmHistory = arr(status.history).map((h) => {
      const r = rec(h) ?? {};
      return {
        version: num(r.version),
        chartName: str(r.chartName),
        chartVersion: str(r.chartVersion),
        appVersion: str(r.appVersion),
        status: str(r.status),
        action: str(r.action),
        lastDeployed: str(r.lastDeployed),
      };
    });
    const latest = node.helmHistory[0];
    node.chart = node.chart ?? latest?.chartName;
    node.chartVersion = latest?.chartVersion;
    // helm-controller v2 has no lastAppliedRevision: the newest history entry is what runs.
    node.appliedRevision = latest?.chartVersion;
    node.keepHistory = rec(spec.uninstall)?.keepHistory === true;
    const target = str(spec.targetNamespace);
    const parts = [node.chart, node.chartVersion].filter((p): p is string => p !== undefined);
    if (parts.length > 0) node.note = parts.join(' ');
    if (target !== undefined && target !== node.namespace) node.note = `${node.note ?? ''} → ${target}`.trim();
  }

  if (role === 'source') {
    if (node.kind === 'HelmChart') {
      node.chart = str(spec.chart);
      node.chartRange = str(spec.version);
      const ref = asCrossRef(spec.sourceRef);
      if (ref !== undefined) node.sourceRef = nodeId(SOURCE_GROUP, ref.kind ?? '', node.namespace, ref.name);
    }
    if (node.kind === 'HelmRepository') node.repoType = str(spec.type) ?? 'default';
    node.note = node.appliedRevision;
  }

  if (role === 'resourceset') {
    node.dependsOn = undefined;
    const providers = arr(spec.inputsFrom)
      .map((p) => asCrossRef(p))
      .filter((p): p is CrossRef => p !== undefined)
      .map((p) => nodeId('fluxcd.controlplane.io', p.kind ?? 'ResourceSetInputProvider', node.namespace, p.name));
    if (providers.length > 0) node.sourceRef = providers[0];
    node.note = `${node.inventory?.length ?? 0} resources`;
  }

  if (role === 'fluxinstance') {
    const distribution = rec(spec.distribution);
    node.note = `Flux ${str(distribution?.version) ?? ''}`.trim();
    const sync = rec(spec.sync);
    node.url = str(sync?.url);
    node.path = str(sync?.path);
    node.appliedRevision = str(status.lastAppliedRevision);
    // The operator's own reconcile switch is an annotation, not spec.suspend.
    node.suspended = obj.metadata?.annotations?.['fluxcd.controlplane.io/reconcile'] === 'disabled';
  }

  if (role === 'inputprovider') {
    node.url = str(spec.url);
    node.note = str(spec.type);
  }
}

function workloadState(node: EstateNode, obj: KubeObject): void {
  const spec = obj.spec ?? {};
  const status = obj.status ?? {};
  let desired = 0;
  let ready = 0;
  let updated: number | undefined;
  if (node.kind === 'DaemonSet') {
    desired = num(status.desiredNumberScheduled) ?? 0;
    ready = num(status.numberReady) ?? 0;
    updated = num(status.updatedNumberScheduled);
  } else {
    desired = num(spec.replicas) ?? 1;
    ready = num(status.readyReplicas) ?? 0;
    updated = node.kind === 'ReplicaSet' ? undefined : (num(status.updatedReplicas) ?? 0);
  }
  setState(node, mapWorkloadState(desired, ready, updated));
  node.note = `${ready}/${desired}`;
  if (node.kind !== 'ReplicaSet') {
    node.replicas = { ready, desired };
    const containers = arr(rec(rec(rec(spec.template)?.spec))?.containers);
    const images = containers.map((c) => str(rec(c)?.image)).filter((i): i is string => i !== undefined);
    if (images.length > 0) node.images = images;
  }
}

function matchesNamespaces(namespace: string, filter: string[] | undefined): boolean {
  if (filter === undefined || filter.length === 0 || namespace === '') return true;
  return filter.includes(namespace);
}

function kindFromList(key: string, obj: KubeObject): { group: string; kind: string } {
  // Items in a list response usually omit apiVersion/kind: the fetch layer keys lists by
  // `<group>/<Kind>` so the kind is known either way.
  const slash = key.lastIndexOf('/');
  return { group: groupOf(obj.apiVersion) || key.slice(0, slash), kind: obj.kind ?? key.slice(slash + 1) };
}

function addInventoryOnly(nodes: Map<string, EstateNode>, id: string): EstateNode {
  const existing = nodes.get(id);
  if (existing !== undefined) return existing;
  const p = parseId(id);
  const node: EstateNode = {
    id,
    ...p,
    state: 'unknown',
    live: false,
    protected: false,
    reconcileDisabled: false,
    helmKeep: false,
    ownerIds: [],
  };
  const role = roleOf(p.group, p.kind);
  if (role !== undefined) node.role = role;
  if (p.kind === 'CustomResourceDefinition') node.defines = crdDefines(p.name);
  nodes.set(id, node);
  return node;
}

function crdDefines(name: string): { group: string; plural: string } | undefined {
  const dot = name.indexOf('.');
  if (dot <= 0) return undefined;
  return { plural: name.slice(0, dot), group: name.slice(dot + 1) };
}

function eventTime(e: KubeEvent): number {
  const t =
    e.series?.lastObservedTime ?? e.lastTimestamp ?? e.eventTime ?? e.firstTimestamp ?? e.metadata?.creationTimestamp;
  const ms = t === undefined ? Number.NaN : Date.parse(t);
  return Number.isNaN(ms) ? 0 : ms;
}

const DRIFT_WINDOW_MS = 60 * 60 * 1000;

/** Builds the estate. Unknown kinds, missing fields and dangling references are tolerated. */
export function buildEstate(raw: RawEstate, options: BuildOptions = {}): Estate {
  const nodes = new Map<string, EstateNode>();
  const objects = new Map<string, KubeObject>();
  let report: FluxReportSummary | undefined;
  let instance: FluxInstanceSummary | undefined;
  let operator = false;
  const now = options.now ?? Date.now();

  for (const [key, list] of Object.entries(raw.lists)) {
    for (const obj of list) {
      const { group, kind } = kindFromList(key, obj);
      const node = baseNode(obj, group, kind);
      if (node.name === '' || !matchesNamespaces(node.namespace, options.namespaces)) continue;
      const role = roleOf(group, kind);
      if (group === 'fluxcd.controlplane.io') operator = true;
      if (role !== undefined) fluxFields(node, obj, role);
      if (kind === 'CustomResourceDefinition') node.defines = crdDefines(node.name);
      if (kind === 'PersistentVolumeClaim') {
        node.storage = str(rec(rec(obj.spec?.resources)?.requests)?.storage);
        node.note = node.storage;
      }
      if (role === 'fluxreport') report = summariseReport(obj, node.id);
      if (role === 'fluxinstance' && instance === undefined) instance = summariseInstance(obj, node.id);
      nodes.set(node.id, node);
      objects.set(node.id, obj);
    }
  }

  // Events per involved object.
  for (const e of raw.events ?? []) {
    const io = e.involvedObject;
    if (io?.kind === undefined || io.name === undefined) continue;
    const id = nodeId(groupOf(io.apiVersion), io.kind, io.namespace ?? '', io.name);
    const node = nodes.get(id);
    if (node === undefined) continue;
    (node.events ??= []).push(e);
  }
  for (const node of nodes.values()) node.events?.sort((a, b) => eventTime(b) - eventTime(a));

  // Ownership: inventories first (exact), then labels (for objects Flux applied but the inventory
  // was not readable, and for Helm releases without an inventory).
  for (const node of Array.from(nodes.values())) {
    if (node.inventory === undefined) continue;
    if (
      node.role !== 'kustomization' &&
      node.role !== 'helmrelease' &&
      node.role !== 'resourceset' &&
      node.role !== 'fluxinstance'
    )
      continue;
    for (const id of node.inventory) {
      const child = addInventoryOnly(nodes, id);
      if (child.managedBy === undefined && child.id !== node.id) child.managedBy = node.id;
    }
  }
  for (const node of nodes.values()) {
    if (node.managedBy !== undefined || !node.live) continue;
    const labels = objects.get(node.id)?.metadata?.labels ?? {};
    const owner =
      labelOwner(labels, HELM_NAME, HELM_NAMESPACE, 'helm.toolkit.fluxcd.io', 'HelmRelease') ??
      labelOwner(labels, RESOURCESET_NAME, RESOURCESET_NAMESPACE, 'fluxcd.controlplane.io', 'ResourceSet') ??
      labelOwner(labels, KUSTOMIZE_NAME, KUSTOMIZE_NAMESPACE, 'kustomize.toolkit.fluxcd.io', 'Kustomization');
    if (owner !== undefined && owner !== node.id) node.managedBy = owner;
  }
  // helm-controller creates a HelmRelease's HelmChart (status.helmChart) and deletes it with the release.
  for (const node of nodes.values()) {
    if (node.role !== 'helmrelease' || node.helmChart === undefined) continue;
    const chart = nodes.get(node.helmChart);
    if (chart !== undefined && chart.managedBy === undefined) chart.managedBy = node.id;
  }

  // States. Sources first, so Kustomizations and HelmReleases can compare revisions.
  for (const node of nodes.values()) {
    const obj = objects.get(node.id);
    if (obj === undefined || node.role === undefined) continue;
    if (node.role === 'source' || node.role === 'inputprovider' || node.role === 'fluxreport') {
      setState(node, mapState(stateInput(node, obj)));
    }
  }
  for (const node of nodes.values()) {
    const obj = objects.get(node.id);
    if (obj === undefined) continue;
    if (
      node.role !== undefined &&
      node.role !== 'source' &&
      node.role !== 'inputprovider' &&
      node.role !== 'fluxreport'
    ) {
      const input = stateInput(node, obj);
      if (node.role === 'kustomization' && node.sourceRef !== undefined) {
        node.sourceRevision = nodes.get(node.sourceRef)?.appliedRevision;
        input.sourceRevision = node.sourceRevision;
      }
      if (node.role === 'helmrelease') {
        const chartSource = node.helmChart ?? node.sourceRef;
        const src = chartSource === undefined ? undefined : nodes.get(chartSource);
        // Only a HelmChart or OCIRepository revision is a chart version comparable to history[0].
        if (src?.kind === 'HelmChart') node.sourceRevision = src.appliedRevision?.split('+')[0];
        input.sourceRevision = node.sourceRevision;
        input.appliedRevision = node.appliedRevision;
        input.driftCorrected = driftCorrected(node, now);
      }
      setState(node, mapState(input));
      if (node.role === 'kustomization' && node.state === 'ready' && node.reconcileDisabled) node.state = 'disabled';
    } else if (node.role === undefined) {
      plainState(node, obj);
    }
  }

  // Inventory-only objects: the panel did not read them, so they inherit their manager's sync state.
  for (const node of nodes.values()) {
    if (node.live) continue;
    const manager = node.managedBy === undefined ? undefined : nodes.get(node.managedBy);
    if (
      manager !== undefined &&
      (manager.state === 'ready' || manager.state === 'outofsync' || manager.state === 'drift')
    ) {
      node.state = manager.state === 'drift' ? 'ready' : manager.state;
    }
    node.note = node.note ?? 'not read';
  }

  const root = findRoot(nodes, options.rootKustomization);
  return { nodes, root, report, instance, controllers: controllerCount(nodes, report), operator };
}

function labelOwner(
  labels: Record<string, string>,
  nameKey: string,
  namespaceKey: string,
  group: string,
  kind: string,
): string | undefined {
  const name = labels[nameKey];
  const namespace = labels[namespaceKey];
  if (name === undefined || namespace === undefined) return undefined;
  return nodeId(group, kind, namespace, name);
}

function stateInput(node: EstateNode, obj: KubeObject): Parameters<typeof mapState>[0] {
  return {
    conditions: obj.status?.conditions,
    suspended: node.suspended,
    generation: obj.metadata?.generation,
    observedGeneration: num(obj.status?.observedGeneration),
    appliedRevision: node.role === 'source' ? undefined : node.appliedRevision,
  };
}

/**
 * Drift: the Drifted condition (helm-controller 1.6+), or a recent DriftDetected or DriftCorrected event.
 * With `driftDetection.mode: enabled`, helm-controller corrects the drift and the next reconcile sets
 * Drifted=False (NoDriftDetected), so after a correction only the events remain (seen on Flux v2.10.0).
 */
function driftCorrected(node: EstateNode, now: number): boolean {
  const drifted = node.conditions?.find((c) => c.type === 'Drifted');
  if (drifted?.status === 'True') return true;
  return (node.events ?? []).some(
    (e) => (e.reason === 'DriftDetected' || e.reason === 'DriftCorrected') && now - eventTime(e) < DRIFT_WINDOW_MS,
  );
}

function plainState(node: EstateNode, obj: KubeObject): void {
  switch (node.kind) {
    case 'Deployment':
    case 'StatefulSet':
    case 'DaemonSet':
    case 'ReplicaSet':
      workloadState(node, obj);
      break;
    case 'Pod':
      setState(node, mapPodState((obj.status ?? {}) as PodStatusInput));
      break;
    case 'PersistentVolumeClaim':
      node.state = obj.status?.phase === 'Bound' ? 'ready' : 'reconciling';
      break;
    case 'Namespace':
      node.state = obj.status?.phase === 'Terminating' ? 'reconciling' : 'ready';
      break;
    default: {
      const ready = conditionOf(obj, 'Ready') ?? conditionOf(obj, 'Available');
      if (ready !== undefined) setState(node, mapState({ conditions: [{ ...ready, type: 'Ready' }] }));
      else node.state = 'ready';
    }
  }
  if (node.reconcileDisabled) {
    node.note = node.note ?? 'reconcile disabled';
    if (node.state === 'ready') node.state = 'disabled';
  }
}

function summariseReport(obj: KubeObject, id: string): FluxReportSummary {
  const spec = obj.spec ?? {};
  const distribution = rec(spec.distribution);
  const sync = rec(spec.sync);
  const operator = rec(spec.operator);
  const cluster = rec(spec.cluster);
  return {
    id,
    name: obj.metadata?.name ?? 'flux',
    namespace: obj.metadata?.namespace ?? '',
    distribution:
      distribution === undefined
        ? undefined
        : {
            version: str(distribution.version),
            status: str(distribution.status),
            entitlement: str(distribution.entitlement),
            managedBy: str(distribution.managedBy),
          },
    components: arr(spec.components).map((c) => {
      const r = rec(c) ?? {};
      return { name: str(r.name) ?? '?', image: str(r.image), ready: r.ready === true, status: str(r.status) };
    }),
    reconcilers: arr(spec.reconcilers).map((c) => {
      const r = rec(c) ?? {};
      const stats = rec(r.stats) ?? {};
      return {
        kind: str(r.kind) ?? '?',
        apiVersion: str(r.apiVersion),
        running: num(stats.running),
        failing: num(stats.failing),
        suspended: num(stats.suspended),
        totalSize: str(stats.totalSize),
      };
    }),
    sync:
      sync === undefined
        ? undefined
        : {
            id: str(sync.id),
            path: str(sync.path),
            source: str(sync.source),
            status: str(sync.status),
            ready: sync.ready === true,
          },
    operatorVersion: str(operator?.version),
    operatorPlatform: str(operator?.platform),
    cluster:
      cluster === undefined
        ? undefined
        : { serverVersion: str(cluster.serverVersion), platform: str(cluster.platform), nodes: num(cluster.nodes) },
  };
}

function summariseInstance(obj: KubeObject, id: string): FluxInstanceSummary {
  const spec = obj.spec ?? {};
  const status = obj.status ?? {};
  const distribution = rec(spec.distribution);
  const sync = rec(spec.sync);
  return {
    id,
    version: str(distribution?.version),
    registry: str(distribution?.registry),
    artifact: str(distribution?.artifact),
    components: arr(spec.components)
      .map((c) => str(c))
      .filter((c): c is string => c !== undefined),
    sync:
      sync === undefined
        ? undefined
        : { kind: str(sync.kind), url: str(sync.url), ref: str(sync.ref), path: str(sync.path) },
    lastAppliedRevision: str(status.lastAppliedRevision),
    lastAttemptedRevision: str(status.lastAttemptedRevision),
    lastArtifactRevision: str(status.lastArtifactRevision),
    images: arr(status.components).map((c) => {
      const r = rec(c) ?? {};
      return {
        name: str(r.name) ?? '?',
        repository: str(r.repository),
        tag: str(r.tag),
        digest: str(r.digest),
      };
    }),
  };
}

export const FLUX_CONTROLLERS =
  /^(source|kustomize|helm|notification|image-reflector|image-automation|source-watcher)-controller$/;

function controllerCount(
  nodes: Map<string, EstateNode>,
  report: FluxReportSummary | undefined,
): { ready: number; total: number } {
  if (report !== undefined && report.components.length > 0) {
    return { ready: report.components.filter((c) => c.ready).length, total: report.components.length };
  }
  let ready = 0;
  let total = 0;
  for (const n of nodes.values()) {
    if (n.kind !== 'Deployment' || !n.live || !FLUX_CONTROLLERS.test(n.name)) continue;
    total++;
    if (n.state === 'ready') ready++;
  }
  return { ready, total };
}

function findRoot(nodes: Map<string, EstateNode>, rootKustomization: string | undefined): string | undefined {
  for (const n of nodes.values()) if (n.role === 'fluxinstance') return n.id;
  const wanted =
    rootKustomization === undefined || rootKustomization === '' || rootKustomization === 'auto'
      ? 'flux-system'
      : rootKustomization;
  const [ns, name] = wanted.includes('/') ? wanted.split('/') : [undefined, wanted];
  for (const n of nodes.values()) {
    if (n.role === 'kustomization' && n.name === name && (ns === undefined || n.namespace === ns)) return n.id;
  }
  return undefined;
}

// ---------- queries over the estate ----------

/** Objects a Flux object applied directly (inventory, or labels when there is no inventory). */
export function managedChildren(estate: Estate, id: string): EstateNode[] {
  const out: EstateNode[] = [];
  for (const n of estate.nodes.values()) if (n.managedBy === id) out.push(n);
  return out;
}

/** Objects whose ownerReferences point at this one (ReplicaSets of a Deployment, Pods...). */
export function ownedChildren(estate: Estate, id: string): EstateNode[] {
  const out: EstateNode[] = [];
  for (const n of estate.nodes.values()) if (n.ownerIds.includes(id)) out.push(n);
  return out;
}

/** The custom resources a CRD defines, matched by group and plural. */
export function crdMatches(crd: { group: string; plural: string }, node: EstateNode): boolean {
  return node.group === crd.group && pluralCandidates(node.kind).includes(crd.plural);
}

/** Stage of each Kustomization: 1 + the deepest dependsOn chain (cycles stop at the repeat). */
export function kustomizationStages(estate: Estate): Map<string, number> {
  const stages = new Map<string, number>();
  const visiting = new Set<string>();
  const stageOf = (id: string): number => {
    const known = stages.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const node = estate.nodes.get(id);
    let depth = 1;
    for (const dep of node?.dependsOn ?? []) {
      if (estate.nodes.has(dep)) depth = Math.max(depth, stageOf(dep) + 1);
    }
    visiting.delete(id);
    stages.set(id, depth);
    return depth;
  };
  for (const n of estate.nodes.values()) {
    if (n.role === 'kustomization' && n.live && n.id !== estate.root) stageOf(n.id);
  }
  return stages;
}

/** The Kustomization that (directly or through HelmReleases/ResourceSets) applied this object. */
export function owningKustomization(estate: Estate, id: string): string | undefined {
  let current = estate.nodes.get(id);
  const seen = new Set<string>();
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    const parentId = current.managedBy ?? current.ownerIds.find((o) => estate.nodes.has(o));
    if (parentId === undefined) return undefined;
    const parent = estate.nodes.get(parentId);
    if (parent?.role === 'kustomization') return parent.id;
    current = parent;
  }
  return undefined;
}

export function displayName(node: Pick<EstateNode, 'kind' | 'name' | 'namespace'>): string {
  return node.namespace === '' ? node.name : `${node.namespace}/${node.name}`;
}
