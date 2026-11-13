import { MenuItem, Switch, TextField } from '@mui/material';
import {
  OptionsEditorColumn,
  OptionsEditorControl,
  OptionsEditorGrid,
  OptionsEditorGroup,
} from '@perses-dev/components';
import type { OptionsEditorProps } from '@perses-dev/plugin-system';
import { DatasourceSelect } from '@perses-dev/plugin-system';
import type { DatasourceSelector } from '@perses-dev/spec';
import type { ReactElement } from 'react';

import type { FluxGitOpsChartOptions, FluxView, TreeDirection } from './flux-gitops-chart-types';
import { FLUX_VIEWS, TREE_DIRECTIONS, withDefaults } from './flux-gitops-chart-types';
import { KUBERNETES_DATASOURCE_KIND, PROMETHEUS_DATASOURCE_KIND } from './useFluxData';

type Props = OptionsEditorProps<FluxGitOpsChartOptions>;

const VIEW_LABEL: Record<FluxView, string> = {
  tree: 'Tree',
  stages: 'Stages',
  sources: 'Sources',
  inventory: 'Inventory',
  list: 'List',
  flux: 'Flux resources',
};

const DIRECTION_LABEL: Record<TreeDirection, string> = {
  vertical: 'Top to bottom',
  horizontal: 'Left to right',
};

/** Every option in the schema, with the defaults `withDefaults` applies. */
export function FluxGitOpsChartSettingsEditor({ value, onChange }: Props): ReactElement {
  const o = withDefaults(value);
  const set = <K extends keyof FluxGitOpsChartOptions>(key: K, v: FluxGitOpsChartOptions[K]): void => {
    const next = { ...value, [key]: v };
    if (v === undefined || v === '') delete next[key];
    onChange(next);
  };
  const text = (
    key: 'cluster' | 'rootKustomization' | 'historyRange' | 'fluxWebUIUrl' | 'gitCommitUrl',
    label: string,
    placeholder: string,
    helper?: string,
  ): ReactElement => (
    <OptionsEditorControl
      label={label}
      control={
        <TextField
          size="small"
          value={value[key] ?? ''}
          placeholder={placeholder}
          helperText={helper}
          inputProps={{ 'aria-label': label }}
          onChange={(e) => set(key, e.target.value.trim() === '' ? undefined : e.target.value)}
        />
      }
    />
  );
  const toggle = (
    key:
      | 'showSources'
      | 'showHelmReleases'
      | 'onlyProblems'
      | 'showPods'
      | 'showHistory'
      | 'enableDeleteImpact'
      | 'checkChartUpdates',
    label: string,
  ): ReactElement => (
    <OptionsEditorControl
      label={label}
      control={
        <Switch checked={o[key]} inputProps={{ 'aria-label': label }} onChange={(e) => set(key, e.target.checked)} />
      }
    />
  );
  const datasource = (
    key: 'kubernetesDatasource' | 'prometheusDatasource',
    kind: string,
    label: string,
  ): ReactElement => (
    <OptionsEditorControl
      label={label}
      control={
        <DatasourceSelect
          label={label}
          datasourcePluginKind={kind}
          value={value[key] ?? { kind }}
          onChange={(next) => {
            // The schema stores a selector; a datasource variable is not supported here.
            if (typeof next === 'object') set(key, next as DatasourceSelector);
          }}
        />
      }
    />
  );

  return (
    <OptionsEditorGrid>
      <OptionsEditorColumn>
        <OptionsEditorGroup title="Data">
          {datasource('kubernetesDatasource', KUBERNETES_DATASOURCE_KIND, 'Kubernetes datasource')}
          {datasource('prometheusDatasource', PROMETHEUS_DATASOURCE_KIND, 'Prometheus datasource')}
          {text('cluster', 'Cluster label', 'any', 'Value of the cluster label in history queries; $variables work')}
          <OptionsEditorControl
            label="Namespaces"
            control={
              <TextField
                size="small"
                value={o.namespaces.join(', ')}
                placeholder="all"
                helperText="Comma-separated; $variables work"
                inputProps={{ 'aria-label': 'Namespaces' }}
                onChange={(e) => {
                  const list = e.target.value
                    .split(',')
                    .map((s) => s.trim())
                    .filter((s) => s !== '');
                  set('namespaces', list.length === 0 ? undefined : list);
                }}
              />
            }
          />
          {text('rootKustomization', 'Root Kustomization', 'auto', 'name or namespace/name; auto = flux-system')}
        </OptionsEditorGroup>
        <OptionsEditorGroup title="History">
          {toggle('showHistory', 'Show reconcile history')}
          {text('historyRange', 'History range', 'dashboard range', 'e.g. 6h, 1d')}
        </OptionsEditorGroup>
      </OptionsEditorColumn>
      <OptionsEditorColumn>
        <OptionsEditorGroup title="Display">
          <OptionsEditorControl
            label="Default view"
            control={
              <TextField
                select
                size="small"
                value={o.defaultView}
                inputProps={{ 'aria-label': 'Default view' }}
                onChange={(e) => set('defaultView', e.target.value as FluxView)}
              >
                {FLUX_VIEWS.map((v) => (
                  <MenuItem key={v} value={v}>
                    {VIEW_LABEL[v]}
                  </MenuItem>
                ))}
              </TextField>
            }
          />
          <OptionsEditorControl
            label="Tree direction"
            control={
              <TextField
                select
                size="small"
                value={o.treeDirection}
                inputProps={{ 'aria-label': 'Tree direction' }}
                onChange={(e) => set('treeDirection', e.target.value as TreeDirection)}
              >
                {TREE_DIRECTIONS.map((d) => (
                  <MenuItem key={d} value={d}>
                    {DIRECTION_LABEL[d]}
                  </MenuItem>
                ))}
              </TextField>
            }
          />
          {toggle('showSources', 'Show sources')}
          {toggle('showHelmReleases', 'Show Helm releases')}
          {toggle('onlyProblems', 'Only problems')}
          {toggle('showPods', 'Show pods')}
          <OptionsEditorControl
            label="Group threshold"
            control={
              <TextField
                size="small"
                type="number"
                value={o.groupThreshold}
                inputProps={{ 'aria-label': 'Group threshold', min: 1, max: 100 }}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  set('groupThreshold', Number.isFinite(n) ? Math.min(100, Math.max(1, n)) : undefined);
                }}
              />
            }
          />
          {toggle('enableDeleteImpact', 'Delete impact preview')}
          {toggle('checkChartUpdates', 'Check Helm chart updates')}
        </OptionsEditorGroup>
        <OptionsEditorGroup title="Links">
          {text('fluxWebUIUrl', 'Flux web UI', 'https://flux.example.com/resource/${kind}/${namespace}/${name}')}
          {text('gitCommitUrl', 'Commit link', 'https://${repo}/commit/${revision}')}
        </OptionsEditorGroup>
      </OptionsEditorColumn>
    </OptionsEditorGrid>
  );
}
