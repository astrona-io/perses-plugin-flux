import { describe, expect, it } from 'vitest';

import { helmLabels, hr, inv, ks, ksLabels, obj, raw, stagedEstate } from '../test/fixtures';
import { deleteImpact, impactSummary, sortedDeleted } from './delete-impact';
import { buildEstate, nodeId } from './estate';

const K = (name: string): string => nodeId('kustomize.toolkit.fluxcd.io', 'Kustomization', 'flux-system', name);
const NS = (name: string): string => nodeId('', 'Namespace', '', name);
const ids = (list: Array<{ id: string }>): string[] => list.map((x) => x.id).sort();

describe('deleteImpact: the infra-configs case', () => {
  const estate = stagedEstate();
  const impact = deleteImpact(estate, K('infra-configs'));
  const deleted = new Set(ids(impact.deleted));

  it('prunes the inventory except the protected Namespace', () => {
    expect(deleted.has(NS('monitoring'))).toBe(true);
    expect(deleted.has(NS('team-a'))).toBe(true);
    expect(deleted.has(NS('apps'))).toBe(false);
    expect(impact.kept).toContainEqual({ id: NS('apps'), reason: 'prune-disabled', via: K('infra-configs') });
  });

  it('a deleted Namespace takes everything inside it, Git or not', () => {
    for (const x of [
      nodeId('helm.toolkit.fluxcd.io', 'HelmRelease', 'monitoring', 'kube-prometheus-stack'),
      nodeId('apps', 'Deployment', 'monitoring', 'kps-operator'),
      nodeId('', 'Service', 'monitoring', 'debug-proxy'),
      nodeId('', 'ConfigMap', 'monitoring', 'perses-dashboards'),
    ]) {
      expect(deleted.has(x), x).toBe(true);
    }
  });

  it('cascades through ownerReferences (Prometheus → StatefulSet → Pod)', () => {
    const sts = impact.deleted.find((d) => d.id === nodeId('apps', 'StatefulSet', 'monitoring', 'prometheus-kps'));
    expect(sts).toBeDefined();
    expect(deleted.has(nodeId('', 'Pod', 'monitoring', 'prometheus-kps-0'))).toBe(true);
  });

  it('reports data loss, namespaces and what is not yours', () => {
    expect(impact.dataLoss.sort()).toEqual([
      nodeId('', 'PersistentVolumeClaim', 'monitoring', 'data-perses-0'),
      nodeId('', 'PersistentVolumeClaim', 'monitoring', 'prometheus-kps-db-prometheus-kps-0'),
    ]);
    expect(impact.namespaces).toEqual(['apps', 'flux-system', 'monitoring', 'team-a']);
    // Yours: the target, three pruned Namespaces' worth of inventory minus the protected one.
    const yours = impact.deleted.filter((d) => d.yours).map((d) => d.id);
    expect(yours).toContain(NS('monitoring'));
    expect(yours).not.toContain(nodeId('apps', 'Deployment', 'monitoring', 'kps-operator'));
    expect(impact.notYours).toBe(impact.deleted.length - yours.length);
    expect(impact.notYours).toBeGreaterThan(10);
    expect(impact.crossNamespace).toBeGreaterThan(0);
  });

  it('keeps reconcile: disabled objects', () => {
    const e = buildEstate(
      raw([
        ks('configs', { inventory: [inv('ClusterIssuer', 'letsencrypt-prod', '', 'cert-manager.io')] }),
        obj('cert-manager.io/v1', 'ClusterIssuer', 'letsencrypt-prod', undefined, {
          labels: ksLabels('configs'),
          annotations: { 'kustomize.toolkit.fluxcd.io/reconcile': 'disabled' },
        }),
      ]),
    );
    const i = deleteImpact(e, K('configs'));
    expect(i.kept).toEqual([
      {
        id: nodeId('cert-manager.io', 'ClusterIssuer', '', 'letsencrypt-prod'),
        reason: 'reconcile-disabled',
        via: K('configs'),
      },
    ]);
  });

  it('marks what fails afterwards: missing namespace, then dependants', () => {
    const failing = new Map(impact.failing.map((f) => [f.id, f]));
    expect(failing.get(K('monitoring'))?.reason).toBe('namespace-gone');
    expect(failing.get(K('apps'))?.reason).toBe('dependency');
    // tenants applies into team-a, which infra-configs prunes.
    expect(failing.get(K('tenants'))?.reason).toBe('namespace-gone');
  });

  it('counts surviving Kustomizations that lose objects', () => {
    expect(impact.losing.get(K('monitoring'))).toBeGreaterThan(0);
  });

  it('writes the banner sentence', () => {
    const text = impactSummary(estate, impact);
    expect(text).toMatch(
      /^\d+ objects disappear if you delete Kustomization flux-system\/infra-configs, across 4 namespaces\./,
    );
    expect(text).toContain('2 volumes of data lost.');
    expect(text).toContain('belong to other Kustomizations or to nobody.');
  });

  it('sorts Namespaces and CRDs first', () => {
    const sorted = sortedDeleted(estate, impact);
    expect(estate.nodes.get(sorted[0]?.id ?? '')?.kind).toBe('Namespace');
  });
});

describe('deleteImpact: Kustomization deletionPolicy and prune', () => {
  const objects = (spec: { prune?: boolean; deletionPolicy?: string; suspend?: boolean }): ReturnType<typeof raw> =>
    raw([
      ks('app', { ...spec, inventory: [inv('Deployment', 'web', 'apps', 'apps')] }),
      obj('apps/v1', 'Deployment', 'web', 'apps', { labels: ksLabels('app') }),
    ]);
  const web = nodeId('apps', 'Deployment', 'apps', 'web');

  it.each([
    [{ prune: true }, true, undefined],
    [{ prune: false }, false, 'prune-false'],
    [{ prune: false, deletionPolicy: 'Delete' }, true, undefined],
    [{ prune: false, deletionPolicy: 'WaitForTermination' }, true, undefined],
    [{ prune: true, deletionPolicy: 'Orphan' }, false, 'orphan-policy'],
    [{ prune: true, suspend: true }, false, 'suspended'],
  ])('%j', (spec, gone, reason) => {
    const i = deleteImpact(buildEstate(objects(spec)), K('app'));
    expect(ids(i.deleted).includes(web)).toBe(gone);
    if (reason !== undefined) expect(i.kept).toContainEqual({ id: web, reason, via: K('app') });
  });
});

describe('deleteImpact: HelmRelease', () => {
  const build = (suspend = false): ReturnType<typeof buildEstate> =>
    buildEstate(
      raw([
        ks('infra', { inventory: [inv('HelmRelease', 'kps', 'monitoring', 'helm.toolkit.fluxcd.io')] }),
        hr('kps', 'monitoring', { repo: 'pcm', labels: ksLabels('infra'), suspend, keepHistory: true }),
        obj('apps/v1', 'Deployment', 'op', 'monitoring', { labels: helmLabels('kps', 'monitoring') }),
        obj('v1', 'Service', 'kept', 'monitoring', {
          labels: helmLabels('kps', 'monitoring'),
          annotations: { 'helm.sh/resource-policy': 'keep' },
        }),
        obj('apiextensions.k8s.io/v1', 'CustomResourceDefinition', 'prometheuses.monitoring.coreos.com', undefined, {
          labels: helmLabels('kps', 'monitoring'),
        }),
        obj('source.toolkit.fluxcd.io/v1', 'HelmChart', 'monitoring-kps', 'flux-system'),
      ]),
    );
  const hrId = nodeId('helm.toolkit.fluxcd.io', 'HelmRelease', 'monitoring', 'kps');

  it('uninstalls everything with its labels, keeps CRDs and resource-policy: keep', () => {
    const i = deleteImpact(build(), hrId);
    expect(ids(i.deleted)).toEqual(
      [
        hrId,
        nodeId('apps', 'Deployment', 'monitoring', 'op'),
        nodeId('source.toolkit.fluxcd.io', 'HelmChart', 'flux-system', 'monitoring-kps'),
      ].sort(),
    );
    expect(ids(i.kept)).toEqual(
      [
        nodeId('', 'Service', 'monitoring', 'kept'),
        nodeId('apiextensions.k8s.io', 'CustomResourceDefinition', '', 'prometheuses.monitoring.coreos.com'),
      ].sort(),
    );
  });

  it('a suspended HelmRelease uninstalls nothing', () => {
    const i = deleteImpact(build(true), hrId);
    expect(ids(i.deleted)).toEqual(
      [hrId, nodeId('source.toolkit.fluxcd.io', 'HelmChart', 'flux-system', 'monitoring-kps')].sort(),
    );
  });

  it('deleting the parent Kustomization uninstalls the child release', () => {
    const i = deleteImpact(build(), K('infra'));
    expect(ids(i.deleted)).toContain(nodeId('apps', 'Deployment', 'monitoring', 'op'));
    expect(i.deleted.every((d) => d.yours)).toBe(true);
  });
});

describe('deleteImpact: CRD case', () => {
  it('a deleted CRD takes every object of its type in every namespace, and their owned objects', () => {
    const e = buildEstate(
      raw([
        ks('crds', {
          inventory: [
            inv('CustomResourceDefinition', 'prometheuses.monitoring.coreos.com', '', 'apiextensions.k8s.io'),
          ],
        }),
        ks('mon-a', { inventory: [inv('Prometheus', 'a', 'team-a', 'monitoring.coreos.com')] }),
        obj('monitoring.coreos.com/v1', 'Prometheus', 'a', 'team-a', { labels: ksLabels('mon-a') }),
        obj('monitoring.coreos.com/v1', 'Prometheus', 'b', 'team-b'),
        obj('apps/v1', 'StatefulSet', 'prometheus-b', 'team-b', {
          owner: { apiVersion: 'monitoring.coreos.com/v1', kind: 'Prometheus', name: 'b' },
        }),
        obj('monitoring.coreos.com/v1', 'ServiceMonitor', 'unrelated', 'team-b'),
      ]),
    );
    const i = deleteImpact(e, K('crds'));
    expect(ids(i.deleted)).toEqual(
      [
        K('crds'),
        nodeId('apiextensions.k8s.io', 'CustomResourceDefinition', '', 'prometheuses.monitoring.coreos.com'),
        nodeId('monitoring.coreos.com', 'Prometheus', 'team-a', 'a'),
        nodeId('monitoring.coreos.com', 'Prometheus', 'team-b', 'b'),
        nodeId('apps', 'StatefulSet', 'team-b', 'prometheus-b'),
      ].sort(),
    );
    expect(i.failing).toEqual([
      {
        id: K('mon-a'),
        reason: 'crd-gone',
        via: nodeId('apiextensions.k8s.io', 'CustomResourceDefinition', '', 'prometheuses.monitoring.coreos.com'),
      },
    ]);
    expect(i.namespaces).toEqual(['flux-system', 'team-a', 'team-b']);
  });
});

describe('deleteImpact: Namespace protection stops the cascade', () => {
  it('a protected Namespace and its content survive pruning', () => {
    const e = buildEstate(
      raw([
        ks('ns', { inventory: [inv('Namespace', 'data')] }),
        obj('v1', 'Namespace', 'data', undefined, {
          labels: ksLabels('ns'),
          annotations: { 'kustomize.toolkit.fluxcd.io/prune': 'Disabled' },
        }),
        obj('v1', 'PersistentVolumeClaim', 'db', 'data'),
      ]),
    );
    const i = deleteImpact(e, K('ns'));
    expect(ids(i.deleted)).toEqual([K('ns')]);
    expect(i.dataLoss).toEqual([]);
  });
});

describe('deleteImpact: sources', () => {
  it('deletes nothing but fails every consumer and their dependants', () => {
    const estate = stagedEstate();
    const git = nodeId('source.toolkit.fluxcd.io', 'GitRepository', 'flux-system', 'flux-system');
    const i = deleteImpact(estate, git);
    expect(ids(i.deleted)).toEqual([git]);
    const failing = new Map(i.failing.map((f) => [f.id, f.reason]));
    expect(failing.get(K('infra-crds'))).toBe('source-deleted');
    expect(failing.get(K('apps'))).toBe('source-deleted');
    expect(failing.size).toBeGreaterThanOrEqual(7);
  });

  it('a HelmRepository fails the HelmReleases that use it', () => {
    const estate = stagedEstate();
    const repo = nodeId('source.toolkit.fluxcd.io', 'HelmRepository', 'flux-system', 'jetstack');
    const i = deleteImpact(estate, repo);
    expect(i.failing.map((f) => f.id)).toContain(
      nodeId('helm.toolkit.fluxcd.io', 'HelmRelease', 'cert-manager', 'cert-manager'),
    );
  });
});

describe('deleteImpact: root', () => {
  it('the root Kustomization takes everything it applied, down to the pods', () => {
    const estate = stagedEstate();
    const i = deleteImpact(estate, K('flux-system'));
    const deleted = new Set(ids(i.deleted));
    expect(deleted.has(nodeId('', 'Pod', 'monitoring', 'prometheus-kps-0'))).toBe(true);
    expect(deleted.has(nodeId('apps', 'Deployment', 'cert-manager', 'cert-manager'))).toBe(true);
    // tenants is suspended: its finalizer deletes nothing, so team-a's quota stays... until team-a goes.
    expect(deleted.has(NS('team-a'))).toBe(true);
    expect(deleted.has(nodeId('', 'ResourceQuota', 'team-a', 'team-a-quota'))).toBe(true);
    // The protected Namespace stays, with the apps in it gone through their Kustomization.
    expect(deleted.has(NS('apps'))).toBe(false);
    expect(deleted.has(nodeId('apps', 'Deployment', 'apps', 'podinfo'))).toBe(true);
  });
});

describe('deleteImpact: Flux Operator', () => {
  const op = (kind: string, name: string, extra: Record<string, unknown> = {}): ReturnType<typeof obj> => ({
    apiVersion: 'fluxcd.controlplane.io/v1',
    kind,
    metadata: { name, namespace: 'flux-system', generation: 1, ...(extra.metadata as object | undefined) },
    spec: (extra.spec as Record<string, unknown>) ?? {},
    status: {
      observedGeneration: 1,
      conditions: [{ type: 'Ready', status: 'True', reason: 'ReconciliationSucceeded' }],
      ...(extra.status as object | undefined),
    },
  });
  const entries = (list: string[]): { inventory: { entries: Array<{ id: string; v: string }> } } => ({
    inventory: { entries: list.map((id) => ({ id, v: 'v1' })) },
  });

  it('a ResourceSet removes what it generated, except fluxcd.controlplane.io/prune: disabled', () => {
    const e = buildEstate(
      raw([
        op('ResourceSet', 'tenants', { status: entries([inv('Namespace', 'team-x'), inv('Namespace', 'team-y')]) }),
        obj('v1', 'Namespace', 'team-x', undefined, {
          labels: {
            'resourceset.fluxcd.controlplane.io/name': 'tenants',
            'resourceset.fluxcd.controlplane.io/namespace': 'flux-system',
          },
        }),
        obj('v1', 'Namespace', 'team-y', undefined, { annotations: { 'fluxcd.controlplane.io/prune': 'disabled' } }),
        obj('apps/v1', 'Deployment', 'x', 'team-x'),
      ]),
    );
    const i = deleteImpact(e, nodeId('fluxcd.controlplane.io', 'ResourceSet', 'flux-system', 'tenants'));
    expect(ids(i.deleted)).toEqual(
      [
        nodeId('fluxcd.controlplane.io', 'ResourceSet', 'flux-system', 'tenants'),
        NS('team-x'),
        nodeId('apps', 'Deployment', 'team-x', 'x'),
      ].sort(),
    );
    expect(i.kept.map((k) => k.reason)).toEqual(['prune-disabled']);
  });

  it('a FluxInstance removes Flux, but Flux objects lose their finalizers: workloads stay', () => {
    const e = buildEstate(
      raw([
        op('FluxInstance', 'flux', {
          status: entries([
            inv('Deployment', 'kustomize-controller', 'flux-system', 'apps'),
            inv('CustomResourceDefinition', 'kustomizations.kustomize.toolkit.fluxcd.io', '', 'apiextensions.k8s.io'),
            inv('Kustomization', 'flux-system', 'flux-system', 'kustomize.toolkit.fluxcd.io'),
          ]),
        }),
        ks('flux-system', { inventory: [inv('Kustomization', 'apps', 'flux-system', 'kustomize.toolkit.fluxcd.io')] }),
        ks('apps', { inventory: [inv('Deployment', 'web', 'apps', 'apps')] }),
        obj('apps/v1', 'Deployment', 'web', 'apps', { labels: ksLabels('apps') }),
        obj('apps/v1', 'Deployment', 'kustomize-controller', 'flux-system'),
      ]),
    );
    const i = deleteImpact(e, nodeId('fluxcd.controlplane.io', 'FluxInstance', 'flux-system', 'flux'));
    const deleted = ids(i.deleted);
    expect(deleted).toContain(nodeId('apps', 'Deployment', 'flux-system', 'kustomize-controller'));
    expect(deleted).toContain(K('apps'));
    expect(deleted).not.toContain(nodeId('apps', 'Deployment', 'apps', 'web'));
    expect(i.kept).toContainEqual({
      id: nodeId('apps', 'Deployment', 'apps', 'web'),
      reason: 'finalizers-removed',
      via: K('apps'),
    });
  });

  it('a FluxInstance with reconcile disabled deletes nothing else', () => {
    const e = buildEstate(
      raw([
        op('FluxInstance', 'flux', {
          metadata: { annotations: { 'fluxcd.controlplane.io/reconcile': 'disabled' } },
          status: entries([inv('Deployment', 'kustomize-controller', 'flux-system', 'apps')]),
        }),
        obj('apps/v1', 'Deployment', 'kustomize-controller', 'flux-system'),
      ]),
    );
    const i = deleteImpact(e, nodeId('fluxcd.controlplane.io', 'FluxInstance', 'flux-system', 'flux'));
    expect(i.deleted).toHaveLength(1);
  });
});

describe('deleteImpact: edge cases', () => {
  it('an unknown target gives an empty result', () => {
    const i = deleteImpact(stagedEstate(), 'nope');
    expect(i.deleted).toEqual([]);
    expect(impactSummary(stagedEstate(), i)).toBe('');
  });

  it('terminates on ownership cycles', () => {
    const e = buildEstate(
      raw([
        obj('example.com/v1', 'A', 'a', 'x', { owner: { apiVersion: 'example.com/v1', kind: 'B', name: 'b' } }),
        obj('example.com/v1', 'B', 'b', 'x', { owner: { apiVersion: 'example.com/v1', kind: 'A', name: 'a' } }),
      ]),
    );
    expect(deleteImpact(e, nodeId('example.com', 'A', 'x', 'a')).deleted).toHaveLength(2);
  });
});
