import { describe, expect, it } from 'vitest';

import { nodeId } from './estate';
import {
  bandsFromSeries,
  durationQuery,
  fetchHistory,
  ksmQuery,
  operatorQuery,
  parseDuration,
  stateFromLabels,
  stepFor,
} from './history';
import type { PrometheusRangeClient, PromRangeResponse } from './history';

const K = (ns: string, name: string): string => nodeId('kustomize.toolkit.fluxcd.io', 'Kustomization', ns, name);

describe('queries', () => {
  it('match the exporters', () => {
    expect(operatorQuery('Kustomization')).toBe('flux_resource_info{kind="Kustomization"}');
    expect(ksmQuery('Kustomization', 'c"1')).toBe(
      'gotk_resource_info{customresource_kind="Kustomization",cluster="c\\"1"}',
    );
    expect(durationQuery('Kustomization', '5m')).toContain(
      'gotk_reconcile_duration_seconds_sum{kind="Kustomization"}[5m]',
    );
  });
});

describe('stateFromLabels', () => {
  it.each([
    [{ ready: 'True' }, 'ready'],
    [{ ready: 'False', reason: 'DependencyNotReady' }, 'waiting'],
    [{ ready: 'False', reason: 'HealthCheckFailed' }, 'failed'],
    [{ ready: 'Unknown' }, 'reconciling'],
    [{ ready: 'True', suspended: 'true' }, 'suspended'],
  ])('%j', (labels, state) => expect(stateFromLabels(labels as Record<string, string>)).toBe(state));
});

describe('bandsFromSeries', () => {
  it('merges points into bands and marks revision changes', () => {
    const { bands, marks } = bandsFromSeries(
      [
        {
          metric: { name: 'apps', exported_namespace: 'flux-system', ready: 'True', revision: 'main@sha1:a' },
          values: [
            [0, '1'],
            [60, '1'],
          ],
        },
        {
          metric: { name: 'apps', exported_namespace: 'flux-system', ready: 'False', revision: 'main@sha1:b' },
          values: [
            [120, '1'],
            [180, '1'],
          ],
        },
        {
          metric: { name: 'apps', exported_namespace: 'flux-system', ready: 'True', revision: 'main@sha1:b' },
          values: [[240, '1']],
        },
      ],
      60,
    );
    expect(bands.get(K('flux-system', 'apps'))).toEqual([
      { start: 0, end: 120, state: 'ready' },
      { start: 120, end: 240, state: 'failed' },
      { start: 240, end: 300, state: 'ready' },
    ]);
    expect(marks.get(K('flux-system', 'apps'))).toEqual([{ t: 120, revision: 'main@sha1:b' }]);
  });

  it('the worse state wins when two series share a timestamp', () => {
    const { bands } = bandsFromSeries(
      [
        { metric: { name: 'a', namespace: 'x', ready: 'True' }, values: [[0, '1']] },
        { metric: { name: 'a', namespace: 'x', ready: 'False' }, values: [[0, '1']] },
      ],
      30,
    );
    expect(bands.get(K('x', 'a'))?.[0]?.state).toBe('failed');
  });
});

describe('durations and steps', () => {
  it('parses Perses durations', () => {
    expect(parseDuration('6h')).toBe(21600);
    expect(parseDuration('1d')).toBe(86400);
    expect(parseDuration('nope')).toBeUndefined();
  });
  it('steps', () => {
    expect(stepFor(0, 600)).toBe(15);
    expect(stepFor(0, 86400)).toBe(360);
  });
});

describe('fetchHistory', () => {
  const series = (ready: string): PromRangeResponse => ({
    status: 'success',
    data: {
      resultType: 'matrix',
      result: [{ metric: { name: 'apps', exported_namespace: 'flux-system', ready }, values: [[0, '1']] }],
    },
  });

  it('uses the Flux Operator when it answers', async () => {
    const client: PrometheusRangeClient = {
      rangeQuery: async ({ query }) =>
        query.startsWith('flux_resource_info') ? series('True') : { data: { result: [] } },
    };
    const h = await fetchHistory(client, { start: 0, end: 600 });
    expect(h.source).toBe('flux-operator');
    expect(h.bands.get(K('flux-system', 'apps'))?.[0]?.state).toBe('ready');
  });

  it('falls back to kube-state-metrics, then to none', async () => {
    const ksm: PrometheusRangeClient = {
      rangeQuery: async ({ query }) =>
        query.startsWith('gotk_resource_info') ? series('False') : { data: { result: [] } },
    };
    expect((await fetchHistory(ksm, { start: 0, end: 600 })).source).toBe('kube-state-metrics');
    const none: PrometheusRangeClient = { rangeQuery: async () => ({ data: { result: [] } }) };
    expect((await fetchHistory(none, { start: 0, end: 600 })).source).toBe('none');
  });

  it('reads mean reconcile durations', async () => {
    const client: PrometheusRangeClient = {
      rangeQuery: async ({ query }) =>
        query.includes('gotk_reconcile_duration_seconds')
          ? {
              data: {
                result: [
                  {
                    metric: { name: 'apps', namespace: 'flux-system' },
                    values: [
                      [0, '0.5'],
                      [60, '1.25'],
                    ],
                  },
                ],
              },
            }
          : { data: { result: [] } },
    };
    expect((await fetchHistory(client, { start: 0, end: 600 })).durations.get(K('flux-system', 'apps'))).toBe(1.25);
  });
});
