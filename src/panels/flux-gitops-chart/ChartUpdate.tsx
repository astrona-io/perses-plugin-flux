import { Box, CircularProgress, Tooltip } from '@mui/material';
import type { ReactElement } from 'react';

import type { ChartUpdate } from '../../model/chart-updates';
import { describeUpdate } from '../../model/chart-updates';
import { MONO } from './style';

/** `1.2.3 → 1.4.0` with whether Flux picks it up, or why it was not checked, or the read error. */
export function ChartUpdateLabel({ update }: { update: ChartUpdate }): ReactElement {
  const title = describeUpdate(update);
  switch (update.status) {
    case 'loading':
      return (
        <Box component="span" sx={{ color: 'text.secondary', display: 'inline-flex', alignItems: 'center', gap: 0.5 }}>
          <CircularProgress size={10} aria-label="Reading the repository index" /> {update.installed ?? ''}
        </Box>
      );
    case 'not-checked':
      return (
        <Tooltip title={title}>
          <Box component="span" tabIndex={0} sx={{ color: 'text.secondary', cursor: 'help' }}>
            {update.installed !== undefined ? `${update.installed} · ` : ''}not checked
          </Box>
        </Tooltip>
      );
    case 'error':
      return (
        <Tooltip title={title}>
          <Box component="span" tabIndex={0} sx={{ color: 'error.main', cursor: 'help', fontWeight: 600 }}>
            ✕ {update.failure === 'forbidden' || update.failure === 'proxy-endpoint' ? 'no access' : 'not read'}
          </Box>
        </Tooltip>
      );
    case 'current':
      return (
        <Tooltip title={title}>
          <Box component="span" tabIndex={0} sx={{ fontFamily: MONO, cursor: 'help' }}>
            {update.installed} ✓ newest
          </Box>
        </Tooltip>
      );
    default: {
      let verdict = 'range unknown';
      if (update.inRange === true) verdict = 'in range';
      else if (update.inRange === false) verdict = 'needs a bump';
      return (
        <Tooltip title={title}>
          <Box
            component="span"
            tabIndex={0}
            sx={{ fontFamily: MONO, cursor: 'help', color: update.inRange === false ? 'warning.main' : 'info.main' }}
          >
            {update.installed} → {update.latest}{' '}
            <Box component="span" sx={{ fontFamily: 'inherit', fontWeight: 600 }}>
              ({verdict})
            </Box>
          </Box>
        </Tooltip>
      );
    }
  }
}
