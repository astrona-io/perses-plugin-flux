// What disappears if you delete one object: the delete-impact engine. Pure; it works on the estate
// graph only and follows the documented cascade rules (sources in docs/DECISIONS.md, "Delete impact"):
//
// - Kustomization: deletionPolicy MirrorPrune (default) deletes its inventory only with prune: true;
//   Delete and WaitForTermination always delete it; Orphan never does. Suspended: nothing is deleted.
// - HelmRelease: helm-controller uninstalls the release unless it is suspended. Helm keeps CRDs and
//   objects annotated helm.sh/resource-policy: keep.
// - ResourceSet: its inventory is deleted, except objects with fluxcd.controlplane.io/prune: disabled.
// - FluxInstance: the controllers and CRDs go; the operator removes the finalizers from every Flux
//   object first, so Kustomizations and HelmReleases vanish without pruning what they applied.
// - Namespace: everything in it. CRD: every object of that type. ownerReferences: garbage collection.
// - Sources delete nothing; what reads from them fails.
// - reconcile: disabled objects are left alone by kustomize-controller, pruning included.
// - prune: disabled (Kustomization or operator annotation) protects an object from Flux, never from
//   namespace or CRD deletion, which Kubernetes does on its own.

import type { Estate, EstateNode } from './estate';
import { crdMatches, displayName, owningKustomization } from './estate';

export type DeleteReason =
  | 'target'
  | 'pruned'
  | 'uninstalled'
  | 'resourceset'
  | 'fluxinstance'
  | 'namespace'
  | 'crd'
  | 'garbage-collected'
  | 'helmchart';

export type KeepReason =
  | 'prune-disabled'
  | 'orphan-policy'
  | 'prune-false'
  | 'suspended'
  | 'reconcile-disabled'
  | 'helm-keep'
  | 'helm-crd'
  | 'finalizers-removed';

export type FailReason = 'source-deleted' | 'dependency' | 'namespace-gone' | 'crd-gone';

export interface Deleted {
  id: string;
  reason: DeleteReason;
  /** The object whose deletion took this one with it. */
  via?: string;
  /** True when the object belongs to the target (its managedBy/owner chain reaches the target). */
  yours: boolean;
}

export interface Kept {
  id: string;
  reason: KeepReason;
  via: string;
}

export interface Failing {
  id: string;
  reason: FailReason;
  /** The deleted or failing object it needs. */
  via: string;
}

export interface DeleteImpact {
  target: string;
  deleted: Deleted[];
  kept: Kept[];
  failing: Failing[];
  /** Surviving Kustomizations that lose objects (they re-apply them unless they fail): id → count. */
  losing: Map<string, number>;
  /** Namespaces with at least one deleted object. */
  namespaces: string[];
  /** Deleted objects that belong to other Kustomizations or to nobody. */
  notYours: number;
  /** Deleted PersistentVolumeClaims: their data is lost (unless the volume's reclaim policy is Retain). */
  dataLoss: string[];
  /** Deleted objects outside the target's namespace. */
  crossNamespace: number;
}

function deletesInventory(node: EstateNode): KeepReason | undefined {
  if (node.suspended === true) return 'suspended';
  if (node.reconcileDisabled) return 'reconcile-disabled';
  switch (node.deletionPolicy ?? 'MirrorPrune') {
    case 'Delete':
    case 'WaitForTermination':
      return undefined;
    case 'Orphan':
      return 'orphan-policy';
    default:
      return node.prune === true ? undefined : 'prune-false';
  }
}

/** Index of the estate so the cascade does not scan every node per step. */
interface Index {
  managed: Map<string, EstateNode[]>;
  owned: Map<string, EstateNode[]>;
  byNamespace: Map<string, EstateNode[]>;
}

function indexEstate(estate: Estate): Index {
  const managed = new Map<string, EstateNode[]>();
  const owned = new Map<string, EstateNode[]>();
  const byNamespace = new Map<string, EstateNode[]>();
  const push = (m: Map<string, EstateNode[]>, k: string, n: EstateNode): void => {
    const list = m.get(k);
    if (list === undefined) m.set(k, [n]);
    else list.push(n);
  };
  for (const n of estate.nodes.values()) {
    if (n.managedBy !== undefined) push(managed, n.managedBy, n);
    for (const o of n.ownerIds) push(owned, o, n);
    if (n.namespace !== '') push(byNamespace, n.namespace, n);
  }
  return { managed, owned, byNamespace };
}

function isFluxObject(n: EstateNode): boolean {
  return n.role !== undefined && n.group !== 'fluxcd.controlplane.io';
}

/** The cascade of deleting `targetId`. Unknown ids give an empty result. */
export function deleteImpact(estate: Estate, targetId: string): DeleteImpact {
  const target = estate.nodes.get(targetId);
  const deleted = new Map<string, Deleted>();
  const kept = new Map<string, Kept>();
  /** Flux objects deleted without their finalizer running (FluxInstance removal). */
  const noFinalizer = new Set<string>();
  const index = indexEstate(estate);
  const queue: string[] = [];

  const remove = (n: EstateNode, reason: DeleteReason, via: string): void => {
    if (deleted.has(n.id)) return;
    kept.delete(n.id);
    deleted.set(n.id, { id: n.id, reason, via, yours: false });
    queue.push(n.id);
  };
  const keep = (n: EstateNode, reason: KeepReason, via: string): void => {
    if (!deleted.has(n.id) && !kept.has(n.id)) kept.set(n.id, { id: n.id, reason, via });
  };

  if (target !== undefined) {
    deleted.set(target.id, { id: target.id, reason: 'target', yours: true });
    queue.push(target.id);
  }

  while (queue.length > 0) {
    const id = queue.shift() as string;
    const node = estate.nodes.get(id);
    if (node === undefined) continue;
    const children = index.managed.get(id) ?? [];

    if (node.role === 'kustomization' && !noFinalizer.has(id)) {
      const blocked = deletesInventory(node);
      for (const c of children) {
        if (blocked !== undefined) keep(c, blocked, id);
        else if (c.protected) keep(c, 'prune-disabled', id);
        // reconcile: disabled objects are neither applied nor pruned by kustomize-controller.
        else if (c.reconcileDisabled) keep(c, 'reconcile-disabled', id);
        else remove(c, 'pruned', id);
      }
    } else if (node.role === 'kustomization') {
      for (const c of children) keep(c, 'finalizers-removed', id);
    }

    if (node.role === 'helmrelease' && !noFinalizer.has(id)) {
      let blocked: KeepReason | undefined;
      if (node.suspended === true) blocked = 'suspended';
      else if (node.reconcileDisabled) blocked = 'reconcile-disabled';
      for (const c of children) {
        if (blocked !== undefined) keep(c, blocked, id);
        else if (c.kind === 'CustomResourceDefinition') keep(c, 'helm-crd', id);
        else if (c.helmKeep) keep(c, 'helm-keep', id);
        else remove(c, 'uninstalled', id);
      }
      // helm-controller deletes the HelmChart it created for the release.
      const chart = node.helmChart === undefined ? undefined : estate.nodes.get(node.helmChart);
      if (chart !== undefined) remove(chart, 'helmchart', id);
    } else if (node.role === 'helmrelease') {
      for (const c of children) keep(c, 'finalizers-removed', id);
    }

    if (node.role === 'resourceset') {
      for (const c of children) {
        if (node.reconcileDisabled) keep(c, 'reconcile-disabled', id);
        else if (c.protected) keep(c, 'prune-disabled', id);
        else remove(c, 'resourceset', id);
      }
    }

    if (node.role === 'fluxinstance') {
      if (node.suspended === true || node.reconcileDisabled) {
        for (const c of children) keep(c, 'reconcile-disabled', id);
      } else {
        // The operator strips finalizers from every Flux object before deleting the CRDs.
        for (const n of estate.nodes.values()) if (isFluxObject(n)) noFinalizer.add(n.id);
        for (const c of children) {
          if (c.protected) keep(c, 'prune-disabled', id);
          else remove(c, 'fluxinstance', id);
        }
      }
    }

    if (node.kind === 'Namespace' && node.group === '') {
      for (const c of index.byNamespace.get(node.name) ?? []) remove(c, 'namespace', id);
    }

    if (node.kind === 'CustomResourceDefinition' && node.defines !== undefined) {
      for (const n of estate.nodes.values()) if (crdMatches(node.defines, n)) remove(n, 'crd', id);
    }

    for (const c of index.owned.get(id) ?? []) remove(c, 'garbage-collected', id);
  }

  // Ownership: an object is "yours" when its managedBy/owner chain reaches the target.
  const belongsToTarget = (id: string): boolean => {
    let current = estate.nodes.get(id);
    const seen = new Set<string>();
    while (current !== undefined && !seen.has(current.id)) {
      if (current.id === targetId) return true;
      seen.add(current.id);
      const next = current.managedBy ?? current.ownerIds.find((o) => estate.nodes.has(o));
      current = next === undefined ? undefined : estate.nodes.get(next);
    }
    return false;
  };
  for (const d of deleted.values()) d.yours = belongsToTarget(d.id);

  const failing = findFailing(estate, deleted);

  const losing = new Map<string, number>();
  for (const d of deleted.values()) {
    const owner = owningKustomization(estate, d.id);
    if (owner === undefined || deleted.has(owner)) continue;
    losing.set(owner, (losing.get(owner) ?? 0) + 1);
  }

  const namespaces = new Set<string>();
  let crossNamespace = 0;
  const dataLoss: string[] = [];
  let notYours = 0;
  for (const d of deleted.values()) {
    const n = estate.nodes.get(d.id);
    if (n === undefined) continue;
    const ns = n.kind === 'Namespace' && n.group === '' ? n.name : n.namespace;
    if (ns !== '') namespaces.add(ns);
    if (target !== undefined && n.namespace !== '' && n.namespace !== target.namespace) crossNamespace++;
    if (n.kind === 'PersistentVolumeClaim') dataLoss.push(n.id);
    if (!d.yours) notYours++;
  }

  return {
    target: targetId,
    deleted: [...deleted.values()],
    kept: [...kept.values()],
    failing,
    losing,
    namespaces: [...namespaces].sort(),
    notYours,
    dataLoss,
    crossNamespace,
  };
}

/** Surviving Flux objects that will fail: until a fixpoint, since a failing dependency fails its dependents. */
function findFailing(estate: Estate, deleted: Map<string, Deleted>): Failing[] {
  const failing = new Map<string, Failing>();
  const deletedNamespaces = new Set<string>();
  const deletedCrds: Array<{ group: string; plural: string }> = [];
  for (const d of deleted.values()) {
    const n = estate.nodes.get(d.id);
    if (n?.kind === 'Namespace' && n.group === '') deletedNamespaces.add(n.name);
    if (n?.kind === 'CustomResourceDefinition' && n.defines !== undefined) deletedCrds.push(n.defines);
  }
  const candidates = [...estate.nodes.values()].filter(
    (n) =>
      n.live &&
      !deleted.has(n.id) &&
      (n.role === 'kustomization' ||
        n.role === 'helmrelease' ||
        n.role === 'resourceset' ||
        (n.role === 'source' && n.kind === 'HelmChart')),
  );

  // Direct causes: a deleted source, or applied objects that can no longer be created.
  for (const n of candidates) {
    if (n.sourceRef !== undefined && deleted.has(n.sourceRef)) {
      failing.set(n.id, { id: n.id, reason: 'source-deleted', via: n.sourceRef });
      continue;
    }
    for (const childId of n.inventory ?? []) {
      const child = estate.nodes.get(childId);
      if (child === undefined) continue;
      if (
        child.namespace !== '' &&
        deletedNamespaces.has(child.namespace) &&
        !(n.inventory ?? []).includes(`|Namespace||${child.namespace}`)
      ) {
        failing.set(n.id, { id: n.id, reason: 'namespace-gone', via: `|Namespace||${child.namespace}` });
        break;
      }
      const crd = deletedCrds.find((c) => crdMatches(c, child));
      if (crd !== undefined) {
        failing.set(n.id, {
          id: n.id,
          reason: 'crd-gone',
          via: `apiextensions.k8s.io|CustomResourceDefinition||${crd.plural}.${crd.group}`,
        });
        break;
      }
    }
  }

  // Transitive: dependsOn a deleted or failing object.
  let changed = true;
  while (changed) {
    changed = false;
    for (const n of candidates) {
      if (failing.has(n.id)) continue;
      const dep = (n.dependsOn ?? []).find((d) => deleted.has(d) || failing.has(d));
      const src = n.sourceRef !== undefined && failing.has(n.sourceRef) ? n.sourceRef : undefined;
      const via = dep ?? src;
      if (via !== undefined) {
        failing.set(n.id, { id: n.id, reason: dep !== undefined ? 'dependency' : 'source-deleted', via });
        changed = true;
      }
    }
  }
  return [...failing.values()];
}

const KIND_ORDER = ['Namespace', 'CustomResourceDefinition'];

/** "57 objects disappear if you delete Kustomization infra-configs, across 3 namespaces..." */
export function impactSummary(estate: Estate, impact: DeleteImpact): string {
  const target = estate.nodes.get(impact.target);
  if (target === undefined) return '';
  const count = impact.deleted.length;
  const parts = [
    `${count} ${count === 1 ? 'object disappears' : 'objects disappear'} if you delete ${target.kind} ${displayName(target)}, across ${impact.namespaces.length} ${impact.namespaces.length === 1 ? 'namespace' : 'namespaces'}.`,
  ];
  if (impact.notYours > 0) parts.push(`${impact.notYours} belong to other Kustomizations or to nobody.`);
  if (impact.dataLoss.length > 0)
    parts.push(`${impact.dataLoss.length} ${impact.dataLoss.length === 1 ? 'volume' : 'volumes'} of data lost.`);
  if (impact.failing.length > 0)
    parts.push(
      `${impact.failing.length} Flux ${impact.failing.length === 1 ? 'object fails' : 'objects fail'} afterwards.`,
    );
  if (impact.kept.length > 0) parts.push(`${impact.kept.length} kept.`);
  return parts.join(' ');
}

/** Deleted ids sorted for display: namespaces and CRDs first, then by kind and name. */
export function sortedDeleted(estate: Estate, impact: DeleteImpact): Deleted[] {
  const rank = (id: string): number => {
    const k = estate.nodes.get(id)?.kind ?? '';
    const i = KIND_ORDER.indexOf(k);
    return i < 0 ? KIND_ORDER.length : i;
  };
  return [...impact.deleted].sort((a, b) => rank(a.id) - rank(b.id) || a.id.localeCompare(b.id));
}

export const KEEP_LABEL: Record<KeepReason, string> = {
  'prune-disabled': 'prune: disabled',
  'orphan-policy': 'deletionPolicy: Orphan',
  'prune-false': 'prune: false',
  suspended: 'owner suspended',
  'reconcile-disabled': 'reconcile disabled',
  'helm-keep': 'helm.sh/resource-policy: keep',
  'helm-crd': 'Helm never deletes CRDs',
  'finalizers-removed': 'finalizers removed first',
};

export const DELETE_LABEL: Record<DeleteReason, string> = {
  target: 'deleted',
  pruned: 'pruned',
  uninstalled: 'uninstalled by Helm',
  resourceset: 'removed by ResourceSet',
  fluxinstance: 'removed by FluxInstance',
  namespace: 'namespace deleted',
  crd: 'CRD deleted',
  'garbage-collected': 'garbage collected',
  helmchart: 'HelmChart removed',
};

export const FAIL_LABEL: Record<FailReason, string> = {
  'source-deleted': 'source deleted',
  dependency: 'dependency gone',
  'namespace-gone': 'namespace gone',
  'crd-gone': 'CRD gone',
};
