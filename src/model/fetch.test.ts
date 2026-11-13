import { describe, expect, it } from 'vitest';

import { classifyError, describeFailures, fetchEstate, listPath, RESOURCES } from './fetch';
import type { KubernetesListClient } from './fetch';

function fakeClient(answers: Record<string, unknown[] | Error>): KubernetesListClient & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    list: async <T>(path: string): Promise<{ items: T[]; truncated: boolean; pages: number }> => {
      calls.push(path);
      const a = answers[path];
      if (a instanceof Error) throw a;
      return { items: (a ?? []) as T[], truncated: false, pages: 1 };
    },
  };
}

describe('listPath', () => {
  it('builds core, group and namespaced paths', () => {
    expect(listPath({ group: '', version: 'v1', plural: 'pods', namespaced: true })).toBe('/api/v1/pods');
    expect(listPath({ group: 'apps', version: 'v1', plural: 'deployments', namespaced: true }, 'x')).toBe(
      '/apis/apps/v1/namespaces/x/deployments',
    );
    expect(listPath({ group: '', version: 'v1', plural: 'namespaces', namespaced: false }, 'x')).toBe(
      '/api/v1/namespaces',
    );
  });
  it('every list path matches the datasource LIST_PATH rule', () => {
    for (const r of RESOURCES) expect(listPath(r)).toMatch(/^\/apis?\/[a-z0-9.-]+(\/[a-z0-9.-]+)*$/);
  });
});

describe('classifyError', () => {
  it.each([
    [
      'kustomizations.kustomize.toolkit.fluxcd.io is forbidden: User "system:serviceaccount:perses:perses" cannot list resource',
      'forbidden',
    ],
    ['the server could not find the requested resource', 'not-installed'],
    ['HTTP 404 for /apis/fluxcd.controlplane.io/v1/fluxinstances', 'not-installed'],
    ['HTTP 500 for /api/v1/pods', 'error'],
    ['Failed to fetch', 'error'],
    [
      'forbidden access: you are not allowed to use this endpoint "/api/v1/secrets" with the HTTP method GET',
      'proxy-endpoint',
    ],
    [
      "forbidden access: the datasource destination is not allowed by the Perses server configuration ('datasource.proxy')",
      'proxy-network',
    ],
  ])('%s', (message, kind) => expect(classifyError(message)).toBe(kind));
});

describe('fetchEstate', () => {
  it('lists every resource cluster-wide, keyed by group/Kind', async () => {
    const client = fakeClient({
      '/apis/kustomize.toolkit.fluxcd.io/v1/kustomizations': [{ metadata: { name: 'a' } }],
      '/apis/fluxcd.controlplane.io/v1/fluxinstances': new Error('the server could not find the requested resource'),
    });
    const r = await fetchEstate(client);
    expect(r.lists['kustomize.toolkit.fluxcd.io/Kustomization']).toHaveLength(1);
    expect(r.installed).toEqual({ flux: true, operator: true });
    expect(r.failures.map((f) => f.kind)).toEqual(['not-installed']);
    expect(client.calls).toContain('/api/v1/events');
    expect(client.calls).toContain('/api/v1/pods');
    expect(r.requests).toBe(client.calls.length);
  });

  it('per namespace when namespaces are set, cluster-scoped kinds once; no pods when hidden', async () => {
    const client = fakeClient({});
    await fetchEstate(client, { namespaces: ['a', 'b'], showPods: false });
    expect(client.calls).toContain('/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/a/kustomizations');
    expect(client.calls).toContain('/apis/kustomize.toolkit.fluxcd.io/v1/namespaces/b/kustomizations');
    expect(client.calls.filter((c) => c === '/api/v1/namespaces')).toHaveLength(1);
    expect(client.calls).toContain('/api/v1/namespaces/a/events');
    expect(client.calls.some((c) => c.endsWith('/pods'))).toBe(false);
  });
});

describe('describeFailures', () => {
  it('Flux not installed', () => {
    const p = describeFailures({
      failures: [
        { resource: 'kustomize.toolkit.fluxcd.io/Kustomization', path: '/x', kind: 'not-installed', message: '' },
      ],
      installed: { flux: false, operator: false },
      truncated: [],
    });
    expect(p[0]).toMatchObject({ severity: 'error', title: 'Flux is not installed in this cluster' });
  });
  it('forbidden Flux lists name the paths and the RBAC file', () => {
    const p = describeFailures({
      failures: [
        {
          resource: 'kustomize.toolkit.fluxcd.io/Kustomization',
          path: '/apis/kustomize.toolkit.fluxcd.io/v1/kustomizations',
          kind: 'forbidden',
          message: '',
        },
      ],
      installed: { flux: false, operator: false },
      truncated: [],
    });
    expect(p[0]?.severity).toBe('error');
    expect(p[0]?.detail).toContain('deploy/rbac.yaml');
    expect(p[1]?.severity).toBe('warning');
  });
  it('a missing operator alone says nothing', () => {
    expect(
      describeFailures({
        failures: [{ resource: 'fluxcd.controlplane.io/FluxInstance', path: '/x', kind: 'not-installed', message: '' }],
        installed: { flux: true, operator: false },
        truncated: [],
      }),
    ).toEqual([]);
  });
  it('a refused proxy destination is one clear error, not one line per list', () => {
    const message =
      "forbidden access: the datasource destination is not allowed by the Perses server configuration ('datasource.proxy')";
    const failures = ['/api/v1/pods', '/api/v1/events', '/apis/kustomize.toolkit.fluxcd.io/v1/kustomizations'].map(
      (path) => ({ resource: path, path, kind: classifyError(message), message }),
    );
    const p = describeFailures({ failures, installed: { flux: false, operator: false }, truncated: [] });
    expect(p).toHaveLength(1);
    expect(p[0]).toMatchObject({ severity: 'error', title: 'Perses may not reach the API server' });
    expect(p[0]?.detail).toContain('allowed_networks');
  });
  it('other errors are grouped by message', () => {
    const failures = ['/a', '/b', '/c', '/d'].map((path) => ({
      resource: path,
      path,
      kind: 'error' as const,
      message: 'HTTP 500',
    }));
    const p = describeFailures({ failures, installed: { flux: true, operator: false }, truncated: [] });
    expect(p[0]?.detail).toBe('HTTP 500 (/a, /b, /c and 1 more)');
  });
  it('truncated lists warn', () => {
    expect(
      describeFailures({ failures: [], installed: { flux: true, operator: false }, truncated: ['/api/v1/pods'] })[0]
        ?.title,
    ).toBe('Some lists were cut short');
  });
});

describe('allow-list paths', () => {
  // test/allowlist/paths.json is what the Go test checks against deploy/kubernetes-datasource.json
  // with Go's regexp engine. This keeps that list equal to what fetchEstate really asks for.
  it('test/allowlist/paths.json lists every path the panel reads', async () => {
    const all = fakeClient({});
    await fetchEstate(all, { showPods: true });
    const scoped = fakeClient({});
    await fetchEstate(scoped, { showPods: true, namespaces: ['flux-system', 'team-a1'] });
    const expected = [...new Set([...all.calls, ...scoped.calls])].sort();
    const { readFileSync, writeFileSync } = await import('node:fs');
    const { resolve } = await import('node:path');
    const file = resolve(process.cwd(), 'test/allowlist/paths.json');
    // UPDATE_ALLOWLIST=1 npm test rewrites the file after a change to RESOURCES.
    if (process.env.UPDATE_ALLOWLIST) writeFileSync(file, `${JSON.stringify({ allowed: expected }, null, 2)}\n`);
    const listed = JSON.parse(readFileSync(file, 'utf8')) as { allowed: string[] };
    expect([...listed.allowed].sort()).toEqual(expected);
  });
});
