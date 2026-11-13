import { fireEvent, render, screen } from '@testing-library/react';

import { FluxGitOpsChart } from './FluxGitOpsChart';
import { FluxGitOpsChartSettingsEditor } from './FluxGitOpsChartSettingsEditor';

vi.mock('@perses-dev/plugin-system', async () => (await import('../../test/mock-plugin-system')).mockPluginSystem());

describe('FluxGitOpsChartSettingsEditor', () => {
  it('edits options and drops empty ones', () => {
    const onChange = vi.fn();
    render(<FluxGitOpsChartSettingsEditor value={{ cluster: 'c1' }} onChange={onChange} />);
    expect(screen.getByRole('textbox', { name: 'Kubernetes datasource' })).toBeInTheDocument();
    expect(screen.getByRole('textbox', { name: 'Prometheus datasource' })).toBeInTheDocument();
    fireEvent.change(screen.getByRole('textbox', { name: 'Namespaces' }), { target: { value: 'apps, monitoring' } });
    expect(onChange).toHaveBeenLastCalledWith({ cluster: 'c1', namespaces: ['apps', 'monitoring'] });
    fireEvent.change(screen.getByRole('textbox', { name: 'Cluster label' }), { target: { value: '' } });
    expect(onChange).toHaveBeenLastCalledWith({});
    fireEvent.click(screen.getByRole('checkbox', { name: 'Only problems' }));
    expect(onChange).toHaveBeenLastCalledWith({ cluster: 'c1', onlyProblems: true });
    fireEvent.change(screen.getByRole('spinbutton', { name: 'Group threshold' }), { target: { value: '500' } });
    expect(onChange).toHaveBeenLastCalledWith({ cluster: 'c1', groupThreshold: 100 });
  });

  it('the plugin has no query editor and starts from the defaults', () => {
    expect(FluxGitOpsChart.hideQueryEditor).toBe(true);
    expect(FluxGitOpsChart.createInitialOptions?.()).toMatchObject({
      defaultView: 'tree',
      groupThreshold: 2,
      enableDeleteImpact: true,
    });
  });
});
