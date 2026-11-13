// DatasourceSelect needs the Perses datasource store; editor tests swap it for a plain labelled input.
import type { ReactElement } from 'react';

export async function mockPluginSystem(): Promise<Record<string, unknown>> {
  const actual = await vi.importActual<Record<string, unknown>>('@perses-dev/plugin-system');
  return {
    ...actual,
    DatasourceSelect: ({ label }: { label?: string }): ReactElement => <input aria-label={label ?? 'datasource'} />,
    DatasourceTestConnectionButton: (): ReactElement => <button type="button">Test connection</button>,
  };
}
