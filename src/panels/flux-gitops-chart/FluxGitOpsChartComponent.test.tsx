import { ThemeProvider, createTheme } from '@mui/material';
import { fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';

import type { Estate } from '../../model/estate';
import { buildEstate, nodeId } from '../../model/estate';
import { largeObjects, raw, stagedEstate } from '../../test/fixtures';
import { withDefaults } from './flux-gitops-chart-types';
import type { FluxGitOpsChartOptions } from './flux-gitops-chart-types';
import { FluxGitOpsView } from './FluxGitOpsChartComponent';
import type { FluxData } from './useFluxData';

function data(estate: Estate | undefined, extra: Partial<FluxData> = {}): FluxData {
  return {
    estate,
    problems: [],
    requests: 12,
    isLoading: false,
    historyLoading: false,
    cluster: '',
    range: { start: 0, end: 1_800_000_000 },
    ...extra,
  };
}

function renderView(
  d: FluxData,
  options: FluxGitOpsChartOptions = {},
  width = 1400,
  mode: 'light' | 'dark' = 'light',
): ReturnType<typeof render> {
  const ui: ReactElement = (
    <ThemeProvider theme={createTheme({ palette: { mode } })}>
      <FluxGitOpsView options={withDefaults({ showHistory: false, ...options })} data={d} width={width} />
    </ThemeProvider>
  );
  return render(ui);
}

const K = (name: string): string => nodeId('kustomize.toolkit.fluxcd.io', 'Kustomization', 'flux-system', name);

describe('FluxGitOpsView', () => {
  it('shows a spinner while loading', () => {
    renderView(data(undefined, { isLoading: true }));
    expect(screen.getByLabelText('Loading Flux objects')).toBeInTheDocument();
  });

  it('shows the error instead of an empty panel', () => {
    renderView(data(undefined, { error: new Error('Kubernetes datasource: 403 Forbidden') }));
    expect(screen.getByText('Could not read Flux objects')).toBeInTheDocument();
    expect(screen.getByText(/403 Forbidden/)).toBeInTheDocument();
  });

  it('says so when the cluster has no Flux objects, with the read problems', () => {
    renderView(
      data(buildEstate({ lists: {} }), {
        problems: [
          { severity: 'error', title: 'Flux is not installed in this cluster', detail: 'No Kustomization API.' },
        ],
      }),
    );
    expect(screen.getByText('No Flux objects found')).toBeInTheDocument();
    expect(screen.getByText('Flux is not installed in this cluster')).toBeInTheDocument();
  });

  it('renders the staged estate: KPIs, legend and the tree with labels, not colour alone', () => {
    renderView(data(stagedEstate()));
    expect(screen.getByLabelText('Flux summary')).toHaveTextContent('Kustomizations');
    expect(screen.getByLabelText('Legend')).toHaveTextContent('Failed');
    expect(screen.getByRole('button', { name: /Kustomization flux-system\/monitoring: Failed/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kustomization flux-system\/tenants: Suspended/ })).toBeInTheDocument();
  });

  it('renders 300 Kustomizations as real-size cards in a scroll box', () => {
    const { container } = renderView(data(buildEstate(raw(largeObjects(300, 2)))), { onlyProblems: false });
    const tree = screen.getByRole('tree');
    // Healthy branches start collapsed, so every Kustomization is one card and nothing is shrunk.
    expect(within(tree).getAllByRole('treeitem').length).toBeGreaterThanOrEqual(300);
    expect(Number(tree.querySelector('svg')?.getAttribute('height'))).toBeGreaterThan(300 * 70);
    expect(container.querySelector('[data-testid="flux-main"]')).toBeInTheDocument();
  });

  it('expands and collapses a branch', () => {
    renderView(data(stagedEstate()));
    const before = screen.getAllByRole('treeitem').length;
    const expand = screen.getAllByRole('button', { name: /^Expand / })[0] as HTMLElement;
    fireEvent.click(expand);
    expect(screen.getAllByRole('treeitem').length).toBeGreaterThan(before);
  });

  it('opens the details drawer and closes it with Escape', () => {
    renderView(data(stagedEstate()));
    fireEvent.click(screen.getByRole('button', { name: /Kustomization flux-system\/apps: Waiting/ }));
    const drawer = screen.getByRole('complementary', { name: 'Details' });
    expect(within(drawer).getByText("dependency 'flux-system/monitoring' is not ready")).toBeInTheDocument();
    fireEvent.keyDown(drawer, { key: 'Escape' });
    expect(screen.queryByRole('complementary')).not.toBeInTheDocument();
  });

  it('delete mode marks the cascade and opens the report', () => {
    renderView(data(stagedEstate()));
    fireEvent.click(screen.getByRole('checkbox', { name: 'What if I delete…?' }));
    fireEvent.click(screen.getByRole('button', { name: /Kustomization flux-system\/infra-configs/ }));
    const report = screen.getByRole('complementary', { name: 'Delete report' });
    expect(within(report).getByText(/if you delete Kustomization/)).toBeInTheDocument();
    expect(within(report).getByText('Make it safe')).toBeInTheDocument();
    expect(
      screen.getAllByText(/objects disappear if you delete Kustomization flux-system\/infra-configs/).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText('✕ will be deleted').length).toBeGreaterThan(0);
  });

  it('switches to every view', () => {
    renderView(data(stagedEstate()));
    fireEvent.click(screen.getByRole('tab', { name: 'Stages' }));
    expect(screen.getByRole('region', { name: 'Stage 1' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'Sources' }));
    expect(screen.getAllByText(/Kustomizations, \d+ HelmReleases/).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('tab', { name: 'Inventory' }));
    expect(screen.getByRole('navigation', { name: 'Inventory path' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'List' }));
    const table = screen.getByRole('table', { name: 'Flux objects' });
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(10);
    fireEvent.click(within(table).getByText('Name'));
    expect(within(table).getAllByRole('row').length).toBeGreaterThan(10);
  });

  it('stacks the drawer under the views on a narrow panel and renders in dark mode', () => {
    renderView(data(stagedEstate()), { defaultView: 'stages' }, 600, 'dark');
    fireEvent.click(screen.getByRole('button', { name: /Kustomization flux-system\/monitoring: Failed/ }));
    expect(screen.getByRole('complementary', { name: 'Details' })).toBeInTheDocument();
    expect(K('monitoring')).toContain('monitoring');
  });
});
