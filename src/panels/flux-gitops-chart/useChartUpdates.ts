import { useEffect, useMemo, useRef, useState } from 'react';

import type { ChartVersions, IndexReader } from '../../model/chart-index';
import { IndexReadError, loadChartVersions } from '../../model/chart-index';
import type { ChartTarget, ChartUpdate } from '../../model/chart-updates';
import { chartTargets, compareVersions } from '../../model/chart-updates';
import type { Estate } from '../../model/estate';
import type { FailureKind } from '../../model/fetch';

type IndexResult =
  | { ok: true; charts: Set<string>; versions: ChartVersions }
  | { ok: false; charts: Set<string>; message: string; failure: FailureKind };

const FAILURE_HINT: Partial<Record<FailureKind, string>> = {
  forbidden:
    'The datasource service account may not use the source-controller service proxy: apply the services/proxy rule in deploy/rbac.yaml.',
  'proxy-endpoint':
    "The datasource's allowedEndpoints do not include the source-controller proxy path: use deploy/kubernetes-datasource.json.",
};

function updateFor(target: ChartTarget, result: IndexResult | undefined): ChartUpdate {
  if (target.kind === 'not-checked')
    return { status: 'not-checked', reason: target.reason, installed: target.installed };
  if (target.kind === 'error') return { status: 'error', message: target.message, installed: target.installed };
  if (result === undefined || !result.charts.has(target.chart))
    return { status: 'loading', installed: target.installed };
  if (!result.ok) {
    const hint = FAILURE_HINT[result.failure];
    return {
      status: 'error',
      message: `Could not read the repository index: ${result.message}${hint === undefined ? '' : ` ${hint}`}`,
      failure: result.failure,
      installed: target.installed,
    };
  }
  const versions = result.versions.get(target.chart);
  if (versions === undefined) {
    return {
      status: 'error',
      message: `Chart ${target.chart} is not in the repository index.`,
      installed: target.installed,
    };
  }
  return compareVersions(target.installed, versions, target.range);
}

/**
 * Chart updates for HelmReleases, read lazily: `scope` is `all` for the List view, a node id for the
 * drawer, undefined when neither needs them. Undefined while disabled or without a reader.
 */
export function useChartUpdates(
  estate: Estate | undefined,
  reader: IndexReader | undefined,
  enabled: boolean,
  scope: 'all' | string | undefined,
): Map<string, ChartUpdate> | undefined {
  const active = enabled && reader !== undefined && estate !== undefined && scope !== undefined;
  const targets = useMemo(
    () => (!enabled || estate === undefined ? undefined : chartTargets(estate)),
    [enabled, estate],
  );
  // One group per index path; recomputed on every refresh, which is when a failed read is retried.
  const needed = useMemo(() => {
    const groups = new Map<string, { repo: string; path: string; charts: Set<string> }>();
    if (!active || targets === undefined) return [];
    for (const [id, t] of targets) {
      if ((scope !== 'all' && id !== scope) || t.kind !== 'index') continue;
      const g = groups.get(t.path) ?? { repo: t.repo, path: t.path, charts: new Set<string>() };
      g.charts.add(t.chart);
      groups.set(t.path, g);
    }
    return [...groups.values()];
  }, [active, targets, scope]);
  const [results, setResults] = useState<Map<string, IndexResult>>(new Map());
  // `<path>#<chart>` pairs already read: a refresh does not ask for them again.
  const loaded = useRef(new Set<string>());

  useEffect(() => {
    if (reader === undefined) return undefined;
    let cancelled = false;
    for (const g of needed) {
      const charts = [...g.charts];
      if (charts.every((c) => loaded.current.has(`${g.path}#${c}`))) continue;
      // The module cache makes this one request per index path, however often it is called.
      loadChartVersions(reader, g.repo, g.path, charts).then(
        (versions) => {
          for (const c of charts) loaded.current.add(`${g.path}#${c}`);
          if (!cancelled) setResults((m) => new Map(m).set(g.path, { ok: true, charts: g.charts, versions }));
        },
        (e: unknown) => {
          if (cancelled) return;
          const message = e instanceof Error ? e.message : String(e);
          const failure = e instanceof IndexReadError ? e.failure : 'error';
          setResults((m) => new Map(m).set(g.path, { ok: false, charts: g.charts, message, failure }));
        },
      );
    }
    return (): void => {
      cancelled = true;
    };
  }, [reader, needed]);

  return useMemo(() => {
    if (!active || targets === undefined) return undefined;
    const out = new Map<string, ChartUpdate>();
    for (const [id, t] of targets) {
      if (scope !== 'all' && id !== scope) continue;
      out.set(id, updateFor(t, t.kind === 'index' ? results.get(t.path) : undefined));
    }
    return out;
  }, [active, targets, scope, results]);
}
