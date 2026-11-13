import {
  Alert,
  AlertTitle,
  Box,
  Link,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
  useTheme,
} from '@mui/material';
import { useDatasourceClient, useDatasourceSelectValueToSelector } from '@perses-dev/plugin-system';
import { useQuery } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { useMemo } from 'react';

import type { Estate } from '../../model/estate';
import { displayName } from '../../model/estate';
import type { ReadFailure } from '../../model/fetch';
import type { FluxResources, KindRow, ReconcileRate } from '../../model/flux-resources';
import { buildFluxResources, fetchReconcileRates, imageTag } from '../../model/flux-resources';
import type { PrometheusRangeClient } from '../../model/history';
import type { FluxState } from '../../model/state';
import { STATE_ICON, STATE_LABEL } from '../../model/state';
import type { ResolvedOptions } from './flux-gitops-chart-types';
import { MONO, stateColor } from './style';
import { PROMETHEUS_DATASOURCE_KIND } from './useFluxData';

export interface ReconcileRates {
  rates?: Map<string, ReconcileRate>;
  error?: Error;
  loading: boolean;
}

/** Reconciles per minute and mean duration per Flux kind, over the panel's history range. */
export function useReconcileRates(
  o: ResolvedOptions,
  range: { start: number; end: number },
  cluster: string,
): ReconcileRates {
  const selector = useDatasourceSelectValueToSelector(
    o.prometheusDatasource ?? { kind: PROMETHEUS_DATASOURCE_KIND },
    PROMETHEUS_DATASOURCE_KIND,
  );
  const client = useDatasourceClient<PrometheusRangeClient>(selector);
  const q = useQuery<Map<string, ReconcileRate>, Error>({
    queryKey: ['FluxGitOpsChart', 'reconcile-rates', selector, cluster, range.start, range.end],
    enabled: client.isSuccess,
    keepPreviousData: true,
    queryFn: async () => fetchReconcileRates(client.data as PrometheusRangeClient, range, cluster),
  });
  return {
    rates: q.data,
    error: (client.error as Error | null) ?? q.error ?? undefined,
    loading: client.isLoading || (q.isLoading && q.fetchStatus !== 'idle'),
  };
}

interface ViewProps {
  estate: Estate;
  failures?: ReadFailure[];
  rates?: ReconcileRates;
  namespaces: string[];
  selected?: string;
  onSelect: (id: string) => void;
}

/** The tab: reads the reconcile rates (Prometheus), then renders the view. */
export function FluxResourcesTab(
  props: Omit<ViewProps, 'rates' | 'namespaces'> & {
    options: ResolvedOptions;
    range: { start: number; end: number };
    cluster: string;
  },
): ReactElement {
  const { options, range, cluster, ...rest } = props;
  const rates = useReconcileRates(options, range, cluster);
  return <FluxResourcesView {...rest} namespaces={options.namespaces} rates={rates} />;
}

function StateText({ state, label }: { state: FluxState; label?: string }): ReactElement {
  const theme = useTheme();
  return (
    <Box component="span" sx={{ color: stateColor(theme, state), fontWeight: 600, whiteSpace: 'nowrap' }}>
      {STATE_ICON[state]} {label ?? STATE_LABEL[state]}
    </Box>
  );
}

function Section({ title, caption, children }: { title: string; caption?: string; children: ReactNode }): ReactElement {
  return (
    <Box component="section" aria-label={title} sx={{ mb: 3 }}>
      <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
        {title}
      </Typography>
      {caption && (
        <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mb: 1 }}>
          {caption}
        </Typography>
      )}
      {children}
    </Box>
  );
}

function Facts({ rows }: { rows: Array<[string, ReactNode | undefined]> }): ReactElement {
  return (
    <Table size="small" aria-label="Flux installation" sx={{ maxWidth: 900 }}>
      <TableBody>
        {rows
          .filter(([, v]) => v !== undefined && v !== '')
          .map(([k, v]) => (
            <TableRow key={k}>
              <TableCell component="th" scope="row" sx={{ color: 'text.secondary', width: 200, whiteSpace: 'nowrap' }}>
                {k}
              </TableCell>
              <TableCell>{v}</TableCell>
            </TableRow>
          ))}
      </TableBody>
    </Table>
  );
}

function mono(value: string | undefined): ReactNode | undefined {
  return value === undefined ? undefined : (
    <Box component="span" sx={{ fontFamily: MONO, fontSize: 12 }}>
      {value}
    </Box>
  );
}

function Installation({ res, onSelect }: { res: FluxResources; onSelect: (id: string) => void }): ReactElement {
  const { instance, report } = res;
  const node = instance?.node;
  const sync = instance?.sync;
  const revision = instance?.lastAppliedRevision;
  const attempted =
    instance?.lastAttemptedRevision !== undefined && instance.lastAttemptedRevision !== revision
      ? instance.lastAttemptedRevision
      : undefined;
  return (
    <Facts
      rows={[
        [
          'FluxInstance',
          node === undefined ? undefined : (
            <Link
              key="instance"
              component="button"
              type="button"
              onClick={() => onSelect(node.id)}
              sx={{ fontSize: 'inherit' }}
            >
              {displayName(node)}
            </Link>
          ),
        ],
        [
          'Status',
          node === undefined ? undefined : (
            <>
              <StateText state={node.state} />
              {node.reason ? ` · ${node.reason}` : ''}
              {node.message ? (
                <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
                  {node.message}
                </Typography>
              ) : null}
            </>
          ),
        ],
        ['Flux version', report?.distribution?.version],
        ['Version requested', instance?.version],
        ['Distribution', report?.distribution?.status],
        ['Entitlement', report?.distribution?.entitlement],
        ['Registry', mono(instance?.registry)],
        ['Distribution artifact', mono(instance?.artifact)],
        ['Last applied revision', mono(revision)],
        ['Last attempted revision', mono(attempted)],
        ['Last artifact revision', mono(instance?.lastArtifactRevision)],
        ['Components requested', instance?.components.length ? instance.components.join(', ') : undefined],
        [
          'Sync source',
          sync === undefined
            ? mono(report?.sync?.source)
            : mono([sync.kind, sync.url, sync.ref, sync.path].filter((s) => s !== undefined).join(' · ')),
        ],
        [
          'Sync status',
          report?.sync === undefined ? undefined : (
            <>
              <StateText
                state={report.sync.ready ? 'ready' : 'failed'}
                label={report.sync.ready ? 'Ready' : 'Not ready'}
              />
              {report.sync.status ? ` · ${report.sync.status}` : ''}
            </>
          ),
        ],
        [
          'Flux Operator',
          report?.operatorVersion === undefined
            ? undefined
            : [report.operatorVersion, report.operatorPlatform].filter((s) => s !== undefined).join(' · '),
        ],
        [
          'Cluster',
          report?.cluster === undefined
            ? undefined
            : [
                report.cluster.serverVersion,
                report.cluster.platform,
                report.cluster.nodes === undefined ? undefined : `${report.cluster.nodes} nodes`,
              ]
                .filter((s) => s !== undefined)
                .join(' · '),
        ],
      ]}
    />
  );
}

function Controllers({
  res,
  selected,
  onSelect,
}: {
  res: FluxResources;
  selected?: string;
  onSelect: (id: string) => void;
}): ReactElement {
  if (res.controllersError !== undefined) {
    return (
      <Alert severity="error">
        <AlertTitle>Could not read the controller Deployments</AlertTitle>
        {res.controllersError}
      </Alert>
    );
  }
  if (res.controllers.length === 0) {
    return (
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        No Flux controller Deployments in what the panel read. When the namespaces option is set, it must include the
        namespace Flux runs in (usually flux-system).
      </Typography>
    );
  }
  return (
    <Table size="small" aria-label="Flux controllers">
      <TableHead>
        <TableRow>
          <TableCell>Status</TableCell>
          <TableCell>Controller</TableCell>
          <TableCell>Version</TableCell>
          <TableCell>Image</TableCell>
          <TableCell>Detail</TableCell>
        </TableRow>
      </TableHead>
      <TableBody>
        {res.controllers.map((c) => (
          <TableRow
            key={`${c.namespace ?? ''}/${c.name}`}
            hover={c.id !== undefined}
            selected={c.id !== undefined && c.id === selected}
            tabIndex={c.id === undefined ? undefined : 0}
            onClick={c.id === undefined ? undefined : () => onSelect(c.id as string)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && c.id !== undefined) onSelect(c.id);
            }}
            sx={{ cursor: c.id === undefined ? undefined : 'pointer' }}
          >
            <TableCell>
              <StateText state={c.ready ? 'ready' : 'failed'} label={c.ready ? 'Ready' : 'Not ready'} />
            </TableCell>
            <TableCell sx={{ fontWeight: 600 }}>
              {c.namespace === undefined ? c.name : `${c.namespace}/${c.name}`}
            </TableCell>
            <TableCell sx={{ fontFamily: MONO, fontSize: 12 }}>{imageTag(c.image) ?? ''}</TableCell>
            <TableCell sx={{ fontFamily: MONO, fontSize: 12, wordBreak: 'break-all' }}>{c.image ?? ''}</TableCell>
            <TableCell sx={{ fontSize: 12, color: 'text.secondary' }}>{c.status ?? ''}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function count(v: number | undefined): string {
  return v === undefined ? '–' : String(v);
}

function seconds(v: number | undefined): string {
  if (v === undefined) return '–';
  if (v < 1) return `${Math.round(v * 1000)} ms`;
  if (v < 60) return `${v.toFixed(1)} s`;
  return `${(v / 60).toFixed(1)} min`;
}

function perMinute(v: number | undefined): string {
  if (v === undefined) return '–';
  return v >= 10 ? v.toFixed(0) : v.toFixed(2);
}

function ProblemCount({ value }: { value: number | undefined }): ReactElement {
  return (
    <Box component="span" sx={{ color: value ? 'error.main' : undefined, fontWeight: value ? 700 : undefined }}>
      {count(value)}
    </Box>
  );
}

function Kinds({ res, rates }: { res: FluxResources; rates?: ReconcileRates }): ReactElement {
  const fromReport = res.kindsSource === 'report';
  const showRates = rates?.rates !== undefined && rates.rates.size > 0;
  const columns = fromReport
    ? ['Kind', 'Total', 'Running', 'Failing', 'Suspended', 'Artifact storage']
    : ['Kind', 'Total', 'Ready', 'Reconciling', 'Waiting', 'Failed', 'Suspended'];
  if (showRates) columns.push('Reconciles/min', 'Mean duration');
  const cells = (k: KindRow): ReactNode[] =>
    fromReport
      ? [
          count(k.total),
          count(k.running),
          <ProblemCount key="f" value={k.failing} />,
          count(k.suspended),
          k.totalSize ?? '–',
        ]
      : [
          count(k.total),
          count(k.ready),
          count(k.reconciling),
          count(k.waiting),
          <ProblemCount key="f" value={k.failed} />,
          count(k.suspended),
        ];
  return (
    <Table size="small" aria-label="Flux objects by kind">
      <TableHead>
        <TableRow>
          {columns.map((c, i) => (
            <TableCell key={c} align={i === 0 ? 'left' : 'right'}>
              {c}
            </TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {res.kinds.map((k) => {
          const rate = rates?.rates?.get(k.kind);
          const span = columns.length - 1;
          return (
            <TableRow key={`${k.apiVersion ?? ''}/${k.kind}`}>
              <TableCell sx={{ fontWeight: 600 }} title={k.apiVersion}>
                {k.kind}
              </TableCell>
              {k.error !== undefined && (
                <TableCell colSpan={span} sx={{ color: 'error.main' }}>
                  ✕ Not read: {k.error}
                </TableCell>
              )}
              {k.notInstalled && (
                <TableCell colSpan={span} sx={{ color: 'text.secondary' }}>
                  Not installed ({k.apiVersion} is not served)
                </TableCell>
              )}
              {k.error === undefined &&
                !k.notInstalled &&
                [...cells(k), ...(showRates ? [perMinute(rate?.perMinute), seconds(rate?.meanSeconds)] : [])].map(
                  (c, i) => (
                    // oxlint-disable-next-line react/no-array-index-key -- fixed columns
                    <TableCell key={i} align="right">
                      {c}
                    </TableCell>
                  ),
                )}
            </TableRow>
          );
        })}
      </TableBody>
    </Table>
  );
}

function ratesNote(rates: ReconcileRates | undefined): string {
  if (rates === undefined) return '';
  if (rates.loading) return 'Loading reconcile rates from Prometheus…';
  if (rates.error !== undefined) return `Reconcile rates not shown: ${rates.error.message}`;
  if (rates.rates === undefined || rates.rates.size === 0)
    return 'Reconcile rates not shown: Prometheus has no gotk_reconcile_duration_seconds (it must scrape the Flux controllers).';
  return 'Reconciles per minute and mean duration from gotk_reconcile_duration_seconds over the history range.';
}

/** The Flux installation: operator objects, controllers and per-kind counts, with where each number comes from. */
export function FluxResourcesView({
  estate,
  failures,
  rates,
  namespaces,
  selected,
  onSelect,
}: ViewProps): ReactElement {
  const res = useMemo(() => buildFluxResources(estate, failures), [estate, failures]);
  const reportName = res.report === undefined ? '' : `${res.report.namespace}/${res.report.name}`;
  const scope = namespaces.length > 0 ? ` in ${namespaces.join(', ')} (the namespaces option)` : '';
  const source =
    res.report !== undefined
      ? `From the Flux Operator: the FluxReport ${reportName}${res.instance?.node ? ` and the FluxInstance ${displayName(res.instance.node)}` : ''}. The operator refreshes the report on its own interval, so it can lag the live objects by a few minutes.`
      : `No FluxReport: controllers from the Flux controller Deployments, counts by the panel from the objects it read${scope}.`;
  return (
    <Box sx={{ p: 2 }}>
      <Alert severity="info" variant="outlined" sx={{ mb: 2 }}>
        {source}
      </Alert>
      {res.reportError !== undefined && (
        <Alert severity="warning" sx={{ mb: 2 }}>
          <AlertTitle>Could not read the FluxReport</AlertTitle>
          {res.reportError} The controllers and counts below come from the cluster instead.
        </Alert>
      )}
      {(res.instance !== undefined || res.report !== undefined) && (
        <Section title="Flux installation">
          <Installation res={res} onSelect={onSelect} />
        </Section>
      )}
      <Section
        title="Controllers"
        caption={
          res.controllersSource === 'report'
            ? 'FluxReport spec.components'
            : 'Deployments named like the Flux controllers (apps/v1)'
        }
      >
        <Controllers res={res} selected={selected} onSelect={onSelect} />
      </Section>
      <Section
        title="Objects by kind"
        caption={
          res.kindsSource === 'report'
            ? 'FluxReport spec.reconcilers, cluster-wide. Running counts every object that is not suspended, failing ones included.'
            : `Counted by the panel${scope}. Ready includes drift corrected and reconcile disabled; reconciling includes out of sync.`
        }
      >
        <Kinds res={res} rates={rates} />
        {rates !== undefined && (
          <Typography variant="caption" component="p" sx={{ color: 'text.secondary', mt: 1 }}>
            {ratesNote(rates)}
          </Typography>
        )}
      </Section>
    </Box>
  );
}
