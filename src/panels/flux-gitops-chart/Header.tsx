import { Box, Chip, FormControlLabel, Switch, Tab, Tabs, Typography, useTheme } from '@mui/material';
import type { ReactElement, ReactNode } from 'react';

import type { Estate } from '../../model/estate';
import type { FluxState } from '../../model/state';
import { STATE_ICON, STATE_LABEL } from '../../model/state';
import type { Kpis } from '../../model/views';
import type { FluxView } from './flux-gitops-chart-types';
import { stateColor } from './style';

function Tile({
  label,
  value,
  detail,
  state,
}: {
  label: string;
  value: ReactNode;
  detail?: string;
  state?: FluxState;
}): ReactElement {
  const theme = useTheme();
  return (
    <Box sx={{ px: 1.5, py: 0.75, border: `1px solid ${theme.palette.divider}`, borderRadius: 1, minWidth: 110 }}>
      <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.3 }}>
        {label}
      </Typography>
      <Typography
        sx={{
          fontWeight: 700,
          fontSize: 18,
          lineHeight: 1.3,
          color: state === undefined ? undefined : stateColor(theme, state),
        }}
      >
        {value}
      </Typography>
      {detail && (
        <Typography
          variant="caption"
          sx={{ color: 'text.secondary', display: 'block', lineHeight: 1.2, maxWidth: 220 }}
          noWrap
          title={detail}
        >
          {detail}
        </Typography>
      )}
    </Box>
  );
}

function failing(total: number, bad: number): { value: string; detail: string; state: FluxState } {
  return {
    value: `${total - bad}/${total}`,
    detail: bad > 0 ? `${bad} not ready` : 'all ready',
    state: bad > 0 ? 'failed' : 'ready',
  };
}

export function KpiTiles({ kpis, estate }: { kpis: Kpis; estate: Estate }): ReactElement {
  const ctl = kpis.controllers;
  const s = failing(kpis.sources.total, kpis.sources.failing);
  const k = failing(kpis.kustomizations.total, kpis.kustomizations.failing);
  const h = failing(kpis.helmReleases.total, kpis.helmReleases.failing);
  const version = estate.report?.distribution?.version;
  let flavour: string | undefined;
  if (version) flavour = `Flux ${version}${estate.operator ? ' · operator' : ''}`;
  else if (estate.operator) flavour = 'Flux Operator';
  let ctlState: FluxState = 'ready';
  if (ctl.total === 0) ctlState = 'unknown';
  else if (ctl.ready < ctl.total) ctlState = 'failed';
  return (
    <Box component="section" sx={{ display: 'flex', gap: 1, flexWrap: 'wrap' }} aria-label="Flux summary">
      <Tile
        label="Controllers"
        value={ctl.total === 0 ? '–' : `${ctl.ready}/${ctl.total}`}
        detail={flavour}
        state={ctlState}
      />
      <Tile label="Sources" {...s} />
      <Tile label="Kustomizations" {...k} />
      <Tile label="Helm releases" {...h} />
      <Tile label="Suspended" value={kpis.suspended} state={kpis.suspended > 0 ? 'suspended' : undefined} />
      <Tile
        label="Sync"
        value={`${STATE_ICON[kpis.sync.state]} ${STATE_LABEL[kpis.sync.state]}`}
        detail={kpis.sync.label}
        state={kpis.sync.state}
      />
    </Box>
  );
}

const LEGEND: FluxState[] = [
  'ready',
  'reconciling',
  'outofsync',
  'waiting',
  'failed',
  'drift',
  'suspended',
  'disabled',
];

export function Legend(): ReactElement {
  const theme = useTheme();
  return (
    <Box sx={{ display: 'flex', gap: 1.5, flexWrap: 'wrap', fontSize: 12 }} aria-label="Legend">
      {LEGEND.map((s) => (
        <Box key={s} component="span" sx={{ whiteSpace: 'nowrap' }}>
          <Box component="span" sx={{ color: stateColor(theme, s), fontWeight: 700 }}>
            {STATE_ICON[s]}
          </Box>{' '}
          {STATE_LABEL[s]}
        </Box>
      ))}
      <Box component="span">🛡 protected</Box>
      <Box component="span">┄ dashed: not read / disabled</Box>
    </Box>
  );
}

export interface ToolbarProps {
  view: FluxView;
  onView: (v: FluxView) => void;
  showSources: boolean;
  showHelmReleases: boolean;
  onlyProblems: boolean;
  deleteMode: boolean;
  deleteEnabled: boolean;
  inventoryEnabled: boolean;
  onToggle: (key: 'showSources' | 'showHelmReleases' | 'onlyProblems' | 'deleteMode') => void;
  onReset: () => void;
}

const VIEW_LABEL: Record<FluxView, string> = {
  tree: 'Tree',
  stages: 'Stages',
  sources: 'Sources',
  inventory: 'Inventory',
  list: 'List',
};

export function Toolbar(p: ToolbarProps): ReactElement {
  const sw = (
    key: ToolbarProps['onToggle'] extends (k: infer K) => void ? K : never,
    label: string,
    checked: boolean,
    color?: 'error',
  ): ReactElement => (
    <FormControlLabel
      sx={{ mr: 1, '& .MuiFormControlLabel-label': { fontSize: 13 } }}
      control={<Switch size="small" checked={checked} color={color} onChange={() => p.onToggle(key)} />}
      label={label}
    />
  );
  return (
    <Box sx={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 1 }}>
      <Tabs
        value={p.view}
        onChange={(_, v: FluxView) => p.onView(v)}
        aria-label="View"
        sx={{ minHeight: 36, '& .MuiTab-root': { minHeight: 36, py: 0.5, textTransform: 'none' } }}
      >
        {(Object.keys(VIEW_LABEL) as FluxView[]).map((v) => (
          <Tab key={v} value={v} label={VIEW_LABEL[v]} disabled={v === 'inventory' && !p.inventoryEnabled} />
        ))}
      </Tabs>
      <Box sx={{ flex: 1 }} />
      {sw('showSources', 'Sources', p.showSources)}
      {sw('showHelmReleases', 'Helm releases', p.showHelmReleases)}
      {sw('onlyProblems', 'Only problems', p.onlyProblems)}
      {p.deleteEnabled && sw('deleteMode', 'What if I delete…?', p.deleteMode, 'error')}
      <Chip size="small" label="Reset" onClick={p.onReset} variant="outlined" />
    </Box>
  );
}
