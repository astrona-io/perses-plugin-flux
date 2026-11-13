import { Alert, AlertTitle, Box, CircularProgress, Typography, useTheme } from '@mui/material';
import type { ReactElement, ReactNode } from 'react';
import { useCallback, useMemo, useState } from 'react';

import type { DeleteImpact } from '../../model/delete-impact';
import { deleteImpact, impactSummary } from '../../model/delete-impact';
import type { Estate } from '../../model/estate';
import { displayName } from '../../model/estate';
import type { ReadProblem } from '../../model/fetch';
import type { ViewFilters } from '../../model/views';
import {
  buildInventory,
  buildList,
  buildSources,
  buildStages,
  childIndex,
  computeKpis,
  layoutTree,
} from '../../model/views';
import { DeleteReport, Details } from './Drawer';
import type { FluxGitOpsChartProps, FluxView, ResolvedOptions } from './flux-gitops-chart-types';
import { withDefaults } from './flux-gitops-chart-types';
import { FluxResourcesTab } from './FluxResourcesView';
import { KpiTiles, Legend, Toolbar } from './Header';
import { HistoryStrip } from './HistoryStrip';
import type { Overlay } from './NodeCard';
import { InventoryView, ListView, SourcesView, StagesView } from './OtherViews';
import { TreeView } from './TreeView';
import { useChartUpdates } from './useChartUpdates';
import type { FluxData } from './useFluxData';
import { useFluxData } from './useFluxData';

/** Below this width the drawer stacks under the views instead of beside them. */
const NARROW = 900;
const DRAWER_W = 380;

export function FluxGitOpsChartComponent(props: FluxGitOpsChartProps): ReactElement {
  const options = useMemo(() => withDefaults(props.spec), [props.spec]);
  const data = useFluxData(options);
  // The view seeds its state (tab, toggles) from these options; remount it when the editor changes them.
  const seed = `${options.defaultView}|${options.showSources}|${options.showHelmReleases}|${options.onlyProblems}`;
  return <FluxGitOpsView key={seed} options={options} data={data} width={props.contentDimensions?.width} />;
}

export interface FluxGitOpsViewProps {
  options: ResolvedOptions;
  data: FluxData;
  width?: number;
}

function Problems({ problems }: { problems: ReadProblem[] }): ReactElement | null {
  if (problems.length === 0) return null;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, px: 2, pt: 1 }}>
      {problems.map((p) => (
        <Alert key={p.title} severity={p.severity}>
          <AlertTitle>{p.title}</AlertTitle>
          {p.detail}
        </Alert>
      ))}
    </Box>
  );
}

function overlaysFor(estate: Estate, impact: DeleteImpact | undefined): Map<string, Overlay> | undefined {
  if (impact === undefined) return undefined;
  const m = new Map<string, Overlay>();
  for (const id of impact.losing.keys()) m.set(id, 'losing');
  for (const f of impact.failing) m.set(f.id, 'failing');
  for (const k of impact.kept) m.set(k.id, 'kept');
  for (const d of impact.deleted) m.set(d.id, 'deleted');
  if (estate.nodes.has(impact.target)) m.set(impact.target, 'target');
  return m;
}

/** The panel body, separate from the data hook so it renders in tests from a plain estate. */
export function FluxGitOpsView({ options, data, width }: FluxGitOpsViewProps): ReactElement {
  const theme = useTheme();
  const { estate } = data;
  const [view, setView] = useState<FluxView>(options.defaultView);
  const [filters, setFilters] = useState({
    showSources: options.showSources,
    showHelmReleases: options.showHelmReleases,
    onlyProblems: options.onlyProblems,
  });
  const [deleteMode, setDeleteMode] = useState(false);
  const [selected, setSelected] = useState<string>();
  const [deleteTarget, setDeleteTarget] = useState<string>();
  const [inventoryId, setInventoryId] = useState<string>();
  const [expanded, setExpanded] = useState<Map<string, boolean>>(new Map());

  const viewFilters: ViewFilters = useMemo(
    () => ({ ...filters, showPods: options.showPods, groupThreshold: options.groupThreshold }),
    [filters, options.showPods, options.groupThreshold],
  );
  const children = useMemo(() => (estate === undefined ? undefined : childIndex(estate)), [estate]);
  const tree = useMemo(
    () =>
      estate === undefined || children === undefined || view !== 'tree'
        ? undefined
        : layoutTree(estate, viewFilters, expanded, children),
    [estate, children, viewFilters, expanded, view],
  );
  const stages = useMemo(() => (estate === undefined ? undefined : buildStages(estate, filters)), [estate, filters]);
  const sources = useMemo(
    () => (estate === undefined || view !== 'sources' ? undefined : buildSources(estate, children)),
    [estate, children, view],
  );
  const inventoryRoot = inventoryId ?? estate?.root;
  const inventory = useMemo(
    () =>
      estate === undefined || inventoryRoot === undefined || view !== 'inventory'
        ? undefined
        : buildInventory(estate, inventoryRoot, children),
    [estate, inventoryRoot, children, view],
  );
  const list = useMemo(
    () => (estate === undefined || view !== 'list' ? undefined : buildList(estate, filters.onlyProblems)),
    [estate, filters.onlyProblems, view],
  );
  const kpis = useMemo(() => (estate === undefined ? undefined : computeKpis(estate)), [estate]);
  const impact = useMemo(
    () =>
      estate === undefined || deleteTarget === undefined || !options.enableDeleteImpact
        ? undefined
        : deleteImpact(estate, deleteTarget),
    [estate, deleteTarget, options.enableDeleteImpact],
  );
  const overlays = useMemo(() => (estate === undefined ? undefined : overlaysFor(estate, impact)), [estate, impact]);
  // Read lazily: every HelmRelease for the List view, else only the one open in the drawer.
  const chartUpdates = useChartUpdates(
    estate,
    data.chartIndex,
    options.checkChartUpdates,
    view === 'list' ? 'all' : selected,
  );

  const onSelect = useCallback(
    (id: string) => {
      const n = estate?.nodes.get(id);
      if (deleteMode && n?.role !== undefined && n.role !== 'fluxreport') {
        setDeleteTarget(id);
        setSelected(id);
      } else {
        setSelected(id);
        setDeleteTarget(undefined);
      }
    },
    [deleteMode, estate],
  );
  const onToggle = useCallback((key: string, open: boolean) => setExpanded((m) => new Map(m).set(key, open)), []);
  const closeDrawer = useCallback(() => {
    setSelected(undefined);
    setDeleteTarget(undefined);
  }, []);

  const narrow = width !== undefined && width < NARROW;
  const drawerOpen = selected !== undefined || deleteTarget !== undefined;

  if (estate === undefined) {
    if (data.error !== undefined) {
      return (
        <Box sx={{ p: 2 }}>
          <Alert severity="error">
            <AlertTitle>Could not read Flux objects</AlertTitle>
            {data.error.message}
          </Alert>
        </Box>
      );
    }
    if (data.isLoading) {
      return (
        <Box component="output" sx={{ display: 'grid', placeItems: 'center', height: '100%', minHeight: 120 }}>
          <CircularProgress size={28} aria-label="Loading Flux objects" />
        </Box>
      );
    }
    return (
      <Box sx={{ p: 2 }}>
        <Typography>Select a Kubernetes datasource in the panel settings.</Typography>
      </Box>
    );
  }

  const empty = estate.nodes.size === 0;
  const node = selected === undefined ? undefined : estate.nodes.get(selected);
  const blocks =
    node === undefined || stages === undefined
      ? []
      : [...stages.blockedBy.entries()].filter(([, b]) => b === node.id).map(([id]) => id);

  const main = ((): ReactNode => {
    if (empty) {
      return (
        <Box sx={{ p: 3 }}>
          <Typography variant="h6">No Flux objects found</Typography>
          <Typography sx={{ color: 'text.secondary' }}>
            {options.namespaces.length > 0 ? `Nothing in ${options.namespaces.join(', ')}. ` : ''}
            {data.problems.some((p) => p.severity === 'error')
              ? 'The panel could not read the cluster: see the message above.'
              : 'The datasource answered, but returned no Kustomizations, HelmReleases, sources or Flux Operator objects.'}
          </Typography>
        </Box>
      );
    }
    switch (view) {
      case 'stages':
        return (
          stages && (
            <StagesView estate={estate} stages={stages} selected={selected} overlays={overlays} onSelect={onSelect} />
          )
        );
      case 'sources':
        return (
          sources && (
            <SourcesView
              estate={estate}
              sources={sources}
              selected={selected}
              overlays={overlays}
              onSelect={onSelect}
            />
          )
        );
      case 'inventory':
        return (
          inventory && (
            <InventoryView
              estate={estate}
              inventory={inventory}
              selected={selected}
              overlays={overlays}
              onSelect={onSelect}
              onOpen={setInventoryId}
            />
          )
        );
      case 'list':
        return (
          list && (
            <ListView
              estate={estate}
              rows={list}
              selected={selected}
              onSelect={onSelect}
              now={data.range.end * 1000}
              chartUpdates={chartUpdates}
            />
          )
        );
      case 'flux':
        return (
          <FluxResourcesTab
            estate={estate}
            failures={data.failures}
            options={options}
            range={data.range}
            cluster={data.cluster}
            selected={selected}
            onSelect={onSelect}
          />
        );
      default:
        return (
          tree && (
            <TreeView
              estate={estate}
              layout={tree}
              selected={selected}
              overlays={overlays}
              onSelect={onSelect}
              onToggle={onToggle}
            />
          )
        );
    }
  })();

  const drawer = drawerOpen && (
    <Box
      component="aside"
      aria-label={impact !== undefined ? 'Delete report' : 'Details'}
      sx={{
        flex: narrow ? '0 0 auto' : `0 0 ${DRAWER_W}px`,
        width: narrow ? '100%' : DRAWER_W,
        overflow: 'auto',
        borderLeft: narrow ? undefined : `1px solid ${theme.palette.divider}`,
        borderTop: narrow ? `1px solid ${theme.palette.divider}` : undefined,
      }}
    >
      {impact !== undefined ? (
        <DeleteReport estate={estate} impact={impact} onSelect={onSelect} onClose={closeDrawer} />
      ) : (
        node !== undefined && (
          <Details
            estate={estate}
            node={node}
            blocks={blocks}
            fluxWebUIUrl={options.fluxWebUIUrl}
            gitCommitUrl={options.gitCommitUrl}
            deleteEnabled={options.enableDeleteImpact}
            chartUpdate={chartUpdates?.get(node.id)}
            onSelect={onSelect}
            onInventory={(id) => {
              setInventoryId(id);
              setView('inventory');
            }}
            onDelete={(id) => {
              setDeleteMode(true);
              setDeleteTarget(id);
            }}
            onClose={closeDrawer}
          />
        )
      )}
    </Box>
  );

  return (
    <Box
      sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, overflow: 'hidden' }}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && drawerOpen) closeDrawer();
      }}
    >
      <Box sx={{ px: 2, pt: 1.5, display: 'flex', flexDirection: 'column', gap: 1 }}>
        {kpis && <KpiTiles kpis={kpis} estate={estate} />}
        <Toolbar
          view={view}
          onView={setView}
          {...filters}
          deleteMode={deleteMode}
          deleteEnabled={options.enableDeleteImpact}
          inventoryEnabled={inventoryRoot !== undefined}
          onToggle={(key) => {
            if (key === 'deleteMode') {
              setDeleteMode((d) => !d);
              setDeleteTarget(undefined);
            } else setFilters((f) => ({ ...f, [key]: !f[key] }));
          }}
          onReset={() => {
            setExpanded(new Map());
            setDeleteMode(false);
            setDeleteTarget(undefined);
            setSelected(undefined);
            setInventoryId(undefined);
            setFilters({
              showSources: options.showSources,
              showHelmReleases: options.showHelmReleases,
              onlyProblems: options.onlyProblems,
            });
          }}
        />
        <Legend />
      </Box>
      <Problems problems={data.problems} />
      {deleteMode && (
        <Box sx={{ px: 2, pt: 1 }}>
          <Alert
            severity={impact === undefined ? 'warning' : 'error'}
            variant={impact === undefined ? 'outlined' : 'filled'}
          >
            {impact === undefined
              ? 'Delete preview: click a Kustomization, HelmRelease, source, ResourceSet or the root to see what would disappear. Nothing is deleted.'
              : impactSummary(estate, impact)}
          </Alert>
        </Box>
      )}
      <Box
        sx={{
          display: 'flex',
          flexDirection: narrow ? 'column' : 'row',
          flex: 1,
          minHeight: 0,
          mt: 1,
          overflow: narrow ? 'auto' : 'hidden',
        }}
      >
        <Box sx={{ flex: 1, minWidth: 0, minHeight: narrow ? 300 : 0, overflow: 'auto' }} data-testid="flux-main">
          {main}
        </Box>
        {drawer}
      </Box>
      {options.showHistory && !empty && (
        <Box sx={{ borderTop: `1px solid ${theme.palette.divider}`, maxHeight: 180, overflow: 'auto' }}>
          <HistoryStrip
            estate={estate}
            history={data.history}
            error={data.historyError}
            loading={data.historyLoading}
            onSelect={onSelect}
          />
        </Box>
      )}
      <Typography variant="caption" sx={{ px: 2, py: 0.5, color: 'text.secondary' }}>
        {estate.nodes.size} objects · {data.requests} API requests
        {estate.root !== undefined && estate.nodes.get(estate.root)
          ? ` · root ${displayName(estate.nodes.get(estate.root) as never)}`
          : ''}
        {data.cluster ? ` · cluster ${data.cluster}` : ''}
      </Typography>
    </Box>
  );
}
