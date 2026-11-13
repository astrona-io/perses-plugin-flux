// Reads Helm repository indexes that source-controller already serves in the cluster, through the
// Kubernetes datasource's Perses proxy and the API server's service proxy, and keeps only the chart
// versions. An index can be tens of megabytes (large public repositories), so:
//   - it is read only when the List view or a HelmRelease's drawer needs it, and only for repositories
//     that back a HelmRelease;
//   - the request path contains the index digest, so a path is read at most once: the cache is keyed by
//     it and holds the version lists, not the text;
//   - a new digest for the same repository replaces the old entry;
//   - only the needed charts are parsed out of a YAML index (a JSON index is parsed whole, which is fast).

import type { FailureKind } from './fetch';
import { classifyError } from './fetch';

/** Reads one path through the Kubernetes datasource's proxy URL and returns the body as text. */
export interface IndexReader {
  /** The datasource's proxy URL: different datasources never share cache entries. */
  key: string;
  read: (path: string) => Promise<string>;
}

export class IndexReadError extends Error {
  readonly failure: FailureKind;
  constructor(message: string, failure: FailureKind) {
    super(message);
    this.failure = failure;
  }
}

/**
 * A reader over the datasource's proxy URL (`/proxy/globaldatasources/<name>` or the project-scoped
 * form, as the Kubernetes datasource client exposes it). Plain fetch: the datasource client only does
 * list requests with a JSON Accept header.
 */
export function proxyIndexReader(
  datasourceUrl: string,
  doFetch: typeof globalThis.fetch = globalThis.fetch,
): IndexReader {
  const base = datasourceUrl.replace(/\/$/, '');
  return {
    key: base,
    read: async (path) => {
      const response = await doFetch(`${base}${path}`, { method: 'GET', headers: { Accept: '*/*' } });
      const text = await response.text();
      if (response.ok) return text;
      let message = text.trim();
      try {
        const body = JSON.parse(text) as { message?: unknown; error?: unknown };
        const m = typeof body.message === 'string' ? body.message : body.error;
        if (typeof m === 'string' && m !== '') message = m;
      } catch {
        // Not JSON: source-controller and the API server's proxy errors are plain text.
      }
      message = `${message.slice(0, 300) || response.statusText} (HTTP ${response.status})`;
      throw new IndexReadError(message, classifyError(message));
    },
  };
}

/** Chart name to the version strings in its index entries. */
export type ChartVersions = Map<string, string[]>;

function versionsOf(entries: unknown, chart: string): string[] | undefined {
  if (typeof entries !== 'object' || entries === null) return undefined;
  const list = (entries as Record<string, unknown>)[chart];
  if (!Array.isArray(list)) return undefined;
  return list
    .map((e) => (typeof e === 'object' && e !== null ? (e as { version?: unknown }).version : undefined))
    .map((v) => (typeof v === 'number' ? String(v) : v))
    .filter((v): v is string => typeof v === 'string');
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The lines of one chart under `entries:` in a YAML index, as Go's YAML encoder writes it (the
 * chart key indented by two spaces, its entries deeper or as `  - ` items). Undefined when not found.
 */
export function chartBlock(text: string, chart: string): string | undefined {
  const entries = /^entries:[ \t]*\r?$/m.exec(text);
  if (entries === null) return undefined;
  const key = new RegExp(`^  (["']?)${escapeRegExp(chart)}\\1:[ \\t]*\\r?$`, 'm');
  const rest = text.slice(entries.index);
  const k = key.exec(rest);
  if (k === null) return undefined;
  const start = entries.index + k.index;
  // The block ends at the first line that is neither indented by three or more spaces, nor a
  // `  -` list item, nor empty.
  const end = /\n(?! {3}| {2}-|\r?\n|$)/g;
  end.lastIndex = start + k[0].length;
  const m = end.exec(text);
  return text.slice(start, m === null ? text.length : m.index);
}

const FULL_YAML_LIMIT = 2 * 1024 * 1024;

/** The versions of `charts` in an index (JSON or YAML). A chart missing from the index is left out. */
export async function parseIndex(text: string, charts: string[]): Promise<ChartVersions> {
  const out: ChartVersions = new Map();
  const trimmed = text.trimStart();
  if (trimmed.startsWith('{')) {
    const entries = (JSON.parse(trimmed) as { entries?: unknown }).entries;
    for (const chart of charts) {
      const v = versionsOf(entries, chart);
      if (v !== undefined) out.set(chart, v);
    }
    return out;
  }
  // Loaded only when an index is YAML, which keeps it out of the panel's first load.
  const { parse } = await import('yaml');
  const missing: string[] = [];
  for (const chart of charts) {
    const block = chartBlock(text, chart);
    if (block === undefined) {
      missing.push(chart);
      continue;
    }
    const v = versionsOf((parse(`entries:\n${block}`) as { entries?: unknown } | null)?.entries, chart);
    if (v !== undefined) out.set(chart, v);
    else missing.push(chart);
  }
  // A layout the line scan does not know: parse the whole index, but only when it is small.
  if (missing.length > 0 && text.length <= FULL_YAML_LIMIT) {
    const entries = (parse(text) as { entries?: unknown } | null)?.entries;
    for (const chart of missing) {
      const v = versionsOf(entries, chart);
      if (v !== undefined) out.set(chart, v);
    }
  }
  return out;
}

interface Entry {
  path: string;
  charts: Set<string>;
  promise: Promise<ChartVersions>;
  failedAt?: number;
}

/** Retry a failed index after this long (the panel re-renders on every dashboard refresh). */
const RETRY_MS = 60_000;

const cache = new Map<string, Entry>();

/**
 * The versions of `charts` in the index at `path` for the repository `repo`. One request per path,
 * shared by every panel on the page that uses the same datasource; a new path (new digest) for the
 * repository replaces the cached one.
 */
export function loadChartVersions(
  reader: IndexReader,
  repo: string,
  path: string,
  charts: string[],
  now: () => number = Date.now,
): Promise<ChartVersions> {
  const key = `${reader.key}|${repo}`;
  const hit = cache.get(key);
  if (
    hit !== undefined &&
    hit.path === path &&
    charts.every((c) => hit.charts.has(c)) &&
    (hit.failedAt === undefined || now() - hit.failedAt < RETRY_MS)
  ) {
    return hit.promise;
  }
  const wanted = new Set(charts);
  // Same index, a chart not parsed yet (a new HelmRelease on the same repository): read it again with
  // the union, so the cache keeps one entry per repository.
  if (hit !== undefined && hit.path === path && hit.failedAt === undefined) for (const c of hit.charts) wanted.add(c);
  const entry: Entry = {
    path,
    charts: wanted,
    promise: reader.read(path).then((text) => parseIndex(text, [...wanted])),
  };
  entry.promise.catch(() => {
    entry.failedAt = now();
  });
  cache.set(key, entry);
  return entry.promise;
}
