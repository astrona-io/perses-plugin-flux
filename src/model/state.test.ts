import { describe, expect, it } from 'vitest';

import {
  FLUXINSTANCE_FAILED,
  FLUXINSTANCE_READY,
  GIT_STALLED,
  HR_DRIFT_CORRECTED,
  HR_INSTALLED,
  HR_UPGRADE_FAILED,
  KS_BUILD_FAILED,
  KS_DEPENDENCY_NOT_READY,
  KS_HEALTH_FAILED_RETRY,
  KS_PROGRESSING,
  READY_TRUE,
  RESOURCESET_RECONCILING,
} from '../test/conditions';
import {
  digestOf,
  mapPodState,
  mapState,
  mapWorkloadState,
  sameRevision,
  shortRevision,
  STATE_ICON,
  STATE_LABEL,
} from './state';

describe('mapState', () => {
  it('Ready=True with the source revision applied is ready', () => {
    expect(
      mapState({
        conditions: READY_TRUE('Applied revision: main@sha1:a12f0d3'),
        appliedRevision: 'main@sha1:a12f0d3',
        sourceRevision: 'main@sha1:a12f0d3',
      }).state,
    ).toBe('ready');
  });

  it('Reconciling=True with Ready=Unknown is reconciling', () => {
    expect(mapState({ conditions: KS_PROGRESSING })).toMatchObject({ state: 'reconciling', reason: 'Progressing' });
    expect(mapState({ conditions: RESOURCESET_RECONCILING }).state).toBe('reconciling');
  });

  it('a newer source revision than lastAppliedRevision is out of sync', () => {
    const r = mapState({
      conditions: READY_TRUE('Applied revision: main@sha1:9c4e1b7'),
      appliedRevision: 'main@sha1:9c4e1b7aa',
      sourceRevision: 'main@sha1:a12f0d3bb',
    });
    expect(r.state).toBe('outofsync');
    expect(r.message).toContain('main@a12f0d3');
  });

  it('DependencyNotReady is waiting, with the message', () => {
    expect(mapState({ conditions: KS_DEPENDENCY_NOT_READY })).toEqual({
      state: 'waiting',
      reason: 'DependencyNotReady',
      message: "dependency 'flux-system/monitoring' is not ready",
    });
  });

  it('any other Ready=False is failed, also while retrying', () => {
    expect(mapState({ conditions: KS_BUILD_FAILED })).toMatchObject({ state: 'failed', reason: 'BuildFailed' });
    expect(mapState({ conditions: KS_HEALTH_FAILED_RETRY })).toMatchObject({
      state: 'failed',
      reason: 'HealthCheckFailed',
    });
    expect(mapState({ conditions: FLUXINSTANCE_FAILED })).toMatchObject({ state: 'failed', reason: 'ArtifactFailed' });
  });

  it('Stalled=True is failed with the stalled reason', () => {
    expect(mapState({ conditions: GIT_STALLED })).toMatchObject({ state: 'failed', reason: 'GitOperationFailed' });
    expect(mapState({ conditions: HR_UPGRADE_FAILED })).toMatchObject({ state: 'failed', reason: 'RetriesExceeded' });
  });

  it('suspended wins over every condition', () => {
    expect(mapState({ conditions: KS_BUILD_FAILED, suspended: true }).state).toBe('suspended');
  });

  it('reconcile disabled is its own state', () => {
    expect(mapState({ conditions: READY_TRUE('ok'), reconcileDisabled: true }).state).toBe('disabled');
  });

  it('drift corrected shows only when otherwise ready', () => {
    expect(mapState({ conditions: HR_DRIFT_CORRECTED, driftCorrected: true }).state).toBe('drift');
    expect(mapState({ conditions: HR_UPGRADE_FAILED, driftCorrected: true }).state).toBe('failed');
  });

  it('an older observedGeneration is reconciling', () => {
    expect(mapState({ conditions: FLUXINSTANCE_READY, generation: 3, observedGeneration: 2 }).state).toBe(
      'reconciling',
    );
  });

  it('no conditions is unknown', () => {
    expect(mapState({}).state).toBe('unknown');
    expect(mapState({ conditions: HR_INSTALLED }).state).toBe('ready');
  });

  it('every state has a label and an icon', () => {
    for (const s of Object.keys(STATE_LABEL)) expect(STATE_ICON[s as keyof typeof STATE_ICON]).toBeTruthy();
  });
});

describe('revisions', () => {
  it('compares by digest', () => {
    expect(sameRevision('main@sha1:abc', 'sha1:abc')).toBe(true);
    expect(sameRevision('main@sha1:abc', 'main@sha1:abd')).toBe(false);
    expect(sameRevision('6.7.1', '6.7.1')).toBe(true);
    expect(digestOf('6.7.1@sha256:aa71')).toBe('sha256:aa71');
  });

  it('shortens for cards', () => {
    expect(shortRevision('main@sha1:a12f0d3b9c1e')).toBe('main@a12f0d3');
    expect(shortRevision('sha256:51a0beefcafe')).toBe('51a0bee');
    expect(shortRevision('6.0.3')).toBe('6.0.3');
    expect(shortRevision(undefined)).toBe('');
  });
});

describe('pods and workloads', () => {
  it('CrashLoopBackOff and OOMKilled are failed, with both reasons', () => {
    const r = mapPodState({
      phase: 'Running',
      containerStatuses: [
        {
          ready: false,
          state: { waiting: { reason: 'CrashLoopBackOff' } },
          lastState: { terminated: { reason: 'OOMKilled' } },
        },
      ],
    });
    expect(r).toMatchObject({ state: 'failed', note: 'CrashLoopBackOff · OOMKilled' });
  });

  it('a running pod with ready containers is ready; pending is reconciling', () => {
    expect(mapPodState({ phase: 'Running', containerStatuses: [{ ready: true }] }).state).toBe('ready');
    expect(
      mapPodState({ phase: 'Pending', containerStatuses: [{ state: { waiting: { reason: 'ContainerCreating' } } }] })
        .state,
    ).toBe('reconciling');
    expect(mapPodState({ phase: 'Succeeded' }).state).toBe('ready');
  });

  it('replica counts', () => {
    expect(mapWorkloadState(2, 2, 2).state).toBe('ready');
    expect(mapWorkloadState(0, 0).state).toBe('ready');
    expect(mapWorkloadState(1, 0).state).toBe('failed');
    expect(mapWorkloadState(3, 1, 3).state).toBe('reconciling');
  });
});
