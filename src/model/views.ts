// Pure builders for the panel's views: the resource tree layout, stages, source chains, inventory
// and the flat list. Components only draw what these return.

import type { Estate, EstateNode } from './estate';
import { kustomizationStages } from './estate';
import type { FluxState } from './state';
import { STATE_SEVERITY, isProblem } from './state';

export interface ViewFilters {
  showSources: boolean;
  showHelmReleases: boolean;
  onlyProblems: boolean;
  showPods: boolean;
  groupThreshold: number;
}

/** Direct children of a node in the tree: what it applied, plus what its ownerReferences point at. */
export function childIndex(estate: Estate): Map<string, string[]> {
  const children = new Map<string, string[]>();
  const add = (parent: string, child: string): void => {
    const list = children.get(parent);
    if (list === undefined) children.set(parent, [child]);
    else if (!list.includes(child)) list.push(child);
  };
  for (const n of estate.nodes.values()) {
    if (n.id === estate.root) continue;
    if (n.managedBy !== undefined && estate.nodes.has(n.managedBy)) add(n.managedBy, n.id);
    else {
      const owner = n.ownerIds.find((o) => estate.nodes.has(o));
      if (owner !== undefined) add(owner, n.id);
      else if (estate.root !== undefined && n.role !== undefined && n.role !== 'fluxreport') add(estate.root, n.id);
    }
  }
  return children;
}

/** Every object under a node (recursive), cycle-safe. */
export function descendants(children: Map<string, string[]>, id: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>([id]);
  const stack = [...(children.get(id) ?? [])];
  while (stack.length > 0) {
    const c = stack.pop() as string;
    if (seen.has(c)) continue;
    seen.add(c);
    out.push(c);
    stack.push(...(children.get(c) ?? []));
  }
  return out;
}

/** Worst state in a subtree, for collapsed cards and default expansion. */
export function worstStates(estate: Estate, children: Map<string, string[]>): Map<string, FluxState> {
  const memo = new Map<string, FluxState>();
  const visiting = new Set<string>();
  const worst = (id: string): FluxState => {
    const known = memo.get(id);
    if (known !== undefined) return known;
    if (visiting.has(id)) return 'ready';
    visiting.add(id);
    let w: FluxState = estate.nodes.get(id)?.state ?? 'unknown';
    for (const c of children.get(id) ?? []) {
      const s = worst(c);
      if (isProblem(s) && STATE_SEVERITY[s] > (isProblem(w) ? STATE_SEVERITY[w] : -1)) w = s;
    }
    visiting.delete(id);
    memo.set(id, w);
    return w;
  };
  for (const id of estate.nodes.keys()) worst(id);
  return memo;
}

// ---------- tree ----------

export interface TreeCard {
  key: string;
  /** The estate node, or undefined for a group card ("8 ServiceMonitors"). */
  nodeId?: string;
  group?: { kind: string; ids: string[] };
  depth: number;
  row: number;
  parentKey?: string;
  /** Children hidden behind this card (collapsed, or a group). */
  hidden: number;
  expanded: boolean;
  expandable: boolean;
  /** The card has a page of its own: clicking it drills into it (its children, or a source's consumers). */
  drillable: boolean;
  /** Worst state below, shown on collapsed cards. */
  worst?: FluxState;
}

export interface TreeLayout {
  cards: TreeCard[];
  edges: Array<{ from: string; to: string }>;
  rows: number;
  depth: number;
  /** The object the page is drilled into; undefined on the top level. */
  focus?: string;
}

const KIND_ORDER = [
  'FluxInstance',
  'GitRepository',
  'OCIRepository',
  'Bucket',
  'HelmRepository',
  'HelmChart',
  'ResourceSetInputProvider',
  'ResourceSet',
  'Kustomization',
  'HelmRelease',
  'Namespace',
  'CustomResourceDefinition',
  'Deployment',
  'StatefulSet',
  'DaemonSet',
  'ReplicaSet',
  'Pod',
];

export function kindRank(kind: string): number {
  const i = KIND_ORDER.indexOf(kind);
  return i < 0 ? KIND_ORDER.length : i;
}

function visible(n: EstateNode, f: ViewFilters): boolean {
  if (!f.showSources && n.role === 'source') return false;
  if (!f.showPods && n.kind === 'Pod') return false;
  return true;
}

/** Child to parent, the inverse of `childIndex` (first parent wins). */
export function parentIndex(children: Map<string, string[]>): Map<string, string> {
  const parents = new Map<string, string>();
  for (const [p, kids] of children) for (const c of kids) if (!parents.has(c)) parents.set(c, p);
  return parents;
}

/**
 * Where Flux starts: the root (root Kustomization or FluxInstance) and, under a FluxInstance, the sync
 * Kustomization it generates. The tree never shows these as its entry; it starts one level below.
 */
export function treeStart(estate: Estate, children: Map<string, string[]> = childIndex(estate)): Set<string> {
  const start = new Set<string>();
  if (estate.root === undefined) return start;
  start.add(estate.root);
  if (estate.nodes.get(estate.root)?.role === 'fluxinstance') {
    for (const c of children.get(estate.root) ?? []) if (estate.nodes.get(c)?.role === 'kustomization') start.add(c);
  }
  return start;
}

/** Live Flux objects whose `sourceRef` is this source: what a source's page shows below it. */
export function sourceConsumers(estate: Estate): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const n of estate.nodes.values()) {
    if (n.sourceRef === undefined || !n.live || n.sourceRef === n.id || !estate.nodes.has(n.sourceRef)) continue;
    const list = out.get(n.sourceRef);
    if (list === undefined) out.set(n.sourceRef, [n.id]);
    else list.push(n.id);
  }
  return out;
}

/**
 * The top level of the tree: Flux objects (not the FluxReport) that no other Flux object manages, or that
 * only the start (see `treeStart`) manages.
 */
export function topLevel(estate: Estate, children: Map<string, string[]> = childIndex(estate)): string[] {
  const start = treeStart(estate, children);
  const parents = parentIndex(children);
  const out: string[] = [];
  for (const n of estate.nodes.values()) {
    if (n.role === undefined || n.role === 'fluxreport' || start.has(n.id)) continue;
    const p = parents.get(n.id);
    if (p === undefined || start.has(p)) out.push(n.id);
  }
  return out.sort((a, b) => compareNodes(estate.nodes.get(a), estate.nodes.get(b)));
}

/** The breadcrumb to a drilled-into object: its ancestors from the top level down, ending with itself. */
export function treePath(
  estate: Estate,
  focus: string,
  children: Map<string, string[]> = childIndex(estate),
): string[] {
  const start = treeStart(estate, children);
  const parents = parentIndex(children);
  const path: string[] = [];
  const seen = new Set<string>();
  let current: string | undefined = focus;
  while (current !== undefined && estate.nodes.has(current) && !seen.has(current)) {
    seen.add(current);
    path.unshift(current);
    const p = parents.get(current);
    if (p === undefined || start.has(p)) break;
    current = p;
  }
  return path;
}

/**
 * Lays out one page of the tree as levels (`depth`) and leaf slots (`row`), parents centred on their
 * children; the view turns that into top-to-bottom or left-to-right positions.
 *
 * Without `focus` it is the top level: one card per `topLevel` object, nothing expanded. With `focus` it
 * is that object and what it manages; for a source, the objects that use it, unfolded. `expanded`
 * overrides the default (the page's object open, problems open, healthy branches closed).
 */
export function layoutTree(
  estate: Estate,
  filters: ViewFilters,
  expanded: ReadonlyMap<string, boolean> = new Map(),
  children: Map<string, string[]> = childIndex(estate),
  focus?: string,
): TreeLayout {
  const worst = worstStates(estate, children);
  const consumers = sourceConsumers(estate);
  const focusNode = focus === undefined ? undefined : estate.nodes.get(focus);
  const sourcePage = focusNode?.role === 'source';
  // Kustomizations in pipeline order (crds before controllers before configs), like the Stages view.
  const stages = kustomizationStages(estate);
  const byStage = (a: string, b: string): number => {
    const na = estate.nodes.get(a);
    const nb = estate.nodes.get(b);
    if (na === undefined || nb === undefined) return 0;
    return kindRank(na.kind) - kindRank(nb.kind) || (stages.get(a) ?? 0) - (stages.get(b) ?? 0) || compareNodes(na, nb);
  };
  const cards: TreeCard[] = [];
  const edges: Array<{ from: string; to: string }> = [];
  let rows = 0;
  let maxDepth = 0;
  const seen = new Set<string>();

  const keep = (id: string): boolean => {
    const n = estate.nodes.get(id);
    if (n === undefined) return false;
    if (filters.onlyProblems && !isProblem(worst.get(id) ?? n.state) && id !== focus) return false;
    return true;
  };
  const childrenOf = (id: string): string[] =>
    id === focus && sourcePage ? (consumers.get(id) ?? []) : (children.get(id) ?? []);
  const drillable = (id: string): boolean => {
    if (id === focus) return false;
    if ((children.get(id)?.length ?? 0) > 0) return true;
    return estate.nodes.get(id)?.role === 'source' && (consumers.get(id)?.length ?? 0) > 0;
  };

  // Hidden kinds (sources off, Helm releases off) lift their children one level up.
  const lift = (ids: string[]): string[] => {
    const out: string[] = [];
    for (const c of ids) {
      const n = estate.nodes.get(c);
      if (n === undefined || seen.has(c)) continue;
      if (!filters.showHelmReleases && n.role === 'helmrelease') out.push(...lift(children.get(c) ?? []));
      else if (visible(n, filters) && keep(c)) out.push(c);
    }
    return out;
  };
  const visibleChildren = (id: string): string[] => lift(childrenOf(id)).sort(byStage);

  if (focusNode === undefined) {
    // The top level: one card per top-level object, each drilling into a page of its own.
    for (const id of [...new Set(lift(topLevel(estate, children)))].sort(byStage)) {
      cards.push({
        key: id,
        nodeId: id,
        depth: 0,
        row: rows++,
        hidden: visibleChildren(id).length,
        expanded: false,
        expandable: false,
        drillable: drillable(id),
        worst: worst.get(id),
      });
    }
    return { cards, edges, rows, depth: 0 };
  }

  const place = (id: string, depth: number, parentKey: string | undefined): TreeCard => {
    seen.add(id);
    const n = estate.nodes.get(id) as EstateNode;
    const kids = visibleChildren(id);
    const problemBelow = isProblem(worst.get(id) ?? n.state);
    // The page's object is always open; on a source's page the objects that use it open too.
    const defaultOpen = problemBelow || (sourcePage && depth === 1);
    const open = kids.length > 0 && (depth === 0 || (expanded.get(id) ?? defaultOpen));
    const card: TreeCard = {
      key: id,
      nodeId: id,
      depth,
      row: 0,
      parentKey,
      hidden: open ? 0 : kids.length,
      expanded: open,
      expandable: kids.length > 0,
      drillable: drillable(id),
      worst: worst.get(id),
    };
    cards.push(card);
    maxDepth = Math.max(maxDepth, depth);
    if (parentKey !== undefined) edges.push({ from: parentKey, to: card.key });
    if (!open) {
      card.row = rows++;
      return card;
    }
    // Group plain kinds with more objects than the threshold ("8 ServiceMonitors").
    const byKind = new Map<string, string[]>();
    for (const c of kids) {
      const k = estate.nodes.get(c) as EstateNode;
      const list = byKind.get(k.kind) ?? [];
      list.push(c);
      byKind.set(k.kind, list);
    }
    const placed: TreeCard[] = [];
    for (const c of kids) {
      const k = estate.nodes.get(c) as EstateNode;
      const sameKind = byKind.get(k.kind) ?? [];
      const groupable = k.role === undefined && sameKind.length > filters.groupThreshold;
      if (!groupable) {
        if (!seen.has(c)) placed.push(place(c, depth + 1, card.key));
        continue;
      }
      if (sameKind[0] !== c) continue;
      const gKey = `${id}#${k.kind}`;
      const groupWorst = sameKind.reduce<FluxState>((w, x) => {
        const s = worst.get(x) ?? 'ready';
        return isProblem(s) && STATE_SEVERITY[s] > (isProblem(w) ? STATE_SEVERITY[w] : -1) ? s : w;
      }, 'ready');
      const gOpen = expanded.get(gKey) ?? isProblem(groupWorst);
      const gCard: TreeCard = {
        key: gKey,
        group: { kind: k.kind, ids: sameKind },
        depth: depth + 1,
        row: 0,
        parentKey: card.key,
        hidden: gOpen ? 0 : sameKind.length,
        expanded: gOpen,
        expandable: true,
        drillable: false,
        worst: groupWorst,
      };
      cards.push(gCard);
      edges.push({ from: card.key, to: gKey });
      maxDepth = Math.max(maxDepth, depth + 1);
      if (gOpen) {
        const sub = sameKind.filter((x) => !seen.has(x)).map((x) => place(x, depth + 2, gKey));
        gCard.row = sub.length > 0 ? centre(sub) : rows++;
      } else {
        sameKind.forEach((x) => seen.add(x));
        gCard.row = rows++;
      }
      placed.push(gCard);
    }
    card.row = placed.length > 0 ? centre(placed) : rows++;
    return card;
  };

  place(focusNode.id, 0, undefined);
  return { cards, edges, rows, depth: maxDepth, focus: focusNode.id };
}

function centre(cards: TreeCard[]): number {
  const first = cards[0] as TreeCard;
  const last = cards[cards.length - 1] as TreeCard;
  return (first.row + last.row) / 2;
}

export function compareNodes(a: EstateNode | undefined, b: EstateNode | undefined): number {
  if (a === undefined || b === undefined) return 0;
  return (
    kindRank(a.kind) - kindRank(b.kind) ||
    a.kind.localeCompare(b.kind) ||
    a.namespace.localeCompare(b.namespace) ||
    a.name.localeCompare(b.name)
  );
}

// ---------- stages ----------

export interface StageColumn {
  stage: number;
  ids: string[];
}

export interface StagesView {
  sources: string[];
  columns: StageColumn[];
  /** Kustomizations behind a failed or waiting stage: id → the problem it waits on. */
  blockedBy: Map<string, string>;
}

export function buildStages(estate: Estate, filters: Pick<ViewFilters, 'onlyProblems'>): StagesView {
  const stages = kustomizationStages(estate);
  const byStage = new Map<number, string[]>();
  for (const [id, s] of stages) {
    const list = byStage.get(s) ?? [];
    list.push(id);
    byStage.set(s, list);
  }
  const blockedBy = new Map<string, string>();
  const ordered = [...stages.entries()].sort((a, b) => a[1] - b[1]);
  for (const [id] of ordered) {
    const n = estate.nodes.get(id);
    for (const dep of n?.dependsOn ?? []) {
      const d = estate.nodes.get(dep);
      if (d === undefined) continue;
      if (d.state === 'failed' || d.state === 'waiting' || d.state === 'suspended') blockedBy.set(id, dep);
      else if (blockedBy.has(dep)) blockedBy.set(id, blockedBy.get(dep) as string);
    }
  }
  const usedSources = new Set<string>();
  for (const id of stages.keys()) {
    const src = estate.nodes.get(id)?.sourceRef;
    if (src !== undefined && estate.nodes.has(src)) usedSources.add(src);
  }
  const keepId = (id: string): boolean => {
    if (!filters.onlyProblems) return true;
    const n = estate.nodes.get(id);
    return n !== undefined && (isProblem(n.state) || blockedBy.has(id));
  };
  const columns = [...byStage.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([stage, ids]) => ({
      stage,
      ids: ids.filter(keepId).sort((a, b) => compareNodes(estate.nodes.get(a), estate.nodes.get(b))),
    }))
    .filter((c) => c.ids.length > 0);
  return { sources: [...usedSources].sort(), columns, blockedBy };
}

// ---------- sources ----------

export interface SourceRow {
  id: string;
  /** Indent level in source chains. */
  level: number;
  /** The Kustomization (or HelmRelease) whose output defines this source. */
  definedIn?: string;
  kustomizations: string[];
  helmReleases: string[];
  /** HelmCharts, ResourceSets and other consumers. */
  otherConsumers: string[];
  delivered: string[];
  unhealthy: number;
  /** Sources defined by what this one delivers. */
  creates: string[];
}

export function buildSources(estate: Estate, children: Map<string, string[]> = childIndex(estate)): SourceRow[] {
  const sources = [...estate.nodes.values()].filter((n) => n.role === 'source' && n.kind !== 'HelmChart');
  const rows = new Map<string, SourceRow>();
  for (const s of sources) {
    const consumers = [...estate.nodes.values()].filter((n) => n.sourceRef === s.id && n.live);
    const delivered = new Set<string>();
    for (const c of consumers) for (const d of descendants(children, c.id)) delivered.add(d);
    const deliveredList = [...delivered];
    rows.set(s.id, {
      id: s.id,
      level: 0,
      kustomizations: consumers.filter((c) => c.role === 'kustomization').map((c) => c.id),
      helmReleases: consumers.filter((c) => c.role === 'helmrelease').map((c) => c.id),
      otherConsumers: consumers.filter((c) => c.role !== 'kustomization' && c.role !== 'helmrelease').map((c) => c.id),
      delivered: deliveredList,
      unhealthy: deliveredList.filter((d) => isProblem(estate.nodes.get(d)?.state ?? 'unknown')).length,
      creates: [],
      definedIn: s.managedBy,
    });
  }
  // Chains: source B is under source A when A's consumers applied B.
  const parentOf = new Map<string, string>();
  for (const row of rows.values()) {
    for (const d of row.delivered) {
      if (rows.has(d) && d !== row.id && !parentOf.has(d)) {
        parentOf.set(d, row.id);
        row.creates.push(d);
      }
    }
  }
  const ordered: SourceRow[] = [];
  const visit = (id: string, level: number, seen: Set<string>): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const row = rows.get(id) as SourceRow;
    row.level = level;
    ordered.push(row);
    for (const c of [...row.creates].sort((a, b) => compareNodes(estate.nodes.get(a), estate.nodes.get(b))))
      visit(c, level + 1, seen);
  };
  const seen = new Set<string>();
  const tops = [...rows.keys()]
    .filter((id) => !parentOf.has(id))
    .sort((a, b) => compareNodes(estate.nodes.get(a), estate.nodes.get(b)));
  for (const t of tops) visit(t, 0, seen);
  for (const id of rows.keys()) visit(id, 0, seen);
  return ordered;
}

// ---------- inventory ----------

export interface InventoryView {
  breadcrumbs: string[];
  groups: Array<{ kind: string; ids: string[] }>;
  total: number;
}

export function buildInventory(
  estate: Estate,
  id: string,
  children: Map<string, string[]> = childIndex(estate),
): InventoryView {
  const breadcrumbs: string[] = [];
  let current = estate.nodes.get(id);
  const seen = new Set<string>();
  while (current !== undefined && !seen.has(current.id)) {
    seen.add(current.id);
    breadcrumbs.unshift(current.id);
    const parent = current.managedBy ?? current.ownerIds.find((o) => estate.nodes.has(o));
    current = parent === undefined ? undefined : estate.nodes.get(parent);
  }
  const all = descendants(children, id);
  const byKind = new Map<string, string[]>();
  for (const d of all) {
    const n = estate.nodes.get(d);
    if (n === undefined) continue;
    const list = byKind.get(n.kind) ?? [];
    list.push(d);
    byKind.set(n.kind, list);
  }
  const groups = [...byKind.entries()]
    .sort((a, b) => kindRank(a[0]) - kindRank(b[0]) || a[0].localeCompare(b[0]))
    .map(([kind, ids]) => ({ kind, ids: ids.sort((a, b) => compareNodes(estate.nodes.get(a), estate.nodes.get(b))) }));
  return { breadcrumbs, groups, total: all.length };
}

// ---------- list ----------

export interface ListRow {
  id: string;
  kind: string;
  name: string;
  namespace: string;
  stage?: number;
  state: FluxState;
  revision: string;
  createdAt?: string;
}

export type ListSortKey = 'kind' | 'name' | 'namespace' | 'stage' | 'status' | 'revision' | 'age';

export function buildList(estate: Estate, onlyProblems: boolean): ListRow[] {
  const stages = kustomizationStages(estate);
  const rows: ListRow[] = [];
  for (const n of estate.nodes.values()) {
    if (n.role === undefined || !n.live) continue;
    if (onlyProblems && !isProblem(n.state)) continue;
    rows.push({
      id: n.id,
      kind: n.kind,
      name: n.name,
      namespace: n.namespace,
      stage: stages.get(n.id),
      state: n.state,
      revision:
        n.role === 'helmrelease'
          ? [n.chart, n.chartVersion].filter(Boolean).join(' ')
          : (n.appliedRevision ?? n.note ?? ''),
      createdAt: n.createdAt,
    });
  }
  return rows;
}

export function sortList(rows: ListRow[], key: ListSortKey, direction: 1 | -1): ListRow[] {
  const value = (r: ListRow): string | number => {
    switch (key) {
      case 'stage':
        return r.stage ?? Number.MAX_SAFE_INTEGER;
      case 'status':
        return -STATE_SEVERITY[r.state];
      case 'age':
        return r.createdAt === undefined ? 0 : -Date.parse(r.createdAt);
      case 'kind':
        return r.kind;
      case 'namespace':
        return r.namespace;
      case 'revision':
        return r.revision;
      default:
        return r.name;
    }
  };
  return [...rows].sort((a, b) => {
    const va = value(a);
    const vb = value(b);
    const c = typeof va === 'number' && typeof vb === 'number' ? va - vb : String(va).localeCompare(String(vb));
    return c * direction || a.name.localeCompare(b.name);
  });
}

// ---------- header ----------

export interface Kpis {
  controllers: { ready: number; total: number };
  sources: { total: number; failing: number };
  kustomizations: { total: number; failing: number };
  helmReleases: { total: number; failing: number };
  suspended: number;
  sync: { state: FluxState; label: string };
}

export function computeKpis(estate: Estate): Kpis {
  const count = (role: string): { total: number; failing: number } => {
    let total = 0;
    let failing = 0;
    for (const n of estate.nodes.values()) {
      if (n.role !== role || !n.live || (role === 'source' && n.kind === 'HelmChart')) continue;
      total++;
      if (isProblem(n.state)) failing++;
    }
    return { total, failing };
  };
  let suspended = 0;
  for (const n of estate.nodes.values()) if (n.live && n.role !== undefined && n.state === 'suspended') suspended++;
  const root = estate.root === undefined ? undefined : estate.nodes.get(estate.root);
  const report = estate.report?.sync;
  let sync: Kpis['sync'] = { state: 'unknown', label: 'No root' };
  if (report !== undefined)
    sync = {
      state: report.ready ? 'ready' : 'failed',
      label: report.status ?? (report.ready ? 'Synced' : 'Not synced'),
    };
  else if (root !== undefined)
    sync = { state: root.state, label: root.state === 'ready' ? 'Synced' : (root.reason ?? root.state) };
  return {
    controllers: estate.controllers,
    sources: count('source'),
    kustomizations: count('kustomization'),
    helmReleases: count('helmrelease'),
    suspended,
    sync,
  };
}
