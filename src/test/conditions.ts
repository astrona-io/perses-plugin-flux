// Condition sets as the Flux controllers and the Flux Operator write them. Types, reasons and
// message formats follow fluxcd/pkg/apis/meta, the controllers' API docs and objects read from the
// dev stack (Flux v2.10.0, Flux Operator v0.62.1).

import type { Condition } from '../model/kube';

const T = '2026-11-12T09:00:00Z';

export const READY_TRUE = (message: string): Condition[] => [
  { type: 'Ready', status: 'True', reason: 'ReconciliationSucceeded', message, lastTransitionTime: T },
];

/** kustomize-controller, reconciliation started on a new revision. */
export const KS_PROGRESSING: Condition[] = [
  {
    type: 'Reconciling',
    status: 'True',
    reason: 'Progressing',
    message: "Fetching manifests for revision 'main@sha1:b81d0aa' with a timeout of 4m30s",
  },
  { type: 'Ready', status: 'Unknown', reason: 'Progressing', message: 'Reconciliation in progress' },
];

/** kustomize-controller, health checks failing, being retried. */
export const KS_HEALTH_FAILED_RETRY: Condition[] = [
  {
    type: 'Reconciling',
    status: 'True',
    reason: 'ProgressingWithRetry',
    message: 'Detecting drift for revision main@sha1:9c4e1b7 with a timeout of 4m30s',
  },
  {
    type: 'Ready',
    status: 'False',
    reason: 'HealthCheckFailed',
    message: "health check failed after 5m0s: timeout waiting for: [Deployment/apps/podinfo status: 'InProgress']",
  },
  { type: 'Healthy', status: 'False', reason: 'HealthCheckFailed', message: 'health check failed' },
];

/** kustomize-controller, invalid kustomization.yaml. */
export const KS_BUILD_FAILED: Condition[] = [
  {
    type: 'Ready',
    status: 'False',
    reason: 'BuildFailed',
    message:
      "kustomize build failed: accumulating resources: accumulation err='accumulating resources from './missing.yaml'",
  },
];

/** kustomize-controller, waiting on dependsOn. */
export const KS_DEPENDENCY_NOT_READY: Condition[] = [
  {
    type: 'Ready',
    status: 'False',
    reason: 'DependencyNotReady',
    message: "dependency 'flux-system/monitoring' is not ready",
  },
];

/** source-controller, a Git ref that does not exist: Stalled. */
export const GIT_STALLED: Condition[] = [
  {
    type: 'Stalled',
    status: 'True',
    reason: 'GitOperationFailed',
    message:
      "failed to checkout and determine revision: unable to clone 'https://github.com/example/missing': repository not found",
  },
  {
    type: 'Ready',
    status: 'False',
    reason: 'GitOperationFailed',
    message:
      "failed to checkout and determine revision: unable to clone 'https://github.com/example/missing': repository not found",
  },
  { type: 'FetchFailed', status: 'True', reason: 'GitOperationFailed', message: 'repository not found' },
];

/** helm-controller v2, an upgrade that timed out and ran out of retries. */
export const HR_UPGRADE_FAILED: Condition[] = [
  { type: 'Stalled', status: 'True', reason: 'RetriesExceeded', message: 'Failed to upgrade after 1 attempt(s)' },
  {
    type: 'Ready',
    status: 'False',
    reason: 'UpgradeFailed',
    message:
      'Helm upgrade failed for release monitoring/kube-prometheus-stack with chart kube-prometheus-stack@67.0.0: context deadline exceeded',
  },
  {
    type: 'Released',
    status: 'False',
    reason: 'UpgradeFailed',
    message:
      'Helm upgrade failed for release monitoring/kube-prometheus-stack with chart kube-prometheus-stack@67.0.0: context deadline exceeded',
  },
];

/** helm-controller v2, drift detected (helm-controller 1.6+ sets Drifted; after a correction it goes back to False). */
export const HR_DRIFT_CORRECTED: Condition[] = [
  {
    type: 'Ready',
    status: 'True',
    reason: 'UpgradeSucceeded',
    message: 'Helm upgrade succeeded for release cert-manager/cert-manager.v3 with chart cert-manager@v1.16.2',
  },
  { type: 'Released', status: 'True', reason: 'UpgradeSucceeded', message: 'Helm upgrade succeeded' },
  {
    type: 'Drifted',
    status: 'True',
    reason: 'DriftDetected',
    message: 'Cluster state of release cert-manager/cert-manager.v3 has drifted from the desired state',
  },
];

/** helm-controller v2 (Flux v2.10.0), right after correcting drift: the condition is clear, the events are not. */
export const HR_DRIFT_CLEARED: Condition[] = [
  {
    type: 'Ready',
    status: 'True',
    reason: 'InstallSucceeded',
    message: 'Helm install succeeded for release widget-system/widget-controller.v1 with chart podinfo@6.7.1',
  },
  {
    type: 'Drifted',
    status: 'False',
    reason: 'NoDriftDetected',
    message: 'No drift detected against the cluster state',
  },
  {
    type: 'Released',
    status: 'True',
    reason: 'InstallSucceeded',
    message: 'Helm install succeeded for release widget-system/widget-controller.v1 with chart podinfo@6.7.1',
  },
];

/** helm-controller v2, installed. */
export const HR_INSTALLED: Condition[] = [
  {
    type: 'Ready',
    status: 'True',
    reason: 'InstallSucceeded',
    message: 'Helm install succeeded for release apps/podinfo.v1 with chart podinfo@6.7.1',
  },
  {
    type: 'Released',
    status: 'True',
    reason: 'InstallSucceeded',
    message: 'Helm install succeeded for release apps/podinfo.v1 with chart podinfo@6.7.1',
  },
];

/** Flux Operator, FluxInstance reconciled. */
export const FLUXINSTANCE_READY: Condition[] = [
  { type: 'Ready', status: 'True', reason: 'ReconciliationSucceeded', message: 'Reconciliation finished in 4s' },
];

/** Flux Operator, FluxInstance with a distribution version that does not exist. */
export const FLUXINSTANCE_FAILED: Condition[] = [
  {
    type: 'Ready',
    status: 'False',
    reason: 'ArtifactFailed',
    message: 'fetching distribution manifests failed: no match found for semver: 9.x',
  },
];

/** Flux Operator, ResourceSet waiting on its input provider. */
export const RESOURCESET_RECONCILING: Condition[] = [
  { type: 'Reconciling', status: 'True', reason: 'Progressing', message: 'Reconciliation in progress' },
  { type: 'Ready', status: 'Unknown', reason: 'Progressing', message: 'Reconciliation in progress' },
];
