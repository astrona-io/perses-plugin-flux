import type { PanelPlugin } from '@perses-dev/plugin-system';

import type { FluxGitOpsChartOptions, FluxGitOpsChartProps } from './flux-gitops-chart-types';
import { DEFAULT_OPTIONS } from './flux-gitops-chart-types';
import { FluxGitOpsChartComponent } from './FluxGitOpsChartComponent';
import { FluxGitOpsChartSettingsEditor } from './FluxGitOpsChartSettingsEditor';

/** Flux GitOps panel: reads Flux objects through a Kubernetes datasource, history through Prometheus. No panel queries. */
export const FluxGitOpsChart: PanelPlugin<FluxGitOpsChartOptions, FluxGitOpsChartProps> = {
  PanelComponent: FluxGitOpsChartComponent,
  panelOptionsEditorComponents: [{ label: 'Settings', content: FluxGitOpsChartSettingsEditor }],
  hideQueryEditor: true,
  createInitialOptions: () => ({ ...DEFAULT_OPTIONS, namespaces: [] }),
};
