// The "Flux resources" view: the Flux installation itself, its controllers and how many objects of
// each Flux kind are in which state. Two sources, and the view always says which one it shows:
// - the Flux Operator's FluxReport `spec` (components, reconcilers with per-kind stats), and
// - without it, the controller Deployments and the panel's own count over the estate.
// A list that could not be read is shown as its error, never as zero.
// Pure: the panel hands it the estate and the read failures.

import type { Estate, EstateNode, FluxInstanceSummary, FluxReportSummary } from './estate';
import { FLUX_CONTROLLERS } from './estate';
import type { ReadFailure } from './fetch';
import { RESOURCES, resourceKey } from './fetch';
import type { PrometheusRangeClient } from './history';
import { clusterMatcher } from './history';
import type { FluxState } from './state';

export interface ControllerRow {
  name: string;
  namespace?: string;
  /** The estate id of the Deployment, when the panel read it. */
  id?: string;
  image?: string;
  ready: boolean;
  /** `ready/desired` replicas (Deployments) or the operator's status line (FluxReport). */
  status?: string;
}

/** Per-kind counts. A count is undefined when its source does not give it. */
export interface KindRow {
  kind: string;
  apiVersion?: string;
  total?: number;
  // FluxReport stats (`spec.reconcilers[].stats`)
  running?: number;
  failing?: number;
  suspended?: number;
  totalSize?: string;
  // The panel's own count, by display state
  ready?: number;
  reconciling?: number;
  waiting?: number;
  failed?: number;
  /** The list failed: the message, and no counts. */
  error?: string;
  /** The API is not served (CRD not installed). */
  notInstalled?: boolean;
}

export interface FluxResources {
  instance?: FluxInstanceSummary & { node?: EstateNode };
  report?: FluxReportSummary;
  /** Why the FluxReport is missing although the operator is installed. */
  reportError?: string;
  controllers: ControllerRow[];
  controllersSource: 'report' | 'deployments';
  /** The Deployment list failed, so the controllers are unknown. */
  controllersError?: string;
  kinds: KindRow[];
  kindsSource: 'report' | 'estate';
}

function failureFor(failures: ReadFailure[], key: string): ReadFailure | undefined {
  return failures.find((f) => f.resource === key && f.kind !== 'not-installed');
}

/** The Flux controller Deployments the panel read, the way the Flux Operator reports components. */
function deploymentRows(estate: Estate): ControllerRow[] {
  const rows: ControllerRow[] = [];
  for (const n of estate.nodes.values()) {
    if (n.kind !== 'Deployment' || n.group !== 'apps' || !n.live || !FLUX_CONTROLLERS.test(n.name)) continue;
    rows.push({
      name: n.name,
      namespace: n.namespace,
      id: n.id,
      image: n.images?.[0],
      ready: n.state === 'ready',
      status: n.replicas === undefined ? n.note : `${n.replicas.ready}/${n.replicas.desired} ready`,
    });
  }
  return rows.toSorted((a, b) => a.name.localeCompare(b.name));
}

type Bucket = 'ready' | 'reconciling' | 'waiting' | 'failed' | 'suspended';

/** Display states counted per kind; drift and reconcile-disabled are ready, out of sync is reconciling. */
const BUCKET: Record<FluxState, Bucket | undefined> = {
  ready: 'ready',
  drift: 'ready',
  disabled: 'ready',
  reconciling: 'reconciling',
  outofsync: 'reconciling',
  waiting: 'waiting',
  failed: 'failed',
  suspended: 'suspended',
  unknown: undefined,
};

/** Counts the Flux kinds the panel lists, by state. A failed list gives its error instead. */
export function countKinds(estate: Estate, failures: ReadFailure[]): KindRow[] {
  const rows: KindRow[] = [];
  for (const r of RESOURCES) {
    if (r.set !== 'flux' && !(r.set === 'operator' && estate.operator && r.kind !== 'FluxReport')) continue;
    const key = resourceKey(r);
    const apiVersion = `${r.group}/${r.version}`;
    const failed = failureFor(failures, key);
    if (failed !== undefined) {
      rows.push({ kind: r.kind, apiVersion, error: failed.message });
      continue;
    }
    const counts: Record<Bucket, number> = { ready: 0, reconciling: 0, waiting: 0, failed: 0, suspended: 0 };
    let total = 0;
    for (const n of estate.nodes.values()) {
      if (!n.live || n.group !== r.group || n.kind !== r.kind) continue;
      total++;
      const bucket = BUCKET[n.state];
      if (bucket !== undefined) counts[bucket]++;
    }
    // Only a 404 is left in the failures for this kind: the API is not served.
    if (total === 0 && failures.some((f) => f.resource === key)) {
      rows.push({ kind: r.kind, apiVersion, notInstalled: true });
      continue;
    }
    rows.push({ kind: r.kind, apiVersion, total, ...counts });
  }
  return rows;
}

function reportKinds(report: FluxReportSummary): KindRow[] {
  return report.reconcilers.map((r) => ({
    kind: r.kind,
    apiVersion: r.apiVersion,
    // The operator counts running as total minus suspended (internal/reporter/reconcilers.go).
    total: r.running !== undefined && r.suspended !== undefined ? r.running + r.suspended : undefined,
    running: r.running,
    failing: r.failing,
    suspended: r.suspended,
    totalSize: r.totalSize,
  }));
}

export function buildFluxResources(estate: Estate, failures: ReadFailure[] = []): FluxResources {
  const instance =
    estate.instance === undefined ? undefined : { ...estate.instance, node: estate.nodes.get(estate.instance.id) };
  const report = estate.report;
  const reportFailure = failureFor(failures, 'fluxcd.controlplane.io/FluxReport');
  const reportError =
    report === undefined && estate.operator
      ? (reportFailure?.message ??
        'The Flux Operator is installed but no FluxReport was found (the operator creates flux-system/flux).')
      : undefined;

  const deploymentFailure = failureFor(failures, 'apps/Deployment');
  const useReportComponents = report !== undefined && report.components.length > 0;
  const controllers = useReportComponents
    ? report.components.map((c) => ({ name: c.name, image: c.image, ready: c.ready, status: c.status }))
    : deploymentRows(estate);

  const useReportKinds = report !== undefined && report.reconcilers.length > 0;
  return {
    instance,
    report,
    reportError,
    controllers,
    controllersSource: useReportComponents ? 'report' : 'deployments',
    controllersError: !useReportComponents && deploymentFailure !== undefined ? deploymentFailure.message : undefined,
    kinds: useReportKinds ? reportKinds(report) : countKinds(estate, failures),
    kindsSource: useReportKinds ? 'report' : 'estate',
  };
}

/** The tag of an image reference (`ghcr.io/fluxcd/source-controller:v1.8.0` → `v1.8.0`), digest dropped. */
export function imageTag(image: string | undefined): string | undefined {
  if (image === undefined) return undefined;
  const ref = image.split('@')[0] ?? image;
  const slash = ref.lastIndexOf('/');
  const colon = ref.lastIndexOf(':');
  return colon > slash ? ref.slice(colon + 1) : undefined;
}

// ---------- reconcile rate and duration per kind, from Prometheus ----------

export interface ReconcileRate {
  /** Reconciles per minute, averaged over the range. */
  perMinute?: number;
  /** Mean reconcile duration over the range, seconds. */
  meanSeconds?: number;
}

/** `gotk_reconcile_duration_seconds` (every Flux controller), summed per Flux kind over the window. */
export function rateQueries(windowSeconds: number, cluster?: string): { count: string; mean: string } {
  const sel = clusterMatcher(cluster).replace(/^,/, '');
  const w = `${Math.max(60, Math.round(windowSeconds))}s`;
  const count = `sum by (kind) (rate(gotk_reconcile_duration_seconds_count{${sel}}[${w}]))`;
  const sum = `sum by (kind) (rate(gotk_reconcile_duration_seconds_sum{${sel}}[${w}]))`;
  return { count, mean: `${sum} / ${count}` };
}

function lastValues(
  result: Array<{ metric: Record<string, string>; values?: Array<[number, string]> }> | undefined,
): Map<string, number> {
  const out = new Map<string, number>();
  for (const s of result ?? []) {
    const kind = s.metric.kind;
    const last = s.values?.[s.values.length - 1];
    const v = last === undefined ? Number.NaN : Number(last[1]);
    if (kind !== undefined && Number.isFinite(v)) out.set(kind, v);
  }
  return out;
}

/** One point at the end of the range, each a rate over the whole range. */
export async function fetchReconcileRates(
  client: PrometheusRangeClient,
  range: { start: number; end: number },
  cluster?: string,
): Promise<Map<string, ReconcileRate>> {
  const q = rateQueries(range.end - range.start, cluster);
  const run = async (query: string): Promise<Map<string, number>> => {
    const res = await client.rangeQuery({ query, start: range.end, end: range.end, step: 60 });
    if (res.status === 'error') throw new Error(res.error ?? 'Prometheus query failed');
    return lastValues(res.data?.result);
  };
  const [count, mean] = await Promise.all([run(q.count), run(q.mean)]);
  const out = new Map<string, ReconcileRate>();
  for (const [kind, perSecond] of count) out.set(kind, { perMinute: perSecond * 60 });
  for (const [kind, seconds] of mean) out.set(kind, { ...out.get(kind), meanSeconds: seconds });
  return out;
}
