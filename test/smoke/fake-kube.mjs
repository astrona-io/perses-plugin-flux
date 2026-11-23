// A stand-in for the Kubernetes API server: it answers the list requests the panel makes with a small
// fixed estate (one GitRepository, two staged Kustomizations, one HelmRelease). Core lists are empty,
// and every other path is a 404 Status, as the API server writes it when a CRD is not installed.

import { createServer } from 'node:http';

const T = '2026-11-12T09:00:00Z';
const REVISION = 'main@sha1:a12f0d3b9c1e';
const ready = (message) => [
  { type: 'Ready', status: 'True', reason: 'ReconciliationSucceeded', message, lastTransitionTime: T },
];
const meta = (name, namespace) => ({ name, namespace, uid: `uid-${name}`, generation: 1, creationTimestamp: T });

const kustomization = (name, dependsOn) => ({
  apiVersion: 'kustomize.toolkit.fluxcd.io/v1',
  kind: 'Kustomization',
  metadata: meta(name, 'flux-system'),
  spec: {
    interval: '10m',
    path: `./${name}`,
    prune: true,
    sourceRef: { kind: 'GitRepository', name: 'flux-system' },
    dependsOn: dependsOn.map((d) => ({ name: d })),
  },
  status: {
    observedGeneration: 1,
    conditions: ready(`Applied revision: ${REVISION}`),
    lastAppliedRevision: REVISION,
    lastAttemptedRevision: REVISION,
  },
});

const LISTS = {
  '/api/v1/namespaces': [
    { apiVersion: 'v1', kind: 'Namespace', metadata: meta('flux-system') },
    { apiVersion: 'v1', kind: 'Namespace', metadata: meta('smoke-apps') },
  ],
  '/apis/source.toolkit.fluxcd.io/v1/gitrepositories': [
    {
      apiVersion: 'source.toolkit.fluxcd.io/v1',
      kind: 'GitRepository',
      metadata: meta('flux-system', 'flux-system'),
      spec: { url: 'https://github.com/example/fleet', interval: '1m', ref: { branch: 'main' } },
      status: {
        observedGeneration: 1,
        artifact: { revision: REVISION, digest: 'sha256:00' },
        conditions: ready(`stored artifact for revision '${REVISION}'`),
      },
    },
  ],
  '/apis/kustomize.toolkit.fluxcd.io/v1/kustomizations': [
    kustomization('smoke-infra', []),
    kustomization('smoke-apps', ['smoke-infra']),
  ],
};
const EMPTY = [
  '/apis/source.toolkit.fluxcd.io/v1/ocirepositories',
  '/apis/source.toolkit.fluxcd.io/v1/helmrepositories',
  '/apis/source.toolkit.fluxcd.io/v1/helmcharts',
  '/apis/source.toolkit.fluxcd.io/v1/buckets',
  '/apis/helm.toolkit.fluxcd.io/v2/helmreleases',
  '/apis/apps/v1/deployments',
  '/apis/apps/v1/statefulsets',
  '/apis/apps/v1/daemonsets',
  '/apis/apps/v1/replicasets',
  '/api/v1/pods',
  '/api/v1/services',
  '/api/v1/persistentvolumeclaims',
  '/api/v1/events',
];

function send(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

createServer((req, res) => {
  const path = new URL(req.url ?? '/', 'http://fake-kube').pathname;
  console.log(req.method, req.url);
  const items = LISTS[path] ?? (EMPTY.includes(path) ? [] : undefined);
  if (req.method !== 'GET' || items === undefined) {
    send(res, 404, {
      kind: 'Status',
      apiVersion: 'v1',
      status: 'Failure',
      message: 'the server could not find the requested resource',
      reason: 'NotFound',
      code: 404,
    });
    return;
  }
  send(res, 200, { kind: 'List', apiVersion: 'v1', metadata: { resourceVersion: '1' }, items });
}).listen(8080, () => console.log('fake-kube listening on :8080'));
