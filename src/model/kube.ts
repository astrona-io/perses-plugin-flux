// Raw Kubernetes and Flux object shapes, as the API server returns them. Only the fields the panel
// reads are typed; everything is optional because a missing field must never crash the panel.

export interface ObjectMeta {
  name?: string;
  namespace?: string;
  uid?: string;
  generation?: number;
  creationTimestamp?: string;
  deletionTimestamp?: string;
  labels?: Record<string, string>;
  annotations?: Record<string, string>;
  ownerReferences?: OwnerReference[];
}

export interface OwnerReference {
  apiVersion: string;
  kind: string;
  name: string;
  uid?: string;
  controller?: boolean;
}

export interface Condition {
  type: string;
  status: 'True' | 'False' | 'Unknown' | string;
  reason?: string;
  message?: string;
  lastTransitionTime?: string;
  observedGeneration?: number;
}

export interface KubeObject {
  apiVersion?: string;
  kind?: string;
  metadata?: ObjectMeta;
  spec?: Record<string, unknown>;
  status?: Record<string, unknown> & { conditions?: Condition[]; observedGeneration?: number };
}

/** A namespaced reference as Flux writes it (sourceRef, dependsOn, chartRef...). */
export interface CrossRef {
  kind?: string;
  name: string;
  namespace?: string;
  apiVersion?: string;
}

export interface KubeEvent {
  metadata?: ObjectMeta;
  involvedObject?: { kind?: string; name?: string; namespace?: string; apiVersion?: string; uid?: string };
  reason?: string;
  message?: string;
  type?: string;
  count?: number;
  firstTimestamp?: string;
  lastTimestamp?: string;
  eventTime?: string;
  series?: { lastObservedTime?: string; count?: number };
}

export function groupOf(apiVersion: string | undefined): string {
  if (apiVersion === undefined || !apiVersion.includes('/')) return '';
  return apiVersion.slice(0, apiVersion.indexOf('/'));
}

export function conditionOf(obj: KubeObject, type: string): Condition | undefined {
  return obj.status?.conditions?.find((c) => c.type === type);
}

export function str(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

export function num(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function rec(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

export function arr(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}
