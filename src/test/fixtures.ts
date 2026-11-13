// Test fixtures shaped like real API responses. Conditions are copied from objects of Flux v2.10
// (kustomize-controller, helm-controller, source-controller) and Flux Operator v0.62 in the dev
// stack, with names changed; see src/test/conditions.ts.

import type { RawEstate } from '../model/estate';
import { buildEstate } from '../model/estate';
import type { KubeObject } from '../model/kube';
import { READY_TRUE } from './conditions';

const T = '2026-11-12T09:00:00Z';

export function ks(
  name: string,
  opts: {
    namespace?: string;
    dependsOn?: string[];
    source?: string;
    path?: string;
    prune?: boolean;
    suspend?: boolean;
    deletionPolicy?: string;
    inventory?: string[];
    conditions?: KubeObject['status'] extends infer S ? (S extends { conditions?: infer C } ? C : never) : never;
    revision?: string;
    labels?: Record<string, string>;
  } = {},
): KubeObject {
  const namespace = opts.namespace ?? 'flux-system';
  return {
    apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
    kind: 'Kustomization',
    metadata: { name, namespace, generation: 1, creationTimestamp: T, labels: opts.labels },
    spec: {
      interval: '10m',
      path: opts.path ?? `./${name}`,
      prune: opts.prune ?? true,
      suspend: opts.suspend,
      deletionPolicy: opts.deletionPolicy,
      sourceRef: { kind: 'GitRepository', name: opts.source ?? 'flux-system' },
      dependsOn: opts.dependsOn?.map((d) => ({ name: d })),
    },
    status: {
      observedGeneration: 1,
      conditions: opts.conditions ?? READY_TRUE('main@sha1:a12f0d3b9c1e'),
      lastAppliedRevision: opts.revision ?? 'main@sha1:a12f0d3b9c1e',
      lastAttemptedRevision: opts.revision ?? 'main@sha1:a12f0d3b9c1e',
      inventory: opts.inventory === undefined ? undefined : { entries: opts.inventory.map((id) => ({ id, v: 'v1' })) },
    },
  };
}

export function gitRepo(name: string, revision = 'main@sha1:a12f0d3b9c1e', namespace = 'flux-system'): KubeObject {
  return {
    apiVersion: 'source.toolkit.fluxcd.io/v1',
    kind: 'GitRepository',
    metadata: { name, namespace, generation: 1, creationTimestamp: T },
    spec: { url: `https://github.com/example/${name}`, interval: '1m', ref: { branch: 'main' } },
    status: {
      observedGeneration: 1,
      artifact: { revision, digest: 'sha256:00' },
      conditions: READY_TRUE(`stored artifact for revision '${revision}'`),
    },
  };
}

export function helmRepo(name: string, namespace = 'flux-system', labels?: Record<string, string>): KubeObject {
  return {
    apiVersion: 'source.toolkit.fluxcd.io/v1',
    kind: 'HelmRepository',
    metadata: { name, namespace, generation: 1, creationTimestamp: T, labels },
    spec: { url: `https://charts.example.com/${name}`, interval: '1h' },
    status: { observedGeneration: 1, artifact: { revision: 'sha256:51a0' }, conditions: READY_TRUE('stored artifact') },
  };
}

export function hr(
  name: string,
  namespace: string,
  opts: {
    repo: string;
    chart?: string;
    version?: string;
    suspend?: boolean;
    conditions?: ReturnType<typeof READY_TRUE>;
    inventory?: string[];
    labels?: Record<string, string>;
    keepHistory?: boolean;
  },
): KubeObject {
  return {
    apiVersion: 'helm.toolkit.fluxcd.io/v2',
    kind: 'HelmRelease',
    metadata: { name, namespace, generation: 1, creationTimestamp: T, labels: opts.labels },
    spec: {
      interval: '30m',
      suspend: opts.suspend,
      chart: {
        spec: {
          chart: opts.chart ?? name,
          version: '*',
          sourceRef: { kind: 'HelmRepository', name: opts.repo, namespace: 'flux-system' },
        },
      },
      uninstall: opts.keepHistory === undefined ? undefined : { keepHistory: opts.keepHistory },
    },
    status: {
      observedGeneration: 1,
      helmChart: `flux-system/${namespace}-${name}`,
      conditions: opts.conditions ?? READY_TRUE(`Helm install succeeded for release ${namespace}/${name}.v1`),
      history: [
        {
          chartName: opts.chart ?? name,
          chartVersion: opts.version ?? '1.0.0',
          appVersion: '1.0',
          status: 'deployed',
          version: 1,
        },
      ],
      inventory: opts.inventory === undefined ? undefined : { entries: opts.inventory.map((id) => ({ id, v: 'v1' })) },
    },
  };
}

export function obj(
  apiVersion: string,
  kind: string,
  name: string,
  namespace?: string,
  extra: {
    labels?: Record<string, string>;
    annotations?: Record<string, string>;
    owner?: { apiVersion: string; kind: string; name: string };
    spec?: Record<string, unknown>;
    status?: Record<string, unknown>;
  } = {},
): KubeObject {
  return {
    apiVersion,
    kind,
    metadata: {
      name,
      namespace,
      creationTimestamp: T,
      labels: extra.labels,
      annotations: extra.annotations,
      ownerReferences: extra.owner === undefined ? undefined : [{ ...extra.owner, controller: true }],
    },
    spec: extra.spec,
    status: extra.status,
  };
}

export function ksLabels(name: string, namespace = 'flux-system'): Record<string, string> {
  return { 'kustomize.toolkit.fluxcd.io/name': name, 'kustomize.toolkit.fluxcd.io/namespace': namespace };
}

export function helmLabels(name: string, namespace: string): Record<string, string> {
  return { 'helm.toolkit.fluxcd.io/name': name, 'helm.toolkit.fluxcd.io/namespace': namespace };
}

/** Groups objects into the lists the fetch layer produces. */
export function raw(objects: KubeObject[]): RawEstate {
  const lists: Record<string, KubeObject[]> = {};
  for (const o of objects) {
    const group = o.apiVersion?.includes('/') ? o.apiVersion.split('/')[0] : '';
    const key = `${group}/${o.kind}`;
    (lists[key] ??= []).push(o);
  }
  return { lists };
}

/** Inventory id helper: `<ns>_<name>_<group>_<kind>`. */
export function inv(kind: string, name: string, namespace = '', group = ''): string {
  return `${namespace}_${name.replaceAll(':', '__')}_${group}_${kind}`;
}

/**
 * The staged setup of the mockups: crds → controllers → configs → monitoring (failed Helm upgrade)
 * → apps (waiting), plus a suspended tenants Kustomization. infra-configs defines the monitoring,
 * apps (protected) and team-a Namespaces that other stages deploy into.
 */
export function stagedObjects(): KubeObject[] {
  const objs: KubeObject[] = [];
  const root = 'flux-system';
  objs.push(gitRepo('flux-system'));
  objs.push(
    ks(root, {
      path: './clusters/cluster-01',
      inventory: [
        inv('GitRepository', 'flux-system', 'flux-system', 'source.toolkit.fluxcd.io'),
        ...['flux-system', 'infra-crds', 'infra-controllers', 'infra-configs', 'monitoring', 'apps', 'tenants'].map(
          (n) => inv('Kustomization', n, 'flux-system', 'kustomize.toolkit.fluxcd.io'),
        ),
      ],
    }),
  );
  objs.push(
    ks('infra-crds', {
      path: './infrastructure/crds',
      inventory: [
        inv('CustomResourceDefinition', 'servicemonitors.monitoring.coreos.com', '', 'apiextensions.k8s.io'),
        inv('CustomResourceDefinition', 'prometheusrules.monitoring.coreos.com', '', 'apiextensions.k8s.io'),
        inv('CustomResourceDefinition', 'prometheuses.monitoring.coreos.com', '', 'apiextensions.k8s.io'),
        inv('CustomResourceDefinition', 'clusterissuers.cert-manager.io', '', 'apiextensions.k8s.io'),
      ],
    }),
  );
  objs.push(
    ks('infra-controllers', {
      path: './infrastructure/controllers',
      dependsOn: ['infra-crds'],
      inventory: [
        inv('Namespace', 'cert-manager'),
        inv('HelmRepository', 'jetstack', 'flux-system', 'source.toolkit.fluxcd.io'),
        inv('HelmRelease', 'cert-manager', 'cert-manager', 'helm.toolkit.fluxcd.io'),
      ],
    }),
  );
  objs.push(helmRepo('jetstack', 'flux-system', ksLabels('infra-controllers')));
  objs.push(
    obj('v1', 'Namespace', 'cert-manager', undefined, {
      labels: ksLabels('infra-controllers'),
      status: { phase: 'Active' },
    }),
  );
  objs.push(
    hr('cert-manager', 'cert-manager', { repo: 'jetstack', version: 'v1.16.2', labels: ksLabels('infra-controllers') }),
  );
  objs.push(
    obj('apps/v1', 'Deployment', 'cert-manager', 'cert-manager', {
      labels: helmLabels('cert-manager', 'cert-manager'),
      spec: { replicas: 1 },
      status: { readyReplicas: 1, updatedReplicas: 1 },
    }),
  );

  objs.push(
    ks('infra-configs', {
      path: './infrastructure/configs',
      dependsOn: ['infra-controllers'],
      inventory: [
        inv('Namespace', 'monitoring'),
        inv('Namespace', 'apps'),
        inv('Namespace', 'team-a'),
        inv('ClusterIssuer', 'letsencrypt-prod', '', 'cert-manager.io'),
        inv('ClusterIssuer', 'selfsigned', '', 'cert-manager.io'),
        inv('NetworkPolicy', 'default-deny', 'monitoring', 'networking.k8s.io'),
        inv('NetworkPolicy', 'default-deny', 'apps', 'networking.k8s.io'),
      ],
    }),
  );
  objs.push(
    obj('v1', 'Namespace', 'monitoring', undefined, { labels: ksLabels('infra-configs'), status: { phase: 'Active' } }),
  );
  objs.push(
    obj('v1', 'Namespace', 'apps', undefined, {
      labels: ksLabels('infra-configs'),
      annotations: { 'kustomize.toolkit.fluxcd.io/prune': 'disabled' },
      status: { phase: 'Active' },
    }),
  );
  objs.push(
    obj('v1', 'Namespace', 'team-a', undefined, { labels: ksLabels('infra-configs'), status: { phase: 'Active' } }),
  );

  // monitoring: the Helm upgrade failed; kube-prometheus-stack runs in the monitoring namespace.
  objs.push(
    ks('monitoring', {
      path: './monitoring',
      dependsOn: ['infra-configs'],
      conditions: [
        {
          type: 'Ready',
          status: 'False',
          reason: 'HealthCheckFailed',
          message:
            "health check failed after 5m0s: failed early due to stalled resources: [HelmRelease/monitoring/kube-prometheus-stack status: 'Failed']",
        },
      ],
      inventory: [
        inv('HelmRepository', 'prometheus-community', 'flux-system', 'source.toolkit.fluxcd.io'),
        inv('HelmRelease', 'kube-prometheus-stack', 'monitoring', 'helm.toolkit.fluxcd.io'),
        inv('ConfigMap', 'perses-dashboards', 'monitoring'),
      ],
    }),
  );
  objs.push(helmRepo('prometheus-community', 'flux-system', ksLabels('monitoring')));
  objs.push(
    hr('kube-prometheus-stack', 'monitoring', {
      repo: 'prometheus-community',
      version: '66.2.1',
      labels: ksLabels('monitoring'),
      conditions: [
        {
          type: 'Ready',
          status: 'False',
          reason: 'UpgradeFailed',
          message:
            'Helm upgrade failed for release monitoring/kube-prometheus-stack with chart kube-prometheus-stack@67.0.0: context deadline exceeded',
        },
        { type: 'Released', status: 'False', reason: 'UpgradeFailed', message: 'context deadline exceeded' },
      ],
    }),
  );
  const kpsLabels = helmLabels('kube-prometheus-stack', 'monitoring');
  objs.push(
    obj('apps/v1', 'Deployment', 'kps-operator', 'monitoring', {
      labels: kpsLabels,
      spec: { replicas: 1 },
      status: { readyReplicas: 1, updatedReplicas: 1 },
    }),
  );
  objs.push(obj('monitoring.coreos.com/v1', 'Prometheus', 'kps-prometheus', 'monitoring', { labels: kpsLabels }));
  for (const sm of ['kps-operator', 'kps-prometheus', 'kps-alertmanager', 'kps-kubelet']) {
    objs.push(obj('monitoring.coreos.com/v1', 'ServiceMonitor', sm, 'monitoring', { labels: kpsLabels }));
  }
  // The operator creates the StatefulSet and its PVC; neither is in Git.
  objs.push(
    obj('apps/v1', 'StatefulSet', 'prometheus-kps', 'monitoring', {
      owner: { apiVersion: 'monitoring.coreos.com/v1', kind: 'Prometheus', name: 'kps-prometheus' },
      spec: { replicas: 1 },
      status: { readyReplicas: 0, updatedReplicas: 1 },
    }),
  );
  objs.push(
    obj('v1', 'Pod', 'prometheus-kps-0', 'monitoring', {
      owner: { apiVersion: 'apps/v1', kind: 'StatefulSet', name: 'prometheus-kps' },
      status: {
        phase: 'Running',
        containerStatuses: [
          {
            ready: false,
            restartCount: 7,
            state: { waiting: { reason: 'CrashLoopBackOff' } },
            lastState: { terminated: { reason: 'OOMKilled' } },
          },
        ],
      },
    }),
  );
  objs.push(
    obj('v1', 'PersistentVolumeClaim', 'prometheus-kps-db-prometheus-kps-0', 'monitoring', {
      spec: { resources: { requests: { storage: '50Gi' } } },
      status: { phase: 'Bound' },
    }),
  );
  objs.push(
    obj('v1', 'PersistentVolumeClaim', 'data-perses-0', 'monitoring', {
      spec: { resources: { requests: { storage: '1Gi' } } },
      status: { phase: 'Bound' },
    }),
  );
  // A hand-made Secret in monitoring, not in Git.
  objs.push(obj('v1', 'Service', 'debug-proxy', 'monitoring'));

  objs.push(
    ks('apps', {
      path: './apps/production',
      dependsOn: ['monitoring'],
      revision: 'main@sha1:3f2a9c1aa000',
      conditions: [
        {
          type: 'Ready',
          status: 'False',
          reason: 'DependencyNotReady',
          message: "dependency 'flux-system/monitoring' is not ready",
        },
      ],
      inventory: [inv('Deployment', 'podinfo', 'apps', 'apps'), inv('Service', 'podinfo', 'apps')],
    }),
  );
  objs.push(
    obj('apps/v1', 'Deployment', 'podinfo', 'apps', {
      labels: ksLabels('apps'),
      spec: { replicas: 2 },
      status: { readyReplicas: 2, updatedReplicas: 2 },
    }),
  );
  objs.push(obj('v1', 'Service', 'podinfo', 'apps', { labels: ksLabels('apps') }));

  objs.push(
    ks('tenants', {
      path: './tenants',
      dependsOn: ['infra-configs'],
      suspend: true,
      inventory: [
        inv('RoleBinding', 'team-a-admins', 'team-a', 'rbac.authorization.k8s.io'),
        inv('ResourceQuota', 'team-a-quota', 'team-a'),
      ],
    }),
  );
  return objs;
}

export function stagedEstate(): ReturnType<typeof buildEstate> {
  return buildEstate(raw(stagedObjects()), { now: Date.parse('2026-11-12T10:00:00Z') });
}

/** A wide, deep estate for the 300-node render test: n Kustomizations with Deployments and Pods. */
export function largeObjects(kustomizations: number, perKs: number): KubeObject[] {
  const objs: KubeObject[] = [gitRepo('flux-system')];
  const names = Array.from({ length: kustomizations }, (_, i) => `app-${i}`);
  objs.push(
    ks('flux-system', {
      inventory: names.map((n) => inv('Kustomization', n, 'flux-system', 'kustomize.toolkit.fluxcd.io')),
    }),
  );
  names.forEach((n, i) => {
    const inventory: string[] = [];
    for (let j = 0; j < perKs; j++) inventory.push(inv('Deployment', `${n}-d${j}`, n, 'apps'));
    objs.push(ks(n, { inventory, dependsOn: i > 0 && i % 5 !== 0 ? [`app-${i - 1}`] : undefined }));
    for (let j = 0; j < perKs; j++) {
      objs.push(
        obj('apps/v1', 'Deployment', `${n}-d${j}`, n, {
          labels: ksLabels(n),
          spec: { replicas: 1 },
          status: { readyReplicas: 1, updatedReplicas: 1 },
        }),
      );
      objs.push(
        obj('v1', 'Pod', `${n}-d${j}-abc`, n, {
          owner: { apiVersion: 'apps/v1', kind: 'Deployment', name: `${n}-d${j}` },
          status: { phase: 'Running', containerStatuses: [{ ready: true }] },
        }),
      );
    }
  });
  return objs;
}
