import type { PanelProps } from '@perses-dev/plugin-system';
import type { DatasourceSelector } from '@perses-dev/spec';

export type FluxView = 'tree' | 'stages' | 'sources' | 'inventory' | 'list' | 'flux';

export const FLUX_VIEWS: FluxView[] = ['tree', 'stages', 'sources', 'inventory', 'list', 'flux'];

/** Tree direction: parents above their children (vertical) or left of them (horizontal). */
export type TreeDirection = 'vertical' | 'horizontal';

export const TREE_DIRECTIONS: TreeDirection[] = ['vertical', 'horizontal'];

/** The panel's options; every field is optional and `withDefaults` fills them in. */
export interface FluxGitOpsChartOptions {
  kubernetesDatasource?: DatasourceSelector;
  prometheusDatasource?: DatasourceSelector;
  cluster?: string;
  namespaces?: string[];
  rootKustomization?: string;
  defaultView?: FluxView;
  treeDirection?: TreeDirection;
  showSources?: boolean;
  showHelmReleases?: boolean;
  onlyProblems?: boolean;
  showPods?: boolean;
  groupThreshold?: number;
  historyRange?: string;
  showHistory?: boolean;
  fluxWebUIUrl?: string;
  gitCommitUrl?: string;
  enableDeleteImpact?: boolean;
  checkChartUpdates?: boolean;
}

export type ResolvedOptions = Required<
  Omit<
    FluxGitOpsChartOptions,
    'kubernetesDatasource' | 'prometheusDatasource' | 'cluster' | 'historyRange' | 'fluxWebUIUrl' | 'gitCommitUrl'
  >
> &
  Pick<
    FluxGitOpsChartOptions,
    'kubernetesDatasource' | 'prometheusDatasource' | 'cluster' | 'historyRange' | 'fluxWebUIUrl' | 'gitCommitUrl'
  >;

export const DEFAULT_OPTIONS = {
  namespaces: [] as string[],
  rootKustomization: 'auto',
  defaultView: 'tree' as FluxView,
  treeDirection: 'vertical' as TreeDirection,
  showSources: true,
  showHelmReleases: true,
  onlyProblems: false,
  showPods: true,
  groupThreshold: 2,
  showHistory: true,
  enableDeleteImpact: true,
  checkChartUpdates: true,
};

export function withDefaults(options: FluxGitOpsChartOptions | undefined): ResolvedOptions {
  const o = options ?? {};
  return {
    ...o,
    namespaces: o.namespaces ?? DEFAULT_OPTIONS.namespaces,
    rootKustomization: o.rootKustomization ?? DEFAULT_OPTIONS.rootKustomization,
    defaultView: o.defaultView ?? DEFAULT_OPTIONS.defaultView,
    treeDirection: o.treeDirection ?? DEFAULT_OPTIONS.treeDirection,
    showSources: o.showSources ?? DEFAULT_OPTIONS.showSources,
    showHelmReleases: o.showHelmReleases ?? DEFAULT_OPTIONS.showHelmReleases,
    onlyProblems: o.onlyProblems ?? DEFAULT_OPTIONS.onlyProblems,
    showPods: o.showPods ?? DEFAULT_OPTIONS.showPods,
    groupThreshold: o.groupThreshold ?? DEFAULT_OPTIONS.groupThreshold,
    showHistory: o.showHistory ?? DEFAULT_OPTIONS.showHistory,
    enableDeleteImpact: o.enableDeleteImpact ?? DEFAULT_OPTIONS.enableDeleteImpact,
    checkChartUpdates: o.checkChartUpdates ?? DEFAULT_OPTIONS.checkChartUpdates,
  };
}

export type FluxGitOpsChartProps = PanelProps<FluxGitOpsChartOptions, unknown>;
