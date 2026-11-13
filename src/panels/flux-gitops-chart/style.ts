// Colours, icons and motion for states and kinds. Colours come from the MUI theme only, so light and
// dark both work; every state also has an icon and a label (STATE_ICON, STATE_LABEL).

import type { Theme } from '@mui/material';
import { alpha, keyframes } from '@mui/material';

import type { FluxState } from '../../model/state';

export function stateColor(theme: Theme, state: FluxState): string {
  const p = theme.palette;
  switch (state) {
    case 'ready':
      return p.success.main;
    case 'reconciling':
      return p.info.main;
    case 'outofsync':
    case 'drift':
    case 'waiting':
      return p.warning.main;
    case 'failed':
      return p.error.main;
    case 'suspended':
      return p.secondary.main;
    default:
      return p.text.disabled;
  }
}

export const KIND_ABBREV: Record<string, string> = {
  FluxInstance: 'FI',
  FluxReport: 'FR',
  ResourceSet: 'RSet',
  ResourceSetInputProvider: 'RSIP',
  GitRepository: 'GIT',
  OCIRepository: 'OCI',
  HelmRepository: 'HELM',
  HelmChart: 'HC',
  Bucket: 'S3',
  Kustomization: 'KS',
  HelmRelease: '⎈',
  Namespace: 'NS',
  CustomResourceDefinition: 'CRD',
  Deployment: 'DEP',
  StatefulSet: 'STS',
  DaemonSet: 'DS',
  ReplicaSet: 'RS',
  Pod: 'POD',
  Service: 'SVC',
  PersistentVolumeClaim: 'PVC',
  ConfigMap: 'CM',
  Secret: 'SEC',
  ServiceAccount: 'SA',
  NetworkPolicy: 'NP',
  ClusterIssuer: 'CI',
  ServiceMonitor: 'SM',
  Prometheus: 'PROM',
  Ingress: 'ING',
  ClusterRole: 'CR',
  ClusterRoleBinding: 'CRB',
  Role: 'R',
  RoleBinding: 'RB',
};

export function kindAbbrev(kind: string): string {
  return KIND_ABBREV[kind] ?? kind.replace(/[a-z]/g, '').slice(0, 4);
}

/** English plural of a kind for group labels: NetworkPolicies, Ingresses, Gateways. */
export function kindPlural(kind: string): string {
  if (/[^aeiou]y$/i.test(kind)) return `${kind.slice(0, -1)}ies`;
  if (/(s|x|z|ch|sh)$/i.test(kind)) return `${kind}es`;
  return `${kind}s`;
}

const pulse = keyframes`
  0%, 100% { box-shadow: 0 0 0 0 var(--flux-halo); }
  50% { box-shadow: 0 0 0 5px var(--flux-halo); }
`;
const fade = keyframes`
  0%, 100% { opacity: 1; }
  50% { opacity: 0.55; }
`;
const spin = keyframes`
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
`;
export const flow = keyframes`
  to { stroke-dashoffset: -20; }
`;

export const REDUCED_MOTION = '@media (prefers-reduced-motion: reduce)';

/** Card motion per state: halo pulses, fading waits, a spinning icon. All off under reduced motion. */
export function stateMotion(theme: Theme, state: FluxState): Record<string, unknown> {
  const halo = alpha(stateColor(theme, state), 0.35);
  const base = { '--flux-halo': halo, [REDUCED_MOTION]: { animation: 'none', '& .flux-spin': { animation: 'none' } } };
  switch (state) {
    case 'failed':
      return { ...base, animation: `${pulse} 2.4s ease-in-out infinite` };
    case 'outofsync':
      return { ...base, animation: `${pulse} 1.6s ease-in-out infinite` };
    case 'reconciling':
      return {
        ...base,
        boxShadow: `0 0 0 3px ${halo}`,
        '& .flux-spin': { display: 'inline-block', animation: `${spin} 1.6s linear infinite` },
      };
    case 'waiting':
      return { ...base, animation: `${fade} 3s ease-in-out infinite` };
    default:
      return base;
  }
}

/** Diagonal hatch for objects that would be deleted. */
export function hatch(theme: Theme): string {
  const c = alpha(theme.palette.error.main, 0.22);
  return `repeating-linear-gradient(135deg, ${c} 0 6px, transparent 6px 12px)`;
}

export const MONO = 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace';
