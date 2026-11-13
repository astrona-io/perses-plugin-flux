// Chart updates for HelmReleases: the installed chart version (status.history[0]) against the
// versions in the Helm repository index that source-controller already serves in the cluster.
// Pure: which index each HelmRelease needs, how the index is read, how versions compare. The
// fetching and caching is in chart-index.ts.

import * as semver from 'semver';

import type { Estate, EstateNode } from './estate';
import { parseId } from './estate';
import type { FailureKind } from './fetch';

/** Where a HelmRelease's available versions come from, or why they are not checked. */
export type ChartTarget =
  | {
      kind: 'index';
      chart: string;
      installed?: string;
      range?: string;
      /** The HelmRepository node id. */
      repo: string;
      /** The request path through the Kubernetes API service proxy; changes with the index digest. */
      path: string;
    }
  | { kind: 'not-checked'; reason: string; installed?: string }
  | { kind: 'error'; message: string; installed?: string };

/** What the panel shows for one HelmRelease. */
export type ChartUpdate =
  | { status: 'loading'; installed?: string }
  | { status: 'not-checked'; reason: string; installed?: string }
  | { status: 'error'; message: string; failure?: FailureKind; installed?: string }
  | {
      status: 'current' | 'update';
      installed: string;
      /** The newest version in the index (prereleases only when the installed one is one). */
      latest: string;
      /** The newest version inside `range`, when it is newer than the installed one. */
      latestInRange?: string;
      /** The range as written (`*` when the HelmRelease sets none). */
      range: string;
      /** Whether `latest` is inside the range; undefined when the range could not be read. */
      inRange?: boolean;
    };

/**
 * The only path the panel requests for an index: source-controller's own Service, through the
 * Kubernetes API service proxy, an `index-<hex>.yaml` artifact of one HelmRepository. The same pattern
 * is in deploy/kubernetes-datasource.json.
 */
export const INDEX_PROXY_PATH =
  /^\/api\/v1\/namespaces\/[a-z0-9]([-a-z0-9]*[a-z0-9])?\/services\/source-controller:80\/proxy\/helmrepository\/[a-z0-9]([-a-z0-9]*[a-z0-9])?\/[a-z0-9]([-a-z0-9.]*[a-z0-9])?\/index-[a-f0-9]+\.yaml$/;

/**
 * Turns a HelmRepository's `status.artifact.url`
 * (`http://source-controller.<ns>.svc.<domain>./helmrepository/<ns>/<name>/index-<digest>.yaml`) into a
 * Kubernetes API service proxy path. Undefined with a reason when it is not that shape.
 */
export function indexProxyPath(artifactUrl: string): { path: string } | { reason: string } {
  let url: URL;
  try {
    url = new URL(artifactUrl);
  } catch {
    return { reason: `the artifact URL "${artifactUrl}" is not a URL` };
  }
  const labels = url.hostname.replace(/\.$/, '').split('.');
  const [service = '', namespace = '', svc] = labels;
  if (labels.length < 3 || svc !== 'svc') {
    return { reason: `the artifact URL host ${url.hostname} is not an in-cluster Service (<name>.<namespace>.svc)` };
  }
  if (url.protocol !== 'http:')
    return { reason: `the artifact URL is ${url.protocol}, not plain http inside the cluster` };
  const port = url.port === '' ? '80' : url.port;
  const path = `/api/v1/namespaces/${namespace}/services/${service}:${port}/proxy${url.pathname}`;
  if (!INDEX_PROXY_PATH.test(path) || path.includes('..')) {
    return {
      reason: `the index is served at ${service}.${namespace}:${port}${url.pathname}; the panel only reads source-controller:80/helmrepository/<namespace>/<name>/index-<digest>.yaml`,
    };
  }
  return { path };
}

function chartFor(hr: EstateNode, helmChart: EstateNode | undefined): { chart?: string; range?: string } {
  return { chart: helmChart?.chart ?? hr.chart, range: hr.chartRange ?? helmChart?.chartRange };
}

/** Where each HelmRelease's available chart versions come from. Keyed by HelmRelease id. */
export function chartTargets(estate: Estate): Map<string, ChartTarget> {
  const out = new Map<string, ChartTarget>();
  for (const hr of estate.nodes.values()) {
    if (hr.role !== 'helmrelease' || !hr.live) continue;
    const installed = hr.chartVersion;
    const helmChart = hr.helmChart === undefined ? undefined : estate.nodes.get(hr.helmChart);
    const source = hr.sourceRef === undefined ? undefined : parseId(hr.sourceRef);
    if (source === undefined) {
      out.set(hr.id, { kind: 'not-checked', reason: 'The HelmRelease names no chart source.', installed });
      continue;
    }
    if (source.kind === 'OCIRepository') {
      out.set(hr.id, {
        kind: 'not-checked',
        reason:
          'The chart comes from an OCIRepository (chartRef). Its versions are registry tags, which the panel does not read.',
        installed,
      });
      continue;
    }
    if (source.kind === 'HelmChart') {
      out.set(hr.id, {
        kind: 'not-checked',
        reason: 'The chart comes from an existing HelmChart (chartRef); its versions are not checked.',
        installed,
      });
      continue;
    }
    if (source.kind === 'GitRepository' || source.kind === 'Bucket') {
      out.set(hr.id, {
        kind: 'not-checked',
        reason: `The chart is built from a ${source.kind}: its version is whatever Chart.yaml says at the source revision, there is no index of versions.`,
        installed,
      });
      continue;
    }
    if (source.kind !== 'HelmRepository') {
      out.set(hr.id, { kind: 'not-checked', reason: `Chart source kind ${source.kind} is not checked.`, installed });
      continue;
    }
    const repo = estate.nodes.get(hr.sourceRef as string);
    if (repo === undefined || !repo.live) {
      out.set(hr.id, {
        kind: 'error',
        message: `HelmRepository ${source.namespace}/${source.name} was not read, so its index is unknown.`,
        installed,
      });
      continue;
    }
    if (repo.repoType === 'oci') {
      out.set(hr.id, {
        kind: 'not-checked',
        reason: 'OCI HelmRepository: there is no index, versions are registry tags, which the panel does not read.',
        installed,
      });
      continue;
    }
    const { chart, range } = chartFor(hr, helmChart);
    if (chart === undefined) {
      out.set(hr.id, { kind: 'not-checked', reason: 'The chart name is unknown.', installed });
      continue;
    }
    if (repo.artifactUrl === undefined) {
      out.set(hr.id, {
        kind: 'error',
        message: `HelmRepository ${repo.namespace}/${repo.name} has no artifact yet: source-controller has not fetched its index.`,
        installed,
      });
      continue;
    }
    const p = indexProxyPath(repo.artifactUrl);
    if ('reason' in p) {
      out.set(hr.id, { kind: 'not-checked', reason: `Not checked: ${p.reason}.`, installed });
      continue;
    }
    out.set(hr.id, { kind: 'index', chart, installed, range, repo: repo.id, path: p.path });
  }
  return out;
}

/** Masterminds/semver (what Flux uses) separates AND with commas; node-semver with spaces. */
export function normaliseRange(range: string | undefined): string {
  const r = (range ?? '').trim();
  if (r === '') return '*';
  return r
    .split('||')
    .map((part) => part.replace(/,/g, ' ').replace(/\s+/g, ' ').trim())
    .join(' || ');
}

function clean(v: string): string | undefined {
  return semver.valid(v, { loose: true }) ?? semver.valid(semver.coerce(v, { includePrerelease: true })) ?? undefined;
}

/**
 * Compares the installed version with the versions in the index. Prereleases count only when the
 * installed version is one. The range verdict follows Flux: a newer version inside `spec.version`
 * is picked up on the next reconcile, one outside needs the range changed.
 */
export function compareVersions(
  installed: string | undefined,
  versions: string[],
  range: string | undefined,
): ChartUpdate {
  if (installed === undefined) {
    return { status: 'not-checked', reason: 'Nothing is installed yet (status.history is empty).' };
  }
  const current = clean(installed);
  if (current === undefined) {
    return { status: 'not-checked', reason: `The installed version ${installed} is not semver.`, installed };
  }
  const withPre = semver.prerelease(current) !== null;
  const candidates = versions
    .map((v) => ({ raw: v, v: clean(v) }))
    .filter((c): c is { raw: string; v: string } => c.v !== undefined)
    .filter((c) => withPre || semver.prerelease(c.v) === null);
  if (candidates.length === 0) {
    return { status: 'error', message: 'The index lists no semver versions for this chart.', installed };
  }
  candidates.sort((a, b) => semver.rcompare(a.v, b.v));
  const latest = candidates[0] as { raw: string; v: string };
  const written = range?.trim() ? range.trim() : '*';
  const npmRange = semver.validRange(normaliseRange(range), { loose: true });
  const satisfies = (v: string): boolean | undefined =>
    npmRange === null ? undefined : semver.satisfies(v, npmRange, { loose: true, includePrerelease: withPre });
  const inRange = satisfies(latest.v);
  const newerInRange = candidates.find((c) => satisfies(c.v) === true && semver.gt(c.v, current));
  if (!semver.gt(latest.v, current)) {
    return { status: 'current', installed, latest: latest.raw, range: written, inRange };
  }
  return {
    status: 'update',
    installed,
    latest: latest.raw,
    latestInRange: newerInRange?.raw,
    range: written,
    inRange,
  };
}

/** One line for a tooltip or the drawer. */
export function describeUpdate(u: ChartUpdate): string {
  switch (u.status) {
    case 'loading':
      return 'Reading the repository index…';
    case 'not-checked':
      return u.reason;
    case 'error':
      return u.message;
    case 'current':
      return `${u.installed} is the newest version in the repository index${u.inRange === false ? ` (outside the range ${u.range})` : ''}.`;
    default:
      if (u.inRange === true) {
        return `${u.latest} is inside the range ${u.range}: Flux installs it on the next reconcile of the HelmRepository and HelmRelease.`;
      }
      if (u.inRange === false) {
        return `${u.latest} is outside the range ${u.range}: change spec.chart.spec.version to install it.${
          u.latestInRange !== undefined
            ? ` ${u.latestInRange} is inside the range and is installed on the next reconcile.`
            : ''
        }`;
      }
      return `${u.latest} is newer. The range ${u.range} could not be read, so whether Flux picks it up is unknown.`;
  }
}
