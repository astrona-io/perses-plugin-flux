// Reads the live state through the KubernetesDatasource (astrona-io/perses-plugin-kubernetes).
// Every request is a GET on a list endpoint; the README lists them as allowedEndpoints patterns.

import type { RawEstate } from './estate';
import type { KubeEvent, KubeObject } from './kube';

/** The part of the KubernetesDatasource client this panel uses (see perses-plugin-kubernetes). */
export interface KubernetesListClient {
  list<T = unknown>(
    path: string,
    options?: {
      labelSelector?: string;
      fieldSelector?: string;
      pageSize?: number;
      maxItems?: number;
      signal?: AbortSignal;
    },
  ): Promise<{ items: T[]; truncated: boolean; pages: number }>;
}

export interface Resource {
  group: string;
  version: string;
  plural: string;
  kind: string;
  namespaced: boolean;
  /** Which install it belongs to; a missing optional API is not an error. */
  set: 'flux' | 'flux-optional' | 'operator' | 'core';
  /** Only read when the option is on. */
  when?: 'showPods';
}

export const RESOURCES: Resource[] = [
  // Flux (plain): the sources, Kustomizations and HelmReleases.
  {
    group: 'source.toolkit.fluxcd.io',
    version: 'v1',
    plural: 'gitrepositories',
    kind: 'GitRepository',
    namespaced: true,
    set: 'flux',
  },
  {
    group: 'source.toolkit.fluxcd.io',
    version: 'v1',
    plural: 'ocirepositories',
    kind: 'OCIRepository',
    namespaced: true,
    set: 'flux',
  },
  {
    group: 'source.toolkit.fluxcd.io',
    version: 'v1',
    plural: 'helmrepositories',
    kind: 'HelmRepository',
    namespaced: true,
    set: 'flux',
  },
  {
    group: 'source.toolkit.fluxcd.io',
    version: 'v1',
    plural: 'helmcharts',
    kind: 'HelmChart',
    namespaced: true,
    set: 'flux',
  },
  {
    group: 'source.toolkit.fluxcd.io',
    version: 'v1',
    plural: 'buckets',
    kind: 'Bucket',
    namespaced: true,
    set: 'flux',
  },
  {
    group: 'kustomize.toolkit.fluxcd.io',
    version: 'v1',
    plural: 'kustomizations',
    kind: 'Kustomization',
    namespaced: true,
    set: 'flux',
  },
  {
    group: 'helm.toolkit.fluxcd.io',
    version: 'v2',
    plural: 'helmreleases',
    kind: 'HelmRelease',
    namespaced: true,
    set: 'flux',
  },
  // Flux Operator.
  {
    group: 'fluxcd.controlplane.io',
    version: 'v1',
    plural: 'fluxinstances',
    kind: 'FluxInstance',
    namespaced: true,
    set: 'operator',
  },
  {
    group: 'fluxcd.controlplane.io',
    version: 'v1',
    plural: 'fluxreports',
    kind: 'FluxReport',
    namespaced: true,
    set: 'operator',
  },
  {
    group: 'fluxcd.controlplane.io',
    version: 'v1',
    plural: 'resourcesets',
    kind: 'ResourceSet',
    namespaced: true,
    set: 'operator',
  },
  {
    group: 'fluxcd.controlplane.io',
    version: 'v1',
    plural: 'resourcesetinputproviders',
    kind: 'ResourceSetInputProvider',
    namespaced: true,
    set: 'operator',
  },
  // Kubernetes objects Flux applies and the workloads under them.
  { group: '', version: 'v1', plural: 'namespaces', kind: 'Namespace', namespaced: false, set: 'core' },
  { group: 'apps', version: 'v1', plural: 'deployments', kind: 'Deployment', namespaced: true, set: 'core' },
  { group: 'apps', version: 'v1', plural: 'statefulsets', kind: 'StatefulSet', namespaced: true, set: 'core' },
  { group: 'apps', version: 'v1', plural: 'daemonsets', kind: 'DaemonSet', namespaced: true, set: 'core' },
  { group: 'apps', version: 'v1', plural: 'replicasets', kind: 'ReplicaSet', namespaced: true, set: 'core' },
  { group: '', version: 'v1', plural: 'pods', kind: 'Pod', namespaced: true, set: 'core', when: 'showPods' },
  { group: '', version: 'v1', plural: 'services', kind: 'Service', namespaced: true, set: 'core' },
  {
    group: '',
    version: 'v1',
    plural: 'persistentvolumeclaims',
    kind: 'PersistentVolumeClaim',
    namespaced: true,
    set: 'core',
  },
];

export function listPath(r: Pick<Resource, 'group' | 'version' | 'plural' | 'namespaced'>, namespace?: string): string {
  const base = r.group === '' ? `/api/${r.version}` : `/apis/${r.group}/${r.version}`;
  return r.namespaced && namespace !== undefined
    ? `${base}/namespaces/${namespace}/${r.plural}`
    : `${base}/${r.plural}`;
}

export function resourceKey(r: Pick<Resource, 'group' | 'kind'>): string {
  return `${r.group}/${r.kind}`;
}

export type FailureKind = 'forbidden' | 'not-installed' | 'proxy-endpoint' | 'proxy-network' | 'error';

export interface ReadFailure {
  resource: string;
  path: string;
  kind: FailureKind;
  message: string;
}

/**
 * The datasource client only passes on the API server's message, so the status is read from it:
 * `... is forbidden: ...` (403) and `the server could not find the requested resource` (404, the
 * CRD is not installed), as the API server writes them.
 */
export function classifyError(message: string): FailureKind {
  // The Perses proxy's own 403s (Perses v0.55.1): a path missing from allowedEndpoints, and a
  // destination outside datasource.proxy.allowed_networks.
  if (/you are not allowed to use this endpoint/.test(message)) return 'proxy-endpoint';
  if (/datasource destination is not allowed/.test(message)) return 'proxy-network';
  if (/\bis forbidden\b|\bHTTP 403\b|\(HTTP 403\)/.test(message)) return 'forbidden';
  if (/could not find the requested resource|\bHTTP 404\b|\(HTTP 404\)|page not found/i.test(message))
    return 'not-installed';
  return 'error';
}

export interface FetchResult extends RawEstate {
  failures: ReadFailure[];
  truncated: string[];
  /** Which sets answered with at least one successful list. */
  installed: { flux: boolean; operator: boolean };
  /** Number of API requests made. */
  requests: number;
}

export interface FetchOptions {
  namespaces?: string[];
  showPods?: boolean;
  signal?: AbortSignal;
  maxItems?: number;
}

async function listOne(
  client: KubernetesListClient,
  path: string,
  options: FetchOptions,
): Promise<{ items: KubeObject[]; truncated: boolean; pages: number }> {
  return client.list<KubeObject>(path, { signal: options.signal, maxItems: options.maxItems });
}

/** Reads every resource in parallel. A failed list is reported, never fatal on its own. */
export async function fetchEstate(client: KubernetesListClient, options: FetchOptions = {}): Promise<FetchResult> {
  const namespaces = options.namespaces !== undefined && options.namespaces.length > 0 ? options.namespaces : undefined;
  const wanted = RESOURCES.filter((r) => r.when !== 'showPods' || options.showPods !== false);
  const lists: Record<string, KubeObject[]> = {};
  const failures: ReadFailure[] = [];
  const truncated: string[] = [];
  const installed = { flux: false, operator: false };
  let requests = 0;

  const jobs: Array<{ r: Resource; path: string }> = [];
  for (const r of wanted) {
    if (r.namespaced && namespaces !== undefined) for (const ns of namespaces) jobs.push({ r, path: listPath(r, ns) });
    else jobs.push({ r, path: listPath(r) });
  }
  const eventPaths =
    namespaces === undefined ? ['/api/v1/events'] : namespaces.map((ns) => `/api/v1/namespaces/${ns}/events`);

  const results = await Promise.allSettled(jobs.map((j) => listOne(client, j.path, options)));
  results.forEach((res, i) => {
    const { r, path } = jobs[i] as { r: Resource; path: string };
    const key = resourceKey(r);
    requests++;
    if (res.status === 'fulfilled') {
      requests += Math.max(0, res.value.pages - 1);
      (lists[key] ??= []).push(...res.value.items);
      if (res.value.truncated) truncated.push(path);
      if (r.set === 'flux') installed.flux = true;
      if (r.set === 'operator') installed.operator = true;
      return;
    }
    const message = res.reason instanceof Error ? res.reason.message : String(res.reason);
    failures.push({ resource: key, path, kind: classifyError(message), message });
  });

  const events: KubeEvent[] = [];
  const eventResults = await Promise.allSettled(
    eventPaths.map((p) => client.list<KubeEvent>(p, { signal: options.signal, maxItems: options.maxItems ?? 2000 })),
  );
  eventResults.forEach((res, i) => {
    requests++;
    if (res.status === 'fulfilled') events.push(...res.value.items);
    else {
      const message = res.reason instanceof Error ? res.reason.message : String(res.reason);
      failures.push({ resource: '/Event', path: eventPaths[i] ?? '', kind: classifyError(message), message });
    }
  });

  return { lists, events, failures, truncated, installed, requests };
}

/** One line per distinct message, with the paths that got it (at most three named). */
function groupByMessage(failures: ReadFailure[]): string {
  const byMessage = new Map<string, string[]>();
  for (const f of failures) {
    const paths = byMessage.get(f.message) ?? [];
    paths.push(f.path);
    byMessage.set(f.message, paths);
  }
  return [...byMessage.entries()]
    .map(([message, paths]) => {
      const named = paths.slice(0, 3).join(', ');
      const more = paths.length > 3 ? ` and ${paths.length - 3} more` : '';
      return `${message} (${named}${more})`;
    })
    .join('; ');
}

export interface ReadProblem {
  severity: 'error' | 'warning';
  title: string;
  detail: string;
}

/**
 * Turns read failures into what the panel says. Plain Flux missing (no Kustomization list) is an
 * error; a missing Flux Operator is normal; anything forbidden is a warning that names the list.
 */
export function describeFailures(result: Pick<FetchResult, 'failures' | 'installed' | 'truncated'>): ReadProblem[] {
  const problems: ReadProblem[] = [];
  const forbidden = result.failures.filter((f) => f.kind === 'forbidden');
  const errors = result.failures.filter((f) => f.kind === 'error');
  const fluxMissing = result.failures.filter(
    (f) => f.resource.endsWith('/Kustomization') && f.kind === 'not-installed',
  );
  const network = result.failures.filter((f) => f.kind === 'proxy-network');
  if (network.length > 0) {
    problems.push({
      severity: 'error',
      title: 'Perses may not reach the API server',
      detail:
        "The Perses proxy refuses the datasource URL's address. Add the API server's IP to datasource.proxy.allowed_networks in the Perses config, as a /32 (kubectl get svc kubernetes -n default -o jsonpath='{.spec.clusterIP}').",
    });
  }
  const endpoint = result.failures.filter((f) => f.kind === 'proxy-endpoint');
  if (endpoint.length > 0) {
    problems.push({
      severity: result.installed.flux ? 'warning' : 'error',
      title: `The datasource's allow-list blocks ${endpoint.length} ${endpoint.length === 1 ? 'list' : 'lists'}`,
      detail: `Not in allowedEndpoints: ${endpoint.map((f) => f.path).join(', ')}. Use the allow-list in deploy/kubernetes-datasource.json from the plugin repository.`,
    });
  }
  if (!result.installed.flux && network.length === 0 && endpoint.length === 0) {
    if (forbidden.some((f) => f.resource.includes('fluxcd.io'))) {
      problems.push({
        severity: 'error',
        title: 'No permission to read Flux objects',
        detail: `The datasource's service account may not list ${forbidden
          .filter((f) => f.resource.includes('fluxcd.io'))
          .map((f) => f.path)
          .join(
            ', ',
          )}. Apply deploy/rbac.yaml from the plugin repository and add the paths to the datasource's allowedEndpoints.`,
      });
    } else if (fluxMissing.length > 0 && !result.installed.operator) {
      problems.push({
        severity: 'error',
        title: 'Flux is not installed in this cluster',
        detail:
          'The API server does not serve kustomize.toolkit.fluxcd.io/v1. Install Flux (v2.3 or newer) or check the datasource.',
      });
    }
  }
  if (forbidden.length > 0) {
    problems.push({
      severity: 'warning',
      title: `No permission for ${forbidden.length} ${forbidden.length === 1 ? 'list' : 'lists'}`,
      detail: `Forbidden: ${forbidden.map((f) => f.path).join(', ')}. What they would show is missing; delete impact is a lower bound.`,
    });
  }
  if (errors.length > 0) {
    problems.push({
      severity: errors.length === result.failures.length && !result.installed.flux ? 'error' : 'warning',
      title: `${errors.length} ${errors.length === 1 ? 'request' : 'requests'} failed`,
      detail: groupByMessage(errors),
    });
  }
  if (result.truncated.length > 0) {
    problems.push({
      severity: 'warning',
      title: 'Some lists were cut short',
      detail: `More objects than the limit: ${result.truncated.join(', ')}. Narrow the namespaces option.`,
    });
  }
  return problems;
}
