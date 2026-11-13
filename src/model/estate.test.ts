import { describe, expect, it } from 'vitest';

import { HR_DRIFT_CLEARED, HR_DRIFT_CORRECTED, FLUXINSTANCE_READY, READY_TRUE } from '../test/conditions';
import { gitRepo, hr, inv, ks, obj, raw, stagedEstate } from '../test/fixtures';
import type { EstateNode } from './estate';
import {
  buildEstate,
  kustomizationStages,
  nodeId,
  owningKustomization,
  parseInventoryId,
  pluralCandidates,
} from './estate';

describe('parseInventoryId', () => {
  it('parses namespaced, cluster-scoped and core entries', () => {
    expect(parseInventoryId('apps_podinfo_apps_Deployment')).toBe('apps|Deployment|apps|podinfo');
    expect(parseInventoryId('_monitoring__Namespace')).toBe('|Namespace||monitoring');
    expect(
      parseInventoryId('_servicemonitors.monitoring.coreos.com_apiextensions.k8s.io_CustomResourceDefinition'),
    ).toBe('apiextensions.k8s.io|CustomResourceDefinition||servicemonitors.monitoring.coreos.com');
  });

  it('keeps underscores in names and decodes __ to a colon', () => {
    expect(parseInventoryId('_cert-manager-webhook__subjectaccessreviews_rbac.authorization.k8s.io_ClusterRole')).toBe(
      'rbac.authorization.k8s.io|ClusterRole||cert-manager-webhook:subjectaccessreviews',
    );
    expect(parseInventoryId('ns_my_name_apps_Deployment')).toBe('apps|Deployment|ns|my_name');
  });

  it('rejects garbage', () => {
    expect(parseInventoryId('nonsense')).toBeUndefined();
    expect(parseInventoryId('')).toBeUndefined();
  });
});

describe('buildEstate', () => {
  const estate = stagedEstate();
  const id = (group: string, kind: string, ns: string, name: string): string => nodeId(group, kind, ns, name);

  it('finds the root Kustomization', () => {
    expect(estate.root).toBe(id('kustomize.toolkit.fluxcd.io', 'Kustomization', 'flux-system', 'flux-system'));
  });

  it('maps states from conditions', () => {
    expect(
      estate.nodes.get(id('kustomize.toolkit.fluxcd.io', 'Kustomization', 'flux-system', 'monitoring'))?.state,
    ).toBe('failed');
    expect(estate.nodes.get(id('kustomize.toolkit.fluxcd.io', 'Kustomization', 'flux-system', 'apps'))?.state).toBe(
      'waiting',
    );
    expect(estate.nodes.get(id('kustomize.toolkit.fluxcd.io', 'Kustomization', 'flux-system', 'tenants'))?.state).toBe(
      'suspended',
    );
    expect(estate.nodes.get(id('', 'Pod', 'monitoring', 'prometheus-kps-0'))?.note).toBe(
      'CrashLoopBackOff · OOMKilled',
    );
  });

  it('assigns ownership from inventories, Helm labels and ownerReferences', () => {
    expect(estate.nodes.get(id('apps', 'Deployment', 'monitoring', 'kps-operator'))?.managedBy).toBe(
      id('helm.toolkit.fluxcd.io', 'HelmRelease', 'monitoring', 'kube-prometheus-stack'),
    );
    expect(estate.nodes.get(id('apps', 'StatefulSet', 'monitoring', 'prometheus-kps'))?.ownerIds).toEqual([
      id('monitoring.coreos.com', 'Prometheus', 'monitoring', 'kps-prometheus'),
    ]);
    expect(owningKustomization(estate, id('', 'Pod', 'monitoring', 'prometheus-kps-0'))).toBe(
      id('kustomize.toolkit.fluxcd.io', 'Kustomization', 'flux-system', 'monitoring'),
    );
  });

  it('marks prune: disabled objects protected and inventory-only objects not live', () => {
    expect(estate.nodes.get(id('', 'Namespace', '', 'apps'))?.protected).toBe(true);
    const cm = estate.nodes.get(id('', 'ConfigMap', 'monitoring', 'perses-dashboards'));
    expect(cm?.live).toBe(false);
    expect(cm?.note).toBe('not read');
  });

  it('computes stages from dependsOn', () => {
    const stages = kustomizationStages(estate);
    const s = (n: string): number | undefined =>
      stages.get(id('kustomize.toolkit.fluxcd.io', 'Kustomization', 'flux-system', n));
    expect([
      s('infra-crds'),
      s('infra-controllers'),
      s('infra-configs'),
      s('monitoring'),
      s('apps'),
      s('tenants'),
    ]).toEqual([1, 2, 3, 4, 5, 4]);
    expect(s('flux-system')).toBeUndefined();
  });

  it('survives dependsOn cycles', () => {
    const e = buildEstate(raw([ks('a', { dependsOn: ['b'] }), ks('b', { dependsOn: ['a'] })]));
    expect(kustomizationStages(e).size).toBe(2);
  });

  it('reads the HelmRelease chart version from history and drift from the Drifted condition', () => {
    const e = buildEstate(
      raw([
        hr('cert-manager', 'cert-manager', { repo: 'jetstack', version: 'v1.16.2', conditions: HR_DRIFT_CORRECTED }),
      ]),
    );
    const n = e.nodes.get(id('helm.toolkit.fluxcd.io', 'HelmRelease', 'cert-manager', 'cert-manager'));
    expect(n?.appliedRevision).toBe('v1.16.2');
    expect(n?.state).toBe('drift');
  });

  it('keeps showing drift from a recent DriftCorrected event once the condition has cleared', () => {
    const base = raw([
      hr('widget-controller', 'widget-system', { repo: 'podinfo', version: '6.7.1', conditions: HR_DRIFT_CLEARED }),
    ]);
    const event = {
      involvedObject: {
        apiVersion: 'helm.toolkit.fluxcd.io/v2',
        kind: 'HelmRelease',
        name: 'widget-controller',
        namespace: 'widget-system',
      },
      reason: 'DriftCorrected',
      type: 'Normal',
      message: 'Cluster state of release widget-system/widget-controller.v1 has been corrected',
      lastTimestamp: '2026-11-13T17:25:00Z',
    };
    const now = Date.parse('2026-11-13T17:30:00Z');
    const nodeOf = (e: ReturnType<typeof buildEstate>): EstateNode | undefined =>
      e.nodes.get(id('helm.toolkit.fluxcd.io', 'HelmRelease', 'widget-system', 'widget-controller'));
    expect(nodeOf(buildEstate({ ...base, events: [event] }, { now }))?.state).toBe('drift');
    expect(nodeOf(buildEstate(base, { now }))?.state).toBe('ready');
  });

  it('flags a Kustomization out of sync when its source moved on', () => {
    const e = buildEstate(
      raw([gitRepo('flux-system', 'main@sha1:bbbbbbb'), ks('apps', { revision: 'main@sha1:aaaaaaa' })]),
    );
    expect(e.nodes.get(id('kustomize.toolkit.fluxcd.io', 'Kustomization', 'flux-system', 'apps'))?.state).toBe(
      'outofsync',
    );
  });

  it('reads the Git commit behind an OCI artifact', () => {
    const oci = {
      apiVersion: 'source.toolkit.fluxcd.io/v1',
      kind: 'OCIRepository',
      metadata: { name: 'flux-system', namespace: 'flux-system' },
      spec: { url: 'oci://registry.example.com/fleet' },
      status: {
        conditions: READY_TRUE("stored artifact for digest 'latest@sha256:0aa2e63d'"),
        artifact: {
          revision: 'latest@sha256:0aa2e63d',
          metadata: {
            'org.opencontainers.image.revision': 'main@sha1:ba9cf987',
            'org.opencontainers.image.source': 'https://github.com/example/fleet',
          },
        },
      },
    };
    const e = buildEstate(raw([oci]));
    const n = e.nodes.get(id('source.toolkit.fluxcd.io', 'OCIRepository', 'flux-system', 'flux-system'));
    expect(n?.originRevision).toBe('main@sha1:ba9cf987');
    expect(n?.originUrl).toBe('https://github.com/example/fleet');
  });

  it('uses the FluxInstance as root and the FluxReport for controllers', () => {
    const fi = {
      apiVersion: 'fluxcd.controlplane.io/v1',
      kind: 'FluxInstance',
      metadata: { name: 'flux', namespace: 'flux-system', generation: 1 },
      spec: {
        distribution: { version: '2.10.x' },
        sync: { kind: 'GitRepository', url: 'https://github.com/example/fleet', path: 'clusters/c1' },
      },
      status: {
        observedGeneration: 1,
        conditions: FLUXINSTANCE_READY,
        inventory: { entries: [{ id: inv('Deployment', 'source-controller', 'flux-system', 'apps'), v: 'v1' }] },
      },
    };
    const report = {
      apiVersion: 'fluxcd.controlplane.io/v1',
      kind: 'FluxReport',
      metadata: { name: 'flux', namespace: 'flux-system' },
      spec: {
        distribution: {
          version: 'v2.10.0',
          status: 'Installed',
          entitlement: 'Issued by controlplane',
          managedBy: 'flux-operator',
        },
        components: [
          {
            name: 'source-controller',
            image: 'ghcr.io/fluxcd/source-controller:v1.8.0',
            ready: true,
            status: 'Current Deployment is available. Replicas: 1',
          },
          {
            name: 'kustomize-controller',
            image: 'ghcr.io/fluxcd/kustomize-controller:v1.8.0',
            ready: false,
            status: 'InProgress',
          },
        ],
        reconcilers: [
          {
            apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
            kind: 'Kustomization',
            stats: { running: 5, failing: 1, suspended: 1 },
          },
        ],
        sync: {
          id: 'kustomization/flux-system',
          path: 'clusters/c1',
          ready: true,
          source: 'https://github.com/example/fleet',
          status: 'Applied revision: refs/heads/main@sha1:a12f0d3',
        },
        operator: { apiVersion: 'fluxcd.controlplane.io/v1', version: 'v0.62.1', platform: 'linux/arm64' },
      },
      status: { conditions: READY_TRUE('Reporting finished') },
    };
    const e = buildEstate(raw([fi, report, ks('flux-system')]));
    expect(e.root).toBe(id('fluxcd.controlplane.io', 'FluxInstance', 'flux-system', 'flux'));
    expect(e.operator).toBe(true);
    expect(e.controllers).toEqual({ ready: 1, total: 2 });
    expect(e.report?.distribution?.version).toBe('v2.10.0');
    expect(e.report?.reconcilers[0]).toMatchObject({ kind: 'Kustomization', running: 5, failing: 1 });
    expect(e.nodes.get(id('apps', 'Deployment', 'flux-system', 'source-controller'))?.managedBy).toBe(e.root);
  });

  it('honours the namespaces filter but keeps cluster-scoped objects', () => {
    const e = buildEstate(raw([ks('a'), obj('v1', 'Namespace', 'x'), obj('v1', 'Service', 's', 'other')]), {
      namespaces: ['flux-system'],
    });
    expect([...e.nodes.keys()].sort()).toEqual([
      'kustomize.toolkit.fluxcd.io|Kustomization|flux-system|a',
      '|Namespace||x',
    ]);
  });

  it('tolerates objects with no status, spec or name', () => {
    const e = buildEstate({
      lists: { 'kustomize.toolkit.fluxcd.io/Kustomization': [{ metadata: { name: 'bare', namespace: 'x' } }, {}] },
    });
    expect(e.nodes.size).toBe(1);
    expect(e.nodes.values().next().value?.state).toBe('unknown');
  });
});

describe('pluralCandidates', () => {
  it('covers the usual CRD plurals', () => {
    expect(pluralCandidates('Prometheus')).toContain('prometheuses');
    expect(pluralCandidates('ServiceMonitor')).toContain('servicemonitors');
    expect(pluralCandidates('Policy')).toContain('policies');
  });
});
