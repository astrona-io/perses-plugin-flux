import {
  replaceVariablesInString,
  useAllVariableValues,
  useDatasourceClient,
  useDatasourceSelectValueToSelector,
  useTimeRange,
} from '@perses-dev/plugin-system';
import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

import type { Estate } from '../../model/estate';
import { buildEstate } from '../../model/estate';
import type { FetchResult, KubernetesListClient, ReadProblem } from '../../model/fetch';
import { describeFailures, fetchEstate } from '../../model/fetch';
import type { History, PrometheusRangeClient } from '../../model/history';
import { fetchHistory, parseDuration } from '../../model/history';
import type { ResolvedOptions } from './flux-gitops-chart-types';

export const KUBERNETES_DATASOURCE_KIND = 'KubernetesDatasource';
export const PROMETHEUS_DATASOURCE_KIND = 'PrometheusDatasource';

export interface FluxData {
  estate?: Estate;
  problems: ReadProblem[];
  requests: number;
  isLoading: boolean;
  /** A fatal error: no datasource, or every request failed. */
  error?: Error;
  history?: History;
  historyError?: Error;
  historyLoading: boolean;
  cluster: string;
  range: { start: number; end: number };
}

/** Splits `a, b` and `{a,b}` (a variable in csv or default format) into namespaces. */
export function splitList(values: string[]): string[] {
  return values
    .flatMap((v) => v.replace(/^[{(]|[})]$/g, '').split(/[,|\s]+/))
    .map((s) => s.trim())
    .filter((s) => s !== '' && s !== '$__all' && s !== '*');
}

export function useFluxData(o: ResolvedOptions): FluxData {
  const variables = useAllVariableValues();
  const expand = (s: string | undefined): string =>
    s === undefined || s === '' ? '' : replaceVariablesInString(s, variables).trim();
  const namespaces = useMemo(
    () => splitList(o.namespaces.map((n) => replaceVariablesInString(n, variables))),
    [o.namespaces, variables],
  );
  const cluster = expand(o.cluster);
  const root = expand(o.rootKustomization);

  const kSelector = useDatasourceSelectValueToSelector(
    o.kubernetesDatasource ?? { kind: KUBERNETES_DATASOURCE_KIND },
    KUBERNETES_DATASOURCE_KIND,
  );
  const kClient = useDatasourceClient<KubernetesListClient>(kSelector);
  const { absoluteTimeRange } = useTimeRange();
  const end = Math.floor(absoluteTimeRange.end.getTime() / 1000);
  const rangeSeconds =
    parseDuration(o.historyRange) ?? Math.max(60, end - Math.floor(absoluteTimeRange.start.getTime() / 1000));
  const range = { start: end - rangeSeconds, end };

  const live = useQuery<FetchResult, Error>({
    queryKey: ['FluxGitOpsChart', 'estate', kSelector, namespaces, o.showPods, end],
    enabled: kClient.isSuccess,
    keepPreviousData: true,
    queryFn: async ({ signal }) =>
      fetchEstate(kClient.data as KubernetesListClient, { namespaces, showPods: o.showPods, signal }),
  });

  const estate = useMemo(
    () =>
      live.data === undefined
        ? undefined
        : buildEstate(live.data, { rootKustomization: root, namespaces, now: end * 1000 }),
    [live.data, root, namespaces, end],
  );
  const problems = useMemo(() => (live.data === undefined ? [] : describeFailures(live.data)), [live.data]);

  const pSelector = useDatasourceSelectValueToSelector(
    o.prometheusDatasource ?? { kind: PROMETHEUS_DATASOURCE_KIND },
    PROMETHEUS_DATASOURCE_KIND,
  );
  const pClient = useDatasourceClient<PrometheusRangeClient>(pSelector);
  const history = useQuery<History, Error>({
    queryKey: ['FluxGitOpsChart', 'history', pSelector, cluster, range.start, range.end],
    enabled: o.showHistory && pClient.isSuccess,
    keepPreviousData: true,
    queryFn: async () => fetchHistory(pClient.data as PrometheusRangeClient, range, cluster),
  });

  const fatal =
    kClient.error instanceof Error
      ? new Error(`Kubernetes datasource: ${kClient.error.message}`)
      : (live.error ?? undefined);

  return {
    estate,
    problems,
    requests: live.data?.requests ?? 0,
    isLoading: kClient.isLoading || (live.isLoading && live.fetchStatus !== 'idle'),
    error: fatal ?? undefined,
    history: history.data,
    historyError: (pClient.error as Error | null) ?? history.error ?? undefined,
    historyLoading: history.isLoading && history.fetchStatus !== 'idle',
    cluster,
    range,
  };
}
