import { describe, expect, it } from 'vitest';

import { largeObjects, raw, stagedEstate } from '../test/fixtures';
import { buildEstate, nodeId } from './estate';
import {
  buildInventory,
  buildList,
  buildSources,
  buildStages,
  childIndex,
  computeKpis,
  layoutTree,
  sortList,
} from './views';

const K = (name: string): string => nodeId('kustomize.toolkit.fluxcd.io', 'Kustomization', 'flux-system', name);
const filters = { showSources: true, showHelmReleases: true, onlyProblems: false, showPods: true, groupThreshold: 2 };

describe('layoutTree', () => {
  const estate = stagedEstate();

  it('starts at the root and opens problem branches by default', () => {
    const t = layoutTree(estate, filters);
    const root = t.cards[0];
    expect(root?.nodeId).toBe(K('flux-system'));
    expect(root?.depth).toBe(0);
    const monitoring = t.cards.find((c) => c.nodeId === K('monitoring'));
    expect(monitoring?.expanded).toBe(true);
    const crds = t.cards.find((c) => c.nodeId === K('infra-crds'));
    expect(crds?.expanded).toBe(false);
    expect(crds?.hidden).toBeGreaterThan(0);
    for (const e of t.edges) {
      expect(t.cards.some((c) => c.key === e.from)).toBe(true);
      expect(t.cards.some((c) => c.key === e.to)).toBe(true);
    }
  });

  it('groups same-kind siblings over the threshold', () => {
    const t = layoutTree(estate, filters);
    const group = t.cards.find((c) => c.group?.kind === 'ServiceMonitor');
    expect(group?.group?.ids).toHaveLength(4);
    const ungrouped = layoutTree(estate, { ...filters, groupThreshold: 10 });
    expect(ungrouped.cards.filter((c) => estate.nodes.get(c.nodeId ?? '')?.kind === 'ServiceMonitor')).toHaveLength(4);
  });

  it('expanded overrides win', () => {
    const t = layoutTree(
      estate,
      filters,
      new Map([
        [K('monitoring'), false],
        [K('infra-crds'), true],
      ]),
    );
    expect(t.cards.find((c) => c.nodeId === K('monitoring'))?.expanded).toBe(false);
    expect(t.cards.some((c) => c.group?.kind === 'CustomResourceDefinition')).toBe(true);
  });

  it('only problems keeps the path to every problem and nothing healthy beside it', () => {
    const t = layoutTree(estate, { ...filters, onlyProblems: true });
    const kinds = t.cards.map((c) => c.nodeId).filter((x): x is string => x !== undefined);
    expect(kinds).toContain(K('monitoring'));
    expect(kinds).not.toContain(K('infra-crds'));
  });

  it('hiding Helm releases lifts their children', () => {
    const t = layoutTree(estate, { ...filters, showHelmReleases: false }, new Map([[K('infra-controllers'), true]]));
    expect(t.cards.some((c) => estate.nodes.get(c.nodeId ?? '')?.kind === 'HelmRelease')).toBe(false);
    expect(t.cards.some((c) => c.nodeId === nodeId('apps', 'Deployment', 'cert-manager', 'cert-manager'))).toBe(true);
  });

  it('lays out 300 objects without overlap', () => {
    const big = buildEstate(raw(largeObjects(300, 30)));
    const all = new Map([...big.nodes.keys()].map((id) => [id, true]));
    const t = layoutTree(big, { ...filters, groupThreshold: 100 }, all);
    expect(t.cards.length).toBeGreaterThanOrEqual(300);
    const slots = new Set(t.cards.map((c) => `${c.depth}:${c.row}`));
    expect(slots.size).toBe(t.cards.length);
  });

  it('an empty estate lays out nothing', () => {
    expect(layoutTree(buildEstate({ lists: {} }), filters).cards).toEqual([]);
  });
});

describe('buildStages', () => {
  const estate = stagedEstate();
  it('puts Kustomizations in dependsOn order and finds what is blocked', () => {
    const v = buildStages(estate, { onlyProblems: false });
    expect(v.columns.map((c) => c.stage)).toEqual([1, 2, 3, 4, 5]);
    expect(v.columns[0]?.ids).toEqual([K('infra-crds')]);
    expect(v.blockedBy.get(K('apps'))).toBe(K('monitoring'));
    expect(v.sources).toContain(nodeId('source.toolkit.fluxcd.io', 'GitRepository', 'flux-system', 'flux-system'));
  });
  it('only problems drops healthy stages', () => {
    const v = buildStages(estate, { onlyProblems: true });
    expect(v.columns.flatMap((c) => c.ids)).not.toContain(K('infra-crds'));
    expect(v.columns.flatMap((c) => c.ids)).toContain(K('apps'));
  });
});

describe('buildSources', () => {
  it('chains a source defined by another source', () => {
    const estate = stagedEstate();
    const rows = buildSources(estate);
    const git = rows.find(
      (r) => r.id === nodeId('source.toolkit.fluxcd.io', 'GitRepository', 'flux-system', 'flux-system'),
    );
    const jetstack = rows.find(
      (r) => r.id === nodeId('source.toolkit.fluxcd.io', 'HelmRepository', 'flux-system', 'jetstack'),
    );
    expect(git?.level).toBe(0);
    expect(git?.kustomizations.length).toBeGreaterThanOrEqual(7);
    expect(git?.unhealthy).toBeGreaterThan(0);
    expect(jetstack?.level).toBe(1);
    expect(jetstack?.helmReleases).toEqual([
      nodeId('helm.toolkit.fluxcd.io', 'HelmRelease', 'cert-manager', 'cert-manager'),
    ]);
    expect(git?.creates).toContain(jetstack?.id);
  });
});

describe('buildInventory', () => {
  it('groups what a Kustomization applied by kind, with breadcrumbs', () => {
    const estate = stagedEstate();
    const v = buildInventory(estate, K('infra-configs'), childIndex(estate));
    expect(v.breadcrumbs).toEqual([K('flux-system'), K('infra-configs')]);
    expect(v.groups[0]?.kind).toBe('Namespace');
    expect(v.total).toBe(v.groups.reduce((s, g) => s + g.ids.length, 0));
  });
});

describe('buildList and sortList', () => {
  const estate = stagedEstate();
  it('lists Flux objects only, problems first when sorted by status', () => {
    const rows = buildList(estate, false);
    expect(rows.every((r) => r.kind !== 'Pod')).toBe(true);
    const sorted = sortList(rows, 'status', 1);
    expect(sorted[0]?.state).toBe('failed');
    expect(sortList(rows, 'stage', 1)[0]?.stage).toBe(1);
    expect((sortList(rows, 'name', -1)[0]?.name ?? '') >= (sortList(rows, 'name', 1)[0]?.name ?? '')).toBe(true);
  });
  it('only problems', () => {
    expect(buildList(estate, true).every((r) => ['failed', 'waiting', 'outofsync'].includes(r.state))).toBe(true);
  });
});

describe('computeKpis', () => {
  it('counts sources, Kustomizations, releases and suspended objects', () => {
    const k = computeKpis(stagedEstate());
    expect(k.kustomizations.total).toBe(7);
    expect(k.kustomizations.failing).toBeGreaterThanOrEqual(2);
    expect(k.helmReleases.failing).toBe(1);
    expect(k.suspended).toBe(1);
  });
});
