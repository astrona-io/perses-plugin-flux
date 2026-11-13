import {
  Alert,
  Box,
  Button,
  Chip,
  IconButton,
  Link,
  Table,
  TableBody,
  TableCell,
  TableRow,
  Typography,
  useTheme,
} from '@mui/material';
import type { ReactElement, ReactNode } from 'react';

import type { ChartUpdate } from '../../model/chart-updates';
import { describeUpdate } from '../../model/chart-updates';
import type { DeleteImpact } from '../../model/delete-impact';
import { DELETE_LABEL, FAIL_LABEL, KEEP_LABEL, impactSummary, sortedDeleted } from '../../model/delete-impact';
import type { Estate, EstateNode } from '../../model/estate';
import { displayName } from '../../model/estate';
import { STATE_ICON, STATE_LABEL, shortRevision } from '../../model/state';
import { ChartUpdateLabel } from './ChartUpdate';
import { commitLink, fluxWebLink } from './links';
import { MONO, stateColor } from './style';

function Section({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <Box component="section" aria-label={title} sx={{ mt: 2 }}>
      <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.6 }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

function Ref({ estate, id, onSelect }: { estate: Estate; id: string; onSelect: (id: string) => void }): ReactElement {
  const theme = useTheme();
  const n = estate.nodes.get(id);
  if (n === undefined) return <span style={{ fontFamily: MONO }}>{id.split('|').slice(1).join('/')}</span>;
  return (
    <Link component="button" type="button" onClick={() => onSelect(id)} sx={{ fontSize: 'inherit', textAlign: 'left' }}>
      <span style={{ color: stateColor(theme, n.state) }} aria-label={STATE_LABEL[n.state]}>
        {STATE_ICON[n.state]}
      </span>{' '}
      {n.kind} {displayName(n)}
    </Link>
  );
}

export interface DetailsProps {
  estate: Estate;
  node: EstateNode;
  blocks: string[];
  fluxWebUIUrl?: string;
  gitCommitUrl?: string;
  deleteEnabled: boolean;
  /** For a HelmRelease, when the chart update check is on. */
  chartUpdate?: ChartUpdate;
  onSelect: (id: string) => void;
  onInventory: (id: string) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}

/** Details of one object: conditions, revisions, Helm history, what it blocks, links. */
export function Details(props: DetailsProps): ReactElement {
  const {
    estate,
    node: n,
    blocks,
    fluxWebUIUrl,
    gitCommitUrl,
    deleteEnabled,
    chartUpdate,
    onSelect,
    onInventory,
    onDelete,
    onClose,
  } = props;
  const theme = useTheme();
  const source = n.sourceRef === undefined ? undefined : estate.nodes.get(n.sourceRef);
  const web = n.role !== undefined ? fluxWebLink(fluxWebUIUrl, n) : undefined;
  const revisions: Array<[string, string | undefined]> = [
    ['Applied', n.appliedRevision],
    ['Attempted', n.attemptedRevision !== n.appliedRevision ? n.attemptedRevision : undefined],
    ['Source', n.sourceRevision !== n.appliedRevision ? n.sourceRevision : undefined],
    ['Commit', n.originRevision !== n.appliedRevision ? n.originRevision : undefined],
  ];
  const deletable = n.role !== undefined && n.role !== 'fluxreport';
  let severity: 'error' | 'success' | 'info' = 'info';
  if (n.state === 'failed') severity = 'error';
  else if (n.state === 'ready') severity = 'success';
  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography variant="caption" sx={{ color: 'text.secondary' }}>
            {n.kind}
            {n.namespace ? ` · ${n.namespace}` : ''}
          </Typography>
          <Typography variant="h6" sx={{ wordBreak: 'break-all', lineHeight: 1.3 }}>
            {n.name}
          </Typography>
          <Typography sx={{ color: stateColor(theme, n.state), fontWeight: 600 }}>
            {STATE_ICON[n.state]} {STATE_LABEL[n.state]}
            {n.reason ? ` · ${n.reason}` : ''}
          </Typography>
        </Box>
        <IconButton aria-label="Close details" size="small" onClick={onClose}>
          ✕
        </IconButton>
      </Box>
      {n.message && (
        <Alert severity={severity} icon={false} sx={{ mt: 1, fontFamily: MONO, fontSize: 12, wordBreak: 'break-word' }}>
          {n.message}
        </Alert>
      )}
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mt: 1 }}>
        {n.protected && <Chip size="small" label="🛡 prune: disabled" />}
        {n.reconcileDisabled && <Chip size="small" label="reconcile: disabled" />}
        {n.helmKeep && <Chip size="small" label="resource-policy: keep" />}
        {n.suspended === true && <Chip size="small" label="⏸ suspended" />}
        {n.live === false && <Chip size="small" label="inventory only, not read" />}
        {n.prune !== undefined && <Chip size="small" label={`prune: ${n.prune}`} />}
        {n.deletionPolicy !== undefined && <Chip size="small" label={`deletionPolicy: ${n.deletionPolicy}`} />}
      </Box>
      <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 1.5 }}>
        {(n.inventory !== undefined ||
          n.role === 'helmrelease' ||
          n.role === 'fluxinstance' ||
          n.role === 'resourceset') && (
          <Button size="small" variant="outlined" onClick={() => onInventory(n.id)}>
            Show inventory
          </Button>
        )}
        {deleteEnabled && deletable && (
          <Button size="small" variant="outlined" color="error" onClick={() => onDelete(n.id)}>
            What if I delete this?
          </Button>
        )}
        {web !== undefined && (
          <Button size="small" href={web} target="_blank" rel="noopener noreferrer">
            Open in Flux web UI ↗
          </Button>
        )}
      </Box>

      {(n.appliedRevision !== undefined || n.chart !== undefined || source !== undefined) && (
        <Section title="Revisions">
          <Table size="small">
            <TableBody>
              {source !== undefined && (
                <TableRow>
                  <TableCell>Source</TableCell>
                  <TableCell>
                    <Ref estate={estate} id={source.id} onSelect={onSelect} />
                  </TableCell>
                </TableRow>
              )}
              {n.chart !== undefined && (
                <TableRow>
                  <TableCell>Chart</TableCell>
                  <TableCell sx={{ fontFamily: MONO }}>
                    {n.chart}
                    {n.chartVersion ? `@${n.chartVersion}` : ''}
                  </TableCell>
                </TableRow>
              )}
              {chartUpdate !== undefined && (
                <TableRow>
                  <TableCell>Chart update</TableCell>
                  <TableCell>
                    <ChartUpdateLabel update={chartUpdate} />
                    {chartUpdate.status !== 'loading' && (
                      <Typography variant="caption" component="div" sx={{ color: 'text.secondary', mt: 0.5 }}>
                        {describeUpdate(chartUpdate)}
                      </Typography>
                    )}
                  </TableCell>
                </TableRow>
              )}
              {revisions
                .filter(([, r]) => r !== undefined)
                .map(([label, r]) => {
                  const href = commitLink(gitCommitUrl, r, source?.originUrl ?? n.originUrl ?? source?.url ?? n.url);
                  return (
                    <TableRow key={label}>
                      <TableCell>{label}</TableCell>
                      <TableCell sx={{ fontFamily: MONO }} title={r}>
                        {href !== undefined ? (
                          <Link href={href} target="_blank" rel="noopener noreferrer">
                            {shortRevision(r)} ↗
                          </Link>
                        ) : (
                          shortRevision(r)
                        )}
                      </TableCell>
                    </TableRow>
                  );
                })}
              {n.path !== undefined && (
                <TableRow>
                  <TableCell>Path</TableCell>
                  <TableCell sx={{ fontFamily: MONO }}>{n.path}</TableCell>
                </TableRow>
              )}
              {n.url !== undefined && (
                <TableRow>
                  <TableCell>URL</TableCell>
                  <TableCell sx={{ fontFamily: MONO, wordBreak: 'break-all' }}>{n.url}</TableCell>
                </TableRow>
              )}
              {n.interval !== undefined && (
                <TableRow>
                  <TableCell>Interval</TableCell>
                  <TableCell>{n.interval}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </Section>
      )}

      {n.helmHistory !== undefined && n.helmHistory.length > 0 && (
        <Section title="Helm history">
          <Table size="small">
            <TableBody>
              {n.helmHistory.slice(0, 5).map((h, i) => (
                <TableRow key={`${h.version ?? i}`}>
                  <TableCell>v{h.version}</TableCell>
                  <TableCell sx={{ fontFamily: MONO }}>
                    {h.chartName}@{h.chartVersion}
                  </TableCell>
                  <TableCell>{h.status}</TableCell>
                  <TableCell>{h.lastDeployed?.replace('T', ' ').replace(/\..*|Z$/, '')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}

      {n.dependsOn !== undefined && n.dependsOn.length > 0 && (
        <Section title="Depends on">
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {n.dependsOn.map((d) => (
              <Ref key={d} estate={estate} id={d} onSelect={onSelect} />
            ))}
          </Box>
        </Section>
      )}
      {blocks.length > 0 && (
        <Section title={`Blocked by this (${blocks.length})`}>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {blocks.map((d) => (
              <Ref key={d} estate={estate} id={d} onSelect={onSelect} />
            ))}
          </Box>
        </Section>
      )}
      {n.managedBy !== undefined && (
        <Section title="Managed by">
          <Ref estate={estate} id={n.managedBy} onSelect={onSelect} />
        </Section>
      )}
      {n.conditions !== undefined && n.conditions.length > 0 && (
        <Section title="Conditions">
          <Table size="small">
            <TableBody>
              {n.conditions.map((c) => (
                <TableRow key={c.type}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>{c.type}</TableCell>
                  <TableCell>{c.status}</TableCell>
                  <TableCell>{c.reason}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Section>
      )}
      {n.events !== undefined && n.events.length > 0 && (
        <Section title="Recent events">
          {n.events.slice(0, 5).map((e, i) => (
            <Typography
              key={i}
              variant="caption"
              component="div"
              sx={{ fontFamily: MONO, color: e.type === 'Warning' ? 'warning.main' : 'text.secondary' }}
            >
              {e.reason}: {e.message}
            </Typography>
          ))}
        </Section>
      )}
    </Box>
  );
}

export interface DeleteReportProps {
  estate: Estate;
  impact: DeleteImpact;
  onSelect: (id: string) => void;
  onClose: () => void;
}

/** The delete report: cascade, data loss, kept, failing, deleted by namespace, and how to make it safe. */
export function DeleteReport({ estate, impact, onSelect, onClose }: DeleteReportProps): ReactElement {
  const target = estate.nodes.get(impact.target);
  const deleted = sortedDeleted(estate, impact);
  const cascades = deleted.filter(
    (d) => d.reason === 'namespace' || d.reason === 'crd' || d.reason === 'garbage-collected',
  );
  const byNamespace = new Map<string, typeof deleted>();
  for (const d of deleted) {
    const ns = estate.nodes.get(d.id)?.namespace || '(cluster-scoped)';
    byNamespace.set(ns, [...(byNamespace.get(ns) ?? []), d]);
  }
  return (
    <Box sx={{ p: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 1 }}>
        <Typography variant="h6" sx={{ flex: 1 }}>
          If you delete {target?.kind} {target === undefined ? '' : displayName(target)}
        </Typography>
        <IconButton aria-label="Close delete report" size="small" onClick={onClose}>
          ✕
        </IconButton>
      </Box>
      <Typography variant="body2" sx={{ color: 'text.secondary' }}>
        A preview computed from what the panel read. Nothing is deleted.
      </Typography>
      <Alert severity={impact.deleted.length > 0 ? 'error' : 'warning'} sx={{ mt: 1 }}>
        {impactSummary(estate, impact)}
      </Alert>

      {impact.crossNamespace > 0 && (
        <Section title={`Cross-namespace cascade (${impact.crossNamespace})`}>
          {cascades.slice(0, 20).map((d) => (
            <Typography key={d.id} variant="body2">
              <Ref estate={estate} id={d.id} onSelect={onSelect} /> · {DELETE_LABEL[d.reason]}
              {d.via !== undefined && (
                <>
                  {' '}
                  via <Ref estate={estate} id={d.via} onSelect={onSelect} />
                </>
              )}
            </Typography>
          ))}
          {cascades.length > 20 && <Typography variant="caption">and {cascades.length - 20} more</Typography>}
        </Section>
      )}
      {impact.dataLoss.length > 0 && (
        <Section title={`Data loss (${impact.dataLoss.length})`}>
          {impact.dataLoss.map((id) => {
            const n = estate.nodes.get(id);
            return (
              <Typography key={id} variant="body2" sx={{ color: 'error.main' }}>
                ⚠ <Ref estate={estate} id={id} onSelect={onSelect} />
                {n?.storage ? ` · ${n.storage}` : ''} (lost unless the volume&apos;s reclaim policy is Retain)
              </Typography>
            );
          })}
        </Section>
      )}
      {impact.kept.length > 0 && (
        <Section title={`Kept (${impact.kept.length})`}>
          {impact.kept.map((k) => (
            <Typography key={k.id} variant="body2">
              🛡 <Ref estate={estate} id={k.id} onSelect={onSelect} /> · {KEEP_LABEL[k.reason]}
            </Typography>
          ))}
        </Section>
      )}
      {impact.failing.length > 0 && (
        <Section title={`Fails afterwards (${impact.failing.length})`}>
          {impact.failing.map((f) => (
            <Typography key={f.id} variant="body2">
              ⚠ <Ref estate={estate} id={f.id} onSelect={onSelect} /> · {FAIL_LABEL[f.reason]}
            </Typography>
          ))}
        </Section>
      )}
      {impact.losing.size > 0 && (
        <Section title="Loses objects">
          {[...impact.losing.entries()].map(([id, count]) => (
            <Typography key={id} variant="body2">
              <Ref estate={estate} id={id} onSelect={onSelect} /> · {count} objects (re-applied on its next reconcile,
              if it can)
            </Typography>
          ))}
        </Section>
      )}
      {deleted.length > 0 && (
        <Section title={`Deleted, by namespace (${deleted.length}; ${impact.notYours} not yours)`}>
          {[...byNamespace.entries()].map(([ns, list]) => {
            const notYours = list.filter((d) => !d.yours).length;
            return (
              <Box key={ns} component="details" sx={{ mb: 0.5 }}>
                <Box component="summary" sx={{ cursor: 'pointer', fontSize: 14 }}>
                  {ns}: {list.length}
                  {notYours > 0 ? ` (${notYours} not yours)` : ''}
                </Box>
                <Box sx={{ pl: 2 }}>
                  {list.map((d) => (
                    <Typography key={d.id} variant="caption" component="div">
                      ✕ <Ref estate={estate} id={d.id} onSelect={onSelect} /> · {DELETE_LABEL[d.reason]}
                      {d.yours ? '' : ' · not yours'}
                    </Typography>
                  ))}
                </Box>
              </Box>
            );
          })}
        </Section>
      )}
      <Section title="Make it safe">
        <Box component="ul" sx={{ m: 0, pl: 2.5, fontSize: 14 }}>
          <li>
            Annotate Namespaces and CRDs with <code>kustomize.toolkit.fluxcd.io/prune: disabled</code>.
          </li>
          <li>Keep a Namespace in the same Kustomization as its workloads.</li>
          <li>
            Preview with <code>flux tree kustomization {target?.name ?? '<name>'}</code> and{' '}
            <code>flux diff kustomization {target?.name ?? '<name>'}</code>.
          </li>
          <li>
            Suspend first (<code>flux suspend</code>): a suspended object deletes nothing.
          </li>
        </Box>
      </Section>
    </Box>
  );
}
