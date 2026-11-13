import { Box, useTheme } from '@mui/material';
import type { ReactElement } from 'react';
import { useMemo } from 'react';

import type { Estate } from '../../model/estate';
import type { TreeLayout } from '../../model/views';
import { CARD_H, CARD_W, NodeCard } from './NodeCard';
import type { Overlay } from './NodeCard';
import { REDUCED_MOTION, flow } from './style';

export const COL_W = 330;
export const ROW_H = 74;
const PAD = 16;

export interface TreeViewProps {
  estate: Estate;
  layout: TreeLayout;
  selected?: string;
  overlays?: Map<string, Overlay>;
  onSelect: (id: string) => void;
  onToggle: (key: string, expanded: boolean) => void;
}

/** The resource tree: absolutely placed cards and dashed SVG connectors, drawn at real size inside a scroll box. */
export function TreeView({ estate, layout, selected, overlays, onSelect, onToggle }: TreeViewProps): ReactElement {
  const theme = useTheme();
  const byKey = useMemo(() => new Map(layout.cards.map((c) => [c.key, c])), [layout]);
  const width = PAD * 2 + layout.depth * COL_W + CARD_W + 16;
  const height = PAD * 2 + Math.max(1, layout.rows) * ROW_H;
  const x = (depth: number): number => PAD + depth * COL_W;
  const y = (row: number): number => PAD + row * ROW_H;

  return (
    <Box sx={{ position: 'relative', width, height, minWidth: '100%' }} role="tree" aria-label="Flux resource tree">
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden>
        {layout.edges.map((e) => {
          const from = byKey.get(e.from);
          const to = byKey.get(e.to);
          if (from === undefined || to === undefined) return null;
          const x1 = x(from.depth) + CARD_W;
          const y1 = y(from.row) + CARD_H / 2;
          const x2 = x(to.depth);
          const y2 = y(to.row) + CARD_H / 2;
          const mid = (x1 + x2) / 2;
          const reconciling = to.nodeId !== undefined && estate.nodes.get(to.nodeId)?.state === 'reconciling';
          const deleted =
            to.nodeId !== undefined &&
            (overlays?.get(to.nodeId) === 'deleted' || overlays?.get(to.nodeId) === 'target');
          let stroke = theme.palette.divider;
          if (deleted) stroke = theme.palette.error.main;
          else if (reconciling) stroke = theme.palette.info.main;
          return (
            <Box
              component="path"
              key={`${e.from}>${e.to}`}
              d={`M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`}
              fill="none"
              stroke={stroke}
              strokeWidth={deleted || reconciling ? 1.5 : 1.25}
              strokeDasharray="5 4"
              sx={
                reconciling
                  ? { animation: `${flow} 1s linear infinite`, [REDUCED_MOTION]: { animation: 'none' } }
                  : undefined
              }
            />
          );
        })}
      </svg>
      {layout.cards.map((c) => {
        const node = c.nodeId === undefined ? undefined : estate.nodes.get(c.nodeId);
        const group =
          c.group === undefined
            ? undefined
            : { kind: c.group.kind, count: c.group.ids.length, state: c.worst ?? 'ready' };
        return (
          <Box
            key={c.key}
            role="treeitem"
            aria-expanded={c.expandable ? c.expanded : undefined}
            sx={{ position: 'absolute', left: x(c.depth), top: y(c.row) }}
          >
            <NodeCard
              node={node}
              group={group}
              note={node?.note ?? (c.group !== undefined ? 'grouped' : undefined)}
              selected={c.nodeId !== undefined && c.nodeId === selected}
              overlay={c.nodeId === undefined ? undefined : overlays?.get(c.nodeId)}
              toggle={
                c.expandable
                  ? {
                      expanded: c.expanded,
                      hidden: c.hidden,
                      worst: c.worst,
                      onToggle: () => onToggle(c.key, !c.expanded),
                    }
                  : undefined
              }
              onSelect={
                c.nodeId === undefined ? () => onToggle(c.key, !c.expanded) : () => onSelect(c.nodeId as string)
              }
            />
          </Box>
        );
      })}
    </Box>
  );
}
