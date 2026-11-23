// Loads the plugin into a real Perses and renders the panel against the fake API server: catches what the
// unit tests cannot, such as a module federation mismatch with the host's shared packages (React, MUI,
// @perses-dev/*, react-query) or a build that Perses fails to load.

import { expect, test } from '@playwright/test';

test('Perses loads the plugin and the panel renders the Flux objects', async ({ page, request }) => {
  const plugins = await request.get('/api/v1/plugins');
  expect(plugins.ok()).toBe(true);
  const names = ((await plugins.json()) as { metadata: { name: string } }[]).map((p) => p.metadata.name);
  expect(names).toContain('FluxGitOps');

  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });

  await page.goto('/projects/smoke/dashboards/flux');

  const panel = page.locator('[data-testid="panel"]').filter({ hasText: 'Flux GitOps' });
  await expect(panel.getByRole('region', { name: 'Flux summary' })).toBeVisible({ timeout: 60_000 });
  for (const name of ['flux-system', 'smoke-infra', 'smoke-apps']) {
    await expect(panel.getByText(name, { exact: true }).first()).toBeVisible();
  }
  await expect(panel.getByLabel('Loading Flux objects')).toHaveCount(0);

  const federation = errors.filter((e) =>
    /federation|shared module|loadRemote|RUNTIME-\d+|Failed to load plugin/i.test(e),
  );
  expect(federation, federation.join('\n')).toEqual([]);
});
