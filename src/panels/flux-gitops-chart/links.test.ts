import { commitLink, fluxWebLink, normaliseRepo } from './links';

describe('links', () => {
  it('fills the Flux web UI template', () => {
    expect(
      fluxWebLink('https://flux.example.com/resource/${kind}/${namespace}/${name}', {
        kind: 'Kustomization',
        namespace: 'flux-system',
        name: 'apps',
      }),
    ).toBe('https://flux.example.com/resource/Kustomization/flux-system/apps');
    expect(fluxWebLink(undefined, { kind: 'K', namespace: 'n', name: 'x' })).toBeUndefined();
  });

  it('only links http(s)', () => {
    expect(fluxWebLink('javascript:alert(1)//${name}', { kind: 'K', namespace: 'n', name: 'x' })).toBeUndefined();
  });

  it('fills commit links from Git revisions only', () => {
    expect(
      commitLink('https://${repo}/commit/${revision}', 'main@sha1:a12f0d3b', 'https://github.com/example/fleet.git'),
    ).toBe('https://github.com/example/fleet/commit/a12f0d3b');
    expect(commitLink('https://${repo}/commit/${revision}', '6.7.1@sha256:aa', 'oci://ghcr.io/x')).toBeUndefined();
  });

  it('normalises repository URLs', () => {
    expect(normaliseRepo('ssh://git@github.com/example/fleet')).toBe('github.com/example/fleet');
    expect(normaliseRepo('git@github.com:example/fleet.git')).toBe('github.com/example/fleet');
    expect(normaliseRepo('https://gitea.example.com:3000/org/repo/')).toBe('gitea.example.com/org/repo');
  });
});
