import type { EstateNode } from '../../model/estate';
import { digestOf } from '../../model/state';

/** Fills `${kind}`, `${namespace}`, `${name}` in the Flux web UI template (each value URI-encoded). */
export function fluxWebLink(
  template: string | undefined,
  node: Pick<EstateNode, 'kind' | 'namespace' | 'name'>,
): string | undefined {
  if (template === undefined || template.trim() === '') return undefined;
  return fill(template, { kind: node.kind, namespace: node.namespace, name: node.name });
}

/**
 * Fills `${revision}` (the commit SHA, without branch or algorithm) and `${repo}` (the source URL as
 * `host/owner/name`: no scheme, user or `.git`) in the commit link template. Only Git revisions get a link.
 */
export function commitLink(
  template: string | undefined,
  revision: string | undefined,
  repoUrl: string | undefined,
): string | undefined {
  if (template === undefined || template.trim() === '' || revision === undefined) return undefined;
  const digest = digestOf(revision);
  if (digest === undefined || !digest.startsWith('sha1:')) return undefined;
  const sha = digest.slice('sha1:'.length);
  return fill(template, { revision: sha, repo: normaliseRepo(repoUrl ?? '') }, ['repo']);
}

export function normaliseRepo(url: string): string {
  return url
    .trim()
    .replace(/^git@([^:/]+):/, '$1/')
    .replace(/^[a-z+]+:\/\//i, '')
    .replace(/^[^@/]+@/, '')
    .replace(/:\d+\//, '/')
    .replace(/\/$/, '')
    .replace(/\.git$/, '');
}

function fill(template: string, values: Record<string, string>, raw: string[] = []): string | undefined {
  const out = template.replace(/\$\{(\w+)\}/g, (m, key: string) => {
    const v = values[key];
    if (v === undefined) return m;
    return raw.includes(key) ? v : encodeURIComponent(v);
  });
  // Only http(s) links: a template is dashboard data, never a javascript: URL.
  return /^https?:\/\//i.test(out) ? out : undefined;
}
