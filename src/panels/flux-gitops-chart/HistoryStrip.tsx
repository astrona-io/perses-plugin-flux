import { Box, Typography, useTheme } from '@mui/material';
import type { ReactElement } from 'react';
import { memo } from 'react';

import type { Estate } from '../../model/estate';
import type { History } from '../../model/history';
import { STATE_LABEL, shortRevision } from '../../model/state';
import { hatch, stateColor } from './style';

export interface HistoryStripProps {
  estate: Estate;
  history?: History;
  error?: Error;
  loading: boolean;
  onSelect: (id: string) => void;
}

function time(t: number): string {
  return new Date(t * 1000).toISOString().slice(11, 16);
}

/** Reconcile history per Kustomization: state bands over the range, ◆ where the applied revision changed. */
export const HistoryStrip = memo(function HistoryStrip({
  estate,
  history,
  error,
  loading,
  onSelect,
}: HistoryStripProps): ReactElement | null {
  const theme = useTheme();
  if (error !== undefined) {
    return (
      <Typography variant="caption" sx={{ px: 2, py: 1, display: 'block', color: 'text.secondary' }}>
        Reconcile history unavailable: {error.message}
      </Typography>
    );
  }
  if (history === undefined) {
    return loading ? (
      <Typography variant="caption" sx={{ px: 2, py: 1, display: 'block', color: 'text.secondary' }}>
        Loading reconcile history…
      </Typography>
    ) : null;
  }
  if (history.source === 'none') {
    return (
      <Typography variant="caption" sx={{ px: 2, py: 1, display: 'block', color: 'text.secondary' }}>
        No reconcile history: neither flux_resource_info (Flux Operator) nor gotk_resource_info (kube-state-metrics) is
        in Prometheus.
      </Typography>
    );
  }
  const span = Math.max(1, history.end - history.start);
  const ids = [...history.bands.keys()].sort();
  return (
    <Box component="section" aria-label="Reconcile history" sx={{ px: 2, py: 1 }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 0.5 }}>
        <Typography variant="overline" sx={{ color: 'text.secondary', lineHeight: 1.4 }}>
          Reconcile history ({history.source})
        </Typography>
        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
          {time(history.start)} – {time(history.end)} UTC
        </Typography>
      </Box>
      {ids.map((id) => {
        const n = estate.nodes.get(id);
        const name = n?.name ?? id.split('|')[3] ?? id;
        const duration = history.durations.get(id);
        return (
          <Box key={id} sx={{ display: 'flex', alignItems: 'center', gap: 1, height: 20 }}>
            <Box
              component="button"
              type="button"
              onClick={() => onSelect(id)}
              sx={{
                all: 'unset',
                cursor: 'pointer',
                width: 150,
                flex: '0 0 150px',
                fontSize: 12,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}` },
              }}
            >
              {name}
            </Box>
            <Box
              sx={{
                position: 'relative',
                flex: 1,
                height: 12,
                backgroundColor: theme.palette.action.hover,
                borderRadius: 0.5,
              }}
            >
              {(history.bands.get(id) ?? []).map((b, i) => (
                <Box
                  key={i}
                  title={`${STATE_LABEL[b.state]} ${time(b.start)}–${time(b.end)}`}
                  sx={{
                    position: 'absolute',
                    top: 0,
                    bottom: 0,
                    left: `${((b.start - history.start) / span) * 100}%`,
                    width: `${Math.max(0.3, ((b.end - b.start) / span) * 100)}%`,
                    backgroundColor: stateColor(theme, b.state),
                    backgroundImage: b.state === 'failed' ? hatch(theme) : undefined,
                    opacity: b.state === 'ready' ? 0.55 : 0.95,
                  }}
                />
              ))}
              {(history.marks.get(id) ?? []).map((m, i) => (
                <Box
                  key={`m${i}`}
                  title={`revision ${shortRevision(m.revision)} at ${time(m.t)}`}
                  aria-label={`revision ${shortRevision(m.revision)}`}
                  sx={{
                    position: 'absolute',
                    top: -4,
                    left: `calc(${((m.t - history.start) / span) * 100}% - 5px)`,
                    fontSize: 11,
                    lineHeight: '18px',
                    color: theme.palette.text.primary,
                  }}
                >
                  ◆
                </Box>
              ))}
            </Box>
            <Typography variant="caption" sx={{ width: 56, textAlign: 'right', color: 'text.secondary' }}>
              {duration === undefined ? '' : `${duration.toFixed(1)}s`}
            </Typography>
          </Box>
        );
      })}
    </Box>
  );
});
