import type { Theme } from '@mui/material';
import { Box, Typography, alpha, useTheme } from '@mui/material';
import type { ReactElement } from 'react';
import { memo } from 'react';

import type { EstateNode } from '../../model/estate';
import type { FluxState } from '../../model/state';
import { STATE_ICON, STATE_LABEL } from '../../model/state';
import type { GroupSummary } from '../../model/views';
import { MONO, hatch, kindAbbrev, kindPlural, stateColor, stateMotion } from './style';

export type Overlay = 'target' | 'deleted' | 'failing' | 'losing' | 'kept';

export const OVERLAY_LABEL: Record<Overlay, string> = {
  target: '✕ deleting this',
  deleted: '✕ will be deleted',
  failing: '⚠ will fail',
  losing: '⚠ loses objects',
  kept: '🛡 kept',
};

export const CARD_W = 250;
export const CARD_H = 56;

export interface CardGroup {
  /** Undefined for the leaves box, which mixes kinds. */
  kind?: string;
  count: number;
  state: FluxState;
  kinds: Array<{ kind: string; count: number }>;
  summary: GroupSummary;
}

/** "13 ready, 2 failing, 1 suspended": the parts that are not zero. */
export function summaryText(s: GroupSummary): string {
  const parts: string[] = [];
  if (s.ready > 0) parts.push(`${s.ready} ready`);
  if (s.failing > 0) parts.push(`${s.failing} failing`);
  if (s.suspended > 0) parts.push(`${s.suspended} suspended`);
  if (s.other > 0) parts.push(`${s.other} other`);
  return parts.join(', ');
}

export function groupName(group: Pick<CardGroup, 'kind' | 'count'>): string {
  if (group.kind === undefined) return `${group.count} ${group.count === 1 ? 'resource' : 'resources'}`;
  return `${group.count} ${group.count === 1 ? group.kind : kindPlural(group.kind)}`;
}

export interface NodeCardProps {
  /** One object, or a group ("15 Kustomizations", or a parent's leaves: "12 resources"). */
  node?: EstateNode;
  group?: CardGroup;
  note?: string;
  selected?: boolean;
  overlay?: Overlay;
  /** +N / − control. */
  toggle?: { expanded: boolean; hidden: number; worst?: FluxState; onToggle: () => void };
  /** Where the +N / − control sits: on the right edge (left-to-right tree) or the bottom edge (top-to-bottom). */
  toggleSide?: 'right' | 'bottom';
  onSelect?: () => void;
  /** Clicking the card drills into it (shown as a chevron); the details then open from `onDetails`. */
  drill?: boolean;
  /** An ⓘ button that opens the details drawer. */
  onDetails?: () => void;
  width?: number;
}

function overlayColorOf(theme: Theme, overlay: Overlay | undefined): string | undefined {
  if (overlay === undefined) return undefined;
  if (overlay === 'deleted' || overlay === 'target') return theme.palette.error.main;
  if (overlay === 'kept') return theme.palette.success.main;
  return theme.palette.warning.main;
}

/** A tree card: round kind badge, name, state icon and label, a note, the kind tag. Memoised: hover never re-renders it. */
export const NodeCard = memo(function NodeCard(props: NodeCardProps): ReactElement {
  const {
    node,
    group,
    note,
    selected,
    overlay,
    toggle,
    toggleSide = 'right',
    onSelect,
    drill,
    onDetails,
    width = CARD_W,
  } = props;
  const theme = useTheme();
  const kind = node?.kind ?? group?.kind ?? '';
  const state: FluxState = node?.state ?? group?.state ?? 'unknown';
  const color = stateColor(theme, state);
  let name = '';
  if (node !== undefined) name = node.name;
  else if (group !== undefined) name = groupName(group);
  let badgeSize = 11;
  if (kind === 'HelmRelease') badgeSize = 18;
  else if (group !== undefined && group.kind === undefined) badgeSize = 13;
  const dashed = state === 'disabled' || node?.live === false || group !== undefined;
  const overlayColor = overlayColorOf(theme, overlay);
  let borderColor = alpha(color, state === 'ready' ? 0.4 : 0.9);
  if (selected) borderColor = theme.palette.primary.main;
  if (overlayColor !== undefined) borderColor = overlayColor;
  const label =
    group !== undefined
      ? `${name}: ${summaryText(group.summary)}`
      : `${kind} ${node?.namespace ? `${node.namespace}/` : ''}${name}: ${STATE_LABEL[state]}${node?.reason ? ` (${node.reason})` : ''}${
          overlay ? `, ${OVERLAY_LABEL[overlay].slice(2)}` : ''
        }`;
  const where = node === undefined ? name : `${node.namespace ? `${node.namespace}/` : ''}${node.name} (${kind})`;

  return (
    <Box sx={{ position: 'relative', width, height: CARD_H }}>
      <Box
        component="button"
        type="button"
        aria-label={drill ? `${label}, open its page` : label}
        aria-pressed={selected}
        title={node?.message ?? label}
        onClick={onSelect}
        sx={{
          position: 'relative',
          font: 'inherit',
          color: 'inherit',
          textAlign: 'left',
          width,
          height: CARD_H,
          boxSizing: 'border-box',
          display: 'flex',
          alignItems: 'center',
          gap: 1,
          pl: 0.5,
          pr: onDetails !== undefined ? 3.5 : 1.5,
          borderRadius: 1.5,
          cursor: 'pointer',
          border: `${selected ? 2 : 1}px ${dashed ? 'dashed' : 'solid'} ${borderColor}`,
          backgroundColor: theme.palette.background.paper,
          backgroundImage: overlay === 'deleted' || overlay === 'target' ? hatch(theme) : undefined,
          opacity: node?.live === false ? 0.85 : 1,
          '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
          ...stateMotion(theme, state),
        }}
      >
        <Box
          aria-hidden
          sx={{
            flex: '0 0 auto',
            width: 40,
            height: 40,
            borderRadius: '50%',
            display: 'grid',
            placeItems: 'center',
            fontFamily: MONO,
            fontSize: badgeSize,
            fontWeight: 700,
            color: theme.palette.text.secondary,
            border: `1px solid ${theme.palette.divider}`,
            backgroundColor: theme.palette.action.hover,
          }}
        >
          {group !== undefined && group.kind === undefined ? group.count : kindAbbrev(kind)}
        </Box>
        {group !== undefined ? (
          <GroupBody group={group} name={name} />
        ) : (
          <Box sx={{ minWidth: 0, flex: 1 }}>
            <Typography variant="body2" noWrap sx={{ fontWeight: 600, lineHeight: 1.3 }}>
              {name}
              {node?.protected === true && (
                <Box
                  component="span"
                  title="prune: disabled (protected)"
                  aria-label="protected"
                  sx={{ ml: 0.5, color: theme.palette.success.main }}
                >
                  🛡
                </Box>
              )}
            </Typography>
            <Typography
              variant="caption"
              noWrap
              component="div"
              sx={{ color: theme.palette.text.secondary, lineHeight: 1.3 }}
            >
              <Box component="span" sx={{ color, fontWeight: 600 }}>
                <span className={state === 'reconciling' ? 'flux-spin' : undefined}>{STATE_ICON[state]}</span>{' '}
                {STATE_LABEL[state]}
              </Box>
              {note ? ` · ${note}` : ''}
            </Typography>
          </Box>
        )}
        <Typography
          aria-hidden
          sx={{
            position: 'absolute',
            right: 6,
            bottom: -8,
            px: 0.5,
            fontFamily: MONO,
            fontSize: 10,
            lineHeight: '14px',
            color: theme.palette.text.secondary,
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            borderRadius: 0.5,
          }}
        >
          {group !== undefined ? 'group' : kind.toLowerCase()}
        </Typography>
        {overlay !== undefined && (
          <Typography
            sx={{
              position: 'absolute',
              left: '50%',
              top: -9,
              transform: 'translateX(-50%)',
              px: 0.75,
              fontSize: 10,
              fontWeight: 700,
              lineHeight: '16px',
              whiteSpace: 'nowrap',
              borderRadius: 1,
              color: theme.palette.getContrastText(overlayColor ?? theme.palette.error.main),
              backgroundColor: overlayColor,
            }}
          >
            {OVERLAY_LABEL[overlay]}
          </Typography>
        )}
        {drill && (
          <Typography
            aria-hidden
            sx={{
              position: 'absolute',
              right: onDetails !== undefined ? 9 : 6,
              top: onDetails !== undefined ? 26 : 16,
              fontSize: 18,
              lineHeight: '18px',
              fontWeight: 700,
              color: theme.palette.text.secondary,
            }}
          >
            ›
          </Typography>
        )}
      </Box>
      {onDetails !== undefined && (
        <Box
          component="button"
          type="button"
          aria-label={`Details of ${where}`}
          title="Details"
          onClick={(e) => {
            e.stopPropagation();
            onDetails();
          }}
          sx={{
            position: 'absolute',
            right: 5,
            top: 5,
            width: 20,
            height: 20,
            p: 0,
            display: 'grid',
            placeItems: 'center',
            borderRadius: '50%',
            fontFamily: 'Georgia, serif',
            fontStyle: 'italic',
            fontSize: 12,
            fontWeight: 700,
            lineHeight: 1,
            cursor: 'pointer',
            color: theme.palette.text.secondary,
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            '&:hover': { color: theme.palette.primary.main, borderColor: theme.palette.primary.main },
            '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 1 },
          }}
        >
          i
        </Box>
      )}
      {toggle !== undefined && (
        <Box
          component="button"
          type="button"
          aria-label={toggle.expanded ? `Collapse ${name}` : `Expand ${name}: ${toggle.hidden} more`}
          aria-expanded={toggle.expanded}
          onClick={(e) => {
            e.stopPropagation();
            toggle.onToggle();
          }}
          sx={{
            position: 'absolute',
            ...(toggleSide === 'bottom'
              ? { left: '50%', bottom: -11, transform: 'translateX(-50%)' }
              : { right: -13, top: '50%', transform: 'translateY(-50%)' }),
            minWidth: 26,
            height: 22,
            px: 0.5,
            borderRadius: 11,
            fontSize: 11,
            fontWeight: 700,
            cursor: 'pointer',
            color:
              toggle.worst !== undefined && !toggle.expanded
                ? stateColor(theme, toggle.worst)
                : theme.palette.text.secondary,
            backgroundColor: theme.palette.background.paper,
            border: `1px solid ${theme.palette.divider}`,
            '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}` },
          }}
        >
          {toggle.expanded ? '−' : `+${toggle.hidden}`}
        </Box>
      )}
    </Box>
  );
});

/** Most kind chips a leaves box shows before "+N". */
const MAX_CHIPS = 4;

/** A group card's text: its name, then the state counts (same-kind group) or kind chips (leaves box). */
function GroupBody({ group, name }: { group: CardGroup; name: string }): ReactElement {
  const theme = useTheme();
  const { summary } = group;
  const counts: Array<{ state: FluxState; n: number; word: string }> = [
    { state: 'ready', n: summary.ready, word: 'ready' },
    { state: summary.worst === 'ready' ? 'failed' : summary.worst, n: summary.failing, word: 'failing' },
    { state: 'suspended', n: summary.suspended, word: 'suspended' },
  ].filter((c) => c.n > 0) as Array<{ state: FluxState; n: number; word: string }>;
  const chips = group.kinds.slice(0, MAX_CHIPS);
  const more = group.kinds.length - chips.length;
  return (
    <Box sx={{ minWidth: 0, flex: 1 }}>
      <Typography variant="body2" noWrap sx={{ fontWeight: 600, lineHeight: 1.3 }}>
        {name}
        {group.kind === undefined &&
          counts.map((c) => (
            <Box
              component="span"
              key={c.state}
              sx={{ ml: 0.75, fontWeight: 600, fontSize: 12, color: stateColor(theme, c.state) }}
            >
              {STATE_ICON[c.state]} {c.n}
            </Box>
          ))}
      </Typography>
      {group.kind !== undefined ? (
        <Typography variant="caption" noWrap component="div" sx={{ lineHeight: 1.3 }}>
          {counts.map((c, i) => (
            <Box component="span" key={c.state} sx={{ color: stateColor(theme, c.state), fontWeight: 600 }}>
              {i > 0 ? ' · ' : ''}
              {STATE_ICON[c.state]} {c.n} {c.word}
            </Box>
          ))}
        </Typography>
      ) : (
        <Box sx={{ display: 'flex', gap: 0.5, mt: 0.25, overflow: 'hidden', whiteSpace: 'nowrap' }}>
          {chips.map((c) => (
            <Box
              component="span"
              key={c.kind}
              title={`${c.count} ${c.count === 1 ? c.kind : kindPlural(c.kind)}`}
              sx={{
                flex: '0 0 auto',
                px: 0.5,
                fontFamily: MONO,
                fontSize: 10,
                lineHeight: '15px',
                borderRadius: 0.5,
                color: theme.palette.text.secondary,
                backgroundColor: theme.palette.action.hover,
                border: `1px solid ${theme.palette.divider}`,
              }}
            >
              {kindAbbrev(c.kind)} {c.count}
            </Box>
          ))}
          {more > 0 && (
            <Box component="span" sx={{ fontSize: 10, lineHeight: '17px', color: theme.palette.text.secondary }}>
              +{more}
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}
