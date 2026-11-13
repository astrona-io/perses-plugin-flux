// Maps a Flux (or Flux Operator) object's conditions, spec and revisions to one display state.
// Pure and side-effect free: everything it needs comes in through the input.

import type { Condition } from './kube';

export type FluxState =
  | 'ready'
  | 'reconciling'
  | 'outofsync'
  | 'waiting'
  | 'failed'
  | 'suspended'
  | 'drift'
  | 'disabled'
  | 'unknown';

export interface StateInput {
  conditions?: Condition[];
  /** `spec.suspend` (Flux), or the Flux Operator's reconcile annotation set to disabled. */
  suspended?: boolean;
  /** The object's `metadata.generation` and `status.observedGeneration`. */
  generation?: number;
  observedGeneration?: number;
  /** What the object last applied (Kustomization `lastAppliedRevision`, HelmRelease chart version...). */
  appliedRevision?: string;
  /** What its source offers now (the source's `status.artifact.revision`). */
  sourceRevision?: string;
  /** True when drift was detected and corrected recently (HelmRelease events). */
  driftCorrected?: boolean;
  /** `kustomize.toolkit.fluxcd.io/reconcile: disabled` on a plain object. */
  reconcileDisabled?: boolean;
}

export interface StateResult {
  state: FluxState;
  /** The Flux reason (e.g. DependencyNotReady), if any. */
  reason?: string;
  /** The condition message, for failures and waits. */
  message?: string;
}

/** Text shown next to every state icon; the panel never relies on colour alone. */
export const STATE_LABEL: Record<FluxState, string> = {
  ready: 'Ready',
  reconciling: 'Reconciling',
  outofsync: 'Out of sync',
  waiting: 'Waiting',
  failed: 'Failed',
  suspended: 'Suspended',
  drift: 'Drift corrected',
  disabled: 'Reconcile disabled',
  unknown: 'Unknown',
};

export const STATE_ICON: Record<FluxState, string> = {
  ready: '✓',
  reconciling: '⟳',
  outofsync: '↻',
  waiting: '◔',
  failed: '✕',
  suspended: '⏸',
  drift: '≠',
  disabled: '⦸',
  unknown: '?',
};

/** Problems sort first and stay expanded in the tree. */
export const STATE_SEVERITY: Record<FluxState, number> = {
  failed: 6,
  waiting: 5,
  outofsync: 4,
  reconciling: 3,
  drift: 2,
  suspended: 1,
  disabled: 1,
  unknown: 1,
  ready: 0,
};

export function isProblem(state: FluxState): boolean {
  return state === 'failed' || state === 'waiting' || state === 'outofsync';
}

/** Reasons that mean "not ready because something else is not ready yet". */
const WAITING_REASONS = new Set(['DependencyNotReady', 'DependencyNotFound']);

/** Reasons that mean "still working on it", not a failure. */
const PROGRESSING_REASONS = new Set(['Progressing', 'ProgressingWithRetry']);

/**
 * Revisions as Flux writes them: `main@sha1:<hex>`, `6.7.1@sha256:<hex>`, `sha256:<hex>` or a plain
 * chart version. Two revisions are the same when their digests match, or (without a digest) when
 * the strings are equal.
 */
export function sameRevision(a: string, b: string): boolean {
  if (a === b) return true;
  const da = digestOf(a);
  const db = digestOf(b);
  if (da !== undefined && db !== undefined) return da === db;
  return false;
}

export function digestOf(revision: string): string | undefined {
  const m = /(sha1|sha256|sha384|sha512|blake3):([0-9a-f]+)$/.exec(revision);
  return m === null ? undefined : `${m[1]}:${m[2]}`;
}

/** A short form for cards: `main@a12f0d3`, `6.7.1@aa71b2c`. */
export function shortRevision(revision: string | undefined): string {
  if (revision === undefined || revision === '') return '';
  const m = /^(?:(.*)@)?(?:sha1|sha256|sha384|sha512|blake3):([0-9a-f]+)$/.exec(revision);
  if (m === null) return revision;
  const ref = m[1] ?? '';
  const hex = (m[2] ?? '').slice(0, 7);
  return ref === '' ? hex : `${ref}@${hex}`;
}

/**
 * The display state of a Flux object.
 *
 * Order matters: a suspended object is shown as suspended whatever its last conditions say, a
 * stalled one as failed, then the Ready condition decides, and a Ready object whose source has
 * moved on is out of sync.
 */
export function mapState(input: StateInput): StateResult {
  if (input.suspended === true) return { state: 'suspended' };
  if (input.reconcileDisabled === true) return { state: 'disabled' };

  const conditions = input.conditions ?? [];
  const ready = conditions.find((c) => c.type === 'Ready');
  const stalled = conditions.find((c) => c.type === 'Stalled' && c.status === 'True');
  const reconciling = conditions.find((c) => c.type === 'Reconciling' && c.status === 'True');

  if (stalled !== undefined) {
    return { state: 'failed', reason: stalled.reason ?? ready?.reason, message: stalled.message ?? ready?.message };
  }

  if (ready === undefined) {
    // Flux sets Ready as soon as it starts; no Ready yet means the controller has not seen it.
    if (reconciling !== undefined)
      return { state: 'reconciling', reason: reconciling.reason, message: reconciling.message };
    return { state: 'unknown' };
  }

  if (ready.status === 'False') {
    if (ready.reason !== undefined && WAITING_REASONS.has(ready.reason)) {
      return { state: 'waiting', reason: ready.reason, message: ready.message };
    }
    if (reconciling !== undefined && ready.reason !== undefined && PROGRESSING_REASONS.has(ready.reason)) {
      return { state: 'reconciling', reason: ready.reason, message: ready.message };
    }
    return { state: 'failed', reason: ready.reason, message: ready.message };
  }

  if (ready.status !== 'True' || reconciling !== undefined) {
    return { state: 'reconciling', reason: (reconciling ?? ready).reason, message: (reconciling ?? ready).message };
  }

  // Ready=True from an older generation: the controller has not caught up with the new spec.
  if (
    input.generation !== undefined &&
    input.observedGeneration !== undefined &&
    input.observedGeneration < input.generation
  ) {
    return { state: 'reconciling', reason: 'NewGeneration', message: 'The spec changed; waiting for the controller' };
  }

  if (
    input.appliedRevision !== undefined &&
    input.sourceRevision !== undefined &&
    !sameRevision(input.appliedRevision, input.sourceRevision)
  ) {
    return {
      state: 'outofsync',
      reason: 'NewRevision',
      message: `Source has ${shortRevision(input.sourceRevision)}, applied ${shortRevision(input.appliedRevision)}`,
    };
  }

  if (input.driftCorrected === true) return { state: 'drift', reason: ready.reason, message: ready.message };

  return { state: 'ready', reason: ready.reason, message: ready.message };
}

/** Pod health from phase and container states (CrashLoopBackOff, OOMKilled, ImagePullBackOff...). */
export interface PodStatusInput {
  phase?: string;
  containerStatuses?: Array<{
    ready?: boolean;
    restartCount?: number;
    state?: { waiting?: { reason?: string; message?: string }; terminated?: { reason?: string } };
    lastState?: { terminated?: { reason?: string } };
  }>;
}

export function mapPodState(pod: PodStatusInput): StateResult & { note?: string } {
  const statuses = pod.containerStatuses ?? [];
  const reasons: string[] = [];
  for (const cs of statuses) {
    const waiting = cs.state?.waiting?.reason;
    if (waiting !== undefined && waiting !== 'ContainerCreating' && waiting !== 'PodInitializing')
      reasons.push(waiting);
    const terminated = cs.state?.terminated?.reason ?? cs.lastState?.terminated?.reason;
    if (terminated !== undefined && terminated !== 'Completed') reasons.push(terminated);
  }
  const unique = [...new Set(reasons)];
  if (pod.phase === 'Failed' || unique.length > 0) {
    const note = unique.join(' · ') || 'Failed';
    return { state: 'failed', reason: unique[0] ?? 'Failed', message: note, note };
  }
  if (pod.phase === 'Succeeded') return { state: 'ready', note: 'Completed' };
  if (pod.phase === 'Running' && statuses.every((cs) => cs.ready === true)) return { state: 'ready', note: 'Running' };
  return { state: 'reconciling', note: pod.phase ?? 'Pending' };
}

/** Workload health from replica counts. */
export function mapWorkloadState(desired: number, ready: number, updated?: number): StateResult {
  if (desired === 0) return { state: 'ready', message: 'Scaled to zero' };
  if (ready >= desired && (updated === undefined || updated >= desired)) return { state: 'ready' };
  if (ready === 0) return { state: 'failed', reason: 'Unavailable', message: `0/${desired} ready` };
  return { state: 'reconciling', reason: 'Progressing', message: `${ready}/${desired} ready` };
}
