// The reconcile history strip: Ready bands per Kustomization and revision markers, from Prometheus.
//
// Two exporters write the same facts under different names (docs/metrics.md):
// - the Flux Operator: flux_resource_info{kind, name, exported_namespace, ready, suspended, revision}
// - kube-state-metrics with the Flux custom-resource-state config (deploy/kube-state-metrics-config.yaml):
//   gotk_resource_info{customresource_kind, name, exported_namespace, ready, suspended, revision}
// The panel asks the operator first and falls back to kube-state-metrics.
// Durations come from the controllers: gotk_reconcile_duration_seconds{kind, name, namespace}.

import { nodeId } from './estate';
import type { FluxState } from './state';

/** The part of the Prometheus datasource client this panel uses (@perses-dev/prometheus-plugin). */
export interface PrometheusRangeClient {
  rangeQuery(params: { query: string; start: number; end: number; step: number }): Promise<PromRangeResponse>;
}

export interface PromRangeResponse {
  status?: string;
  error?: string;
  data?: { resultType?: string; result?: Array<{ metric: Record<string, string>; values?: Array<[number, string]> }> };
}

export interface Band {
  start: number;
  end: number;
  state: FluxState;
}

export interface RevisionMark {
  t: number;
  revision: string;
}

export interface History {
  /** Keyed by Kustomization id. */
  bands: Map<string, Band[]>;
  marks: Map<string, RevisionMark[]>;
  /** Mean reconcile duration over the range, seconds. */
  durations: Map<string, number>;
  /** Which exporter answered. */
  source: 'flux-operator' | 'kube-state-metrics' | 'none';
  start: number;
  end: number;
}

const KS_ID_GROUP = 'kustomize.toolkit.fluxcd.io';

/** A label matcher value, escaped for PromQL double quotes. */
function q(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function clusterMatcher(cluster: string | undefined): string {
  return cluster === undefined || cluster === '' ? '' : `,cluster="${q(cluster)}"`;
}

export function operatorQuery(kind: string, cluster?: string): string {
  return `flux_resource_info{kind="${q(kind)}"${clusterMatcher(cluster)}}`;
}

export function ksmQuery(kind: string, cluster?: string): string {
  return `gotk_resource_info{customresource_kind="${q(kind)}"${clusterMatcher(cluster)}}`;
}

export function durationQuery(kind: string, window: string, cluster?: string): string {
  const sel = `{kind="${q(kind)}"${clusterMatcher(cluster)}}`;
  return (
    `sum by (name, exported_namespace, namespace) (rate(gotk_reconcile_duration_seconds_sum${sel}[${window}]))` +
    ` / sum by (name, exported_namespace, namespace) (rate(gotk_reconcile_duration_seconds_count${sel}[${window}]))`
  );
}

/** One _info series' labels to a state, the way the panel maps conditions. */
export function stateFromLabels(labels: Record<string, string>): FluxState {
  if (labels.suspended === 'true') return 'suspended';
  switch (labels.ready) {
    case 'True':
      return 'ready';
    case 'False':
      return labels.reason === 'DependencyNotReady' ? 'waiting' : 'failed';
    case 'Unknown':
      return 'reconciling';
    default:
      return 'unknown';
  }
}

/** The object's namespace: exported_namespace when the scrape renamed it, else namespace. */
export function objectNamespace(labels: Record<string, string>): string {
  return labels.exported_namespace ?? labels.namespace ?? '';
}

/**
 * Turns _info series into bands. An _info series exists while its label set holds, so each series
 * is one stretch of one state and revision; overlapping stretches are merged in time order.
 */
export function bandsFromSeries(
  result: Array<{ metric: Record<string, string>; values?: Array<[number, string]> }>,
  step: number,
  group = KS_ID_GROUP,
  kind = 'Kustomization',
): { bands: Map<string, Band[]>; marks: Map<string, RevisionMark[]> } {
  const points = new Map<string, Array<{ t: number; state: FluxState; revision?: string }>>();
  for (const series of result) {
    const name = series.metric.name;
    if (name === undefined) continue;
    const id = nodeId(group, kind, objectNamespace(series.metric), name);
    const state = stateFromLabels(series.metric);
    const revision = series.metric.revision;
    const list = points.get(id) ?? [];
    for (const [t] of series.values ?? []) list.push({ t, state, revision });
    points.set(id, list);
  }
  const bands = new Map<string, Band[]>();
  const marks = new Map<string, RevisionMark[]>();
  for (const [id, list] of points) {
    list.sort((a, b) => a.t - b.t || severity(b.state) - severity(a.state));
    const out: Band[] = [];
    const m: RevisionMark[] = [];
    let lastRevision: string | undefined;
    let lastT: number | undefined;
    for (const p of list) {
      if (p.t === lastT) continue; // two series at one timestamp: the worse state (sorted first) wins
      lastT = p.t;
      const prev = out[out.length - 1];
      if (prev !== undefined && prev.state === p.state && p.t - prev.end <= step * 1.5) prev.end = p.t + step;
      else out.push({ start: p.t, end: p.t + step, state: p.state });
      if (p.revision !== undefined && p.revision !== '' && p.revision !== lastRevision) {
        if (lastRevision !== undefined) m.push({ t: p.t, revision: p.revision });
        lastRevision = p.revision;
      }
    }
    bands.set(id, out);
    marks.set(id, m);
  }
  return { bands, marks };
}

function severity(s: FluxState): number {
  const rank: Partial<Record<FluxState, number>> = { failed: 3, waiting: 2, reconciling: 1 };
  return rank[s] ?? 0;
}

/** Step that gives about 240 points over the range, at least 15 s. */
export function stepFor(start: number, end: number): number {
  return Math.max(15, Math.ceil((end - start) / 240));
}

/** Parses 30m, 6h, 1d, 2w into seconds; undefined when unset or invalid. */
export function parseDuration(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const m = /^(\d+)(ms|s|m|h|d|w|y)$/.exec(value);
  if (m === null) return undefined;
  const n = Number(m[1]);
  const unit = { ms: 0.001, s: 1, m: 60, h: 3600, d: 86400, w: 604800, y: 31536000 }[m[2] as 'ms'];
  return n * unit;
}

export async function fetchHistory(
  client: PrometheusRangeClient,
  range: { start: number; end: number },
  cluster?: string,
): Promise<History> {
  const step = stepFor(range.start, range.end);
  const window = `${Math.max(60, step * 4)}s`;
  const run = async (query: string): Promise<PromRangeResponse> =>
    client.rangeQuery({ query, start: range.start, end: range.end, step });
  const [op, durations] = await Promise.all([
    run(operatorQuery('Kustomization', cluster)),
    run(durationQuery('Kustomization', window, cluster)).catch(() => undefined),
  ]);
  let result = op.data?.result ?? [];
  let source: History['source'] = 'flux-operator';
  if (result.length === 0) {
    const ksm = await run(ksmQuery('Kustomization', cluster));
    result = ksm.data?.result ?? [];
    source = result.length === 0 ? 'none' : 'kube-state-metrics';
  }
  const { bands, marks } = bandsFromSeries(result, step);
  const dur = new Map<string, number>();
  for (const s of durations?.data?.result ?? []) {
    const name = s.metric.name;
    const last = s.values?.[s.values.length - 1];
    const v = last === undefined ? Number.NaN : Number(last[1]);
    if (name !== undefined && Number.isFinite(v))
      dur.set(nodeId(KS_ID_GROUP, 'Kustomization', objectNamespace(s.metric), name), v);
  }
  return { bands, marks, durations: dur, source, start: range.start, end: range.end };
}
