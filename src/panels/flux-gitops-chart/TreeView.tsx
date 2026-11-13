import {
  Box,
  Breadcrumbs,
  Button,
  ButtonGroup,
  Checkbox,
  Link,
  ListItemText,
  MenuItem,
  Select,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
  useTheme,
} from '@mui/material';
import type { ReactElement } from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

import type { Estate } from '../../model/estate';
import { displayName } from '../../model/estate';
import type { TreeCard, TreeLayout } from '../../model/views';
import { fluxNamespaces } from '../../model/views';
import type { TreeDirection } from './flux-gitops-chart-types';
import { CARD_H, CARD_W, NodeCard } from './NodeCard';
import type { NodeCardProps, Overlay } from './NodeCard';
import { MONO, REDUCED_MOTION, flow } from './style';
import { usePanZoom } from './usePanZoom';

/** Left to right: one column per level, one row per leaf. */
export const COL_W = 330;
export const ROW_H = 74;
/** Top to bottom: one row per level, one column per leaf. */
export const LEVEL_H = 120;
export const LEAF_W = CARD_W + 30;
const PAD = 16;
/** Room above the first level for the delete-impact label that sits on a card's top edge. */
const TOP = 12;

export interface TreeViewProps {
  estate: Estate;
  layout: TreeLayout;
  /** The breadcrumb: from the top level down to the page's object (empty on the top level). */
  path: string[];
  direction: TreeDirection;
  selected?: string;
  overlays?: Map<string, Overlay>;
  /** Clicking a card with a page of its own opens that page; off in delete mode, where a click picks the target. */
  drill: boolean;
  onSelect: (id: string) => void;
  onToggle: (key: string, expanded: boolean) => void;
  /** Open an object's page; undefined goes back to the top level. */
  onFocus: (id: string | undefined) => void;
  onDirection: (direction: TreeDirection) => void;
  /** The namespaces shown; empty is all of them. */
  namespaces: string[];
  onNamespaces: (namespaces: string[]) => void;
}

/** Most serious first: a group shows the worst overlay among its members. */
const OVERLAY_RANK: Overlay[] = ['target', 'deleted', 'failing', 'losing', 'kept'];

function overlayOf(c: TreeCard, overlays: Map<string, Overlay> | undefined): Overlay | undefined {
  if (overlays === undefined) return undefined;
  if (c.nodeId !== undefined) return overlays.get(c.nodeId);
  if (c.group === undefined) return undefined;
  let best: Overlay | undefined;
  for (const id of c.group.ids) {
    const o = overlays.get(id);
    if (o !== undefined && (best === undefined || OVERLAY_RANK.indexOf(o) < OVERLAY_RANK.indexOf(best))) best = o;
  }
  return best === 'target' ? 'deleted' : best;
}

/**
 * The resource tree, one page at a time: the top level (Flux objects nothing else manages), or one object
 * and what it manages. A breadcrumb leads back. Cards start at real size on a canvas that pans and zooms,
 * with dashed SVG connectors, top to bottom or left to right.
 */
export function TreeView(props: TreeViewProps): ReactElement {
  const {
    estate,
    layout,
    path,
    direction,
    selected,
    overlays,
    drill,
    onSelect,
    onToggle,
    onFocus,
    onDirection,
    namespaces,
    onNamespaces,
  } = props;
  const theme = useTheme();
  const top = layout.focus === undefined;
  const root = estate.root === undefined ? undefined : estate.nodes.get(estate.root);
  const allNamespaces = useMemo(() => fluxNamespaces(estate), [estate]);

  // The canvas: its width wraps the top level; the content's size at 100% feeds Fit to view.
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [viewportW, setViewportW] = useState<number>();
  const pz = usePanZoom(viewportRef, `${layout.focus ?? ''}|${direction}`, size);
  useLayoutEffect(() => {
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (viewport === null || content === null) return undefined;
    const measure = (): void => {
      setViewportW(viewport.clientWidth || undefined);
      setSize((s) =>
        s.width === content.offsetWidth && s.height === content.offsetHeight
          ? s
          : { width: content.offsetWidth, height: content.offsetHeight },
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver(measure);
    ro.observe(viewport);
    ro.observe(content);
    return (): void => ro.disconnect();
  }, []);

  const cardProps = (c: TreeCard): Pick<NodeCardProps, 'onSelect' | 'onDetails' | 'drill'> => {
    if (c.nodeId === undefined) return { onSelect: () => onToggle(c.key, !c.expanded) };
    const id = c.nodeId;
    if (drill && c.drillable) return { onSelect: () => onFocus(id), onDetails: () => onSelect(id), drill: true };
    return { onSelect: () => onSelect(id) };
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1.5,
          px: 2,
          py: 0.75,
          borderBottom: `1px solid ${theme.palette.divider}`,
        }}
      >
        <Breadcrumbs aria-label="Tree path" sx={{ flex: 1, minWidth: 0, fontSize: 14 }}>
          {top ? (
            <Typography aria-current="page" sx={{ fontSize: 'inherit', fontWeight: 600 }}>
              All resources
            </Typography>
          ) : (
            <Link component="button" type="button" onClick={() => onFocus(undefined)} sx={{ fontSize: 'inherit' }}>
              All resources
            </Link>
          )}
          {path.map((id, i) => {
            const n = estate.nodes.get(id);
            if (n === undefined) return null;
            const label = i === 0 ? displayName(n) : n.name;
            const title = `${n.kind} ${displayName(n)}`;
            return i === path.length - 1 ? (
              <Typography key={id} aria-current="page" title={title} sx={{ fontSize: 'inherit', fontWeight: 600 }}>
                {label}{' '}
                <Box component="span" sx={{ color: 'text.secondary', fontWeight: 400, fontSize: 12 }}>
                  {n.kind}
                </Box>
              </Typography>
            ) : (
              <Link
                key={id}
                component="button"
                type="button"
                title={title}
                onClick={() => onFocus(id)}
                sx={{ fontSize: 'inherit' }}
              >
                {label}
              </Link>
            );
          })}
        </Breadcrumbs>
        {top && root !== undefined && (
          <Link
            component="button"
            type="button"
            onClick={() => onSelect(root.id)}
            title={`${root.kind} ${displayName(root)}: where Flux starts. Its details, inventory and delete impact.`}
            sx={{ fontSize: 13 }}
          >
            Flux root: {displayName(root)}
          </Link>
        )}
        <Select
          multiple
          displayEmpty
          size="small"
          value={namespaces}
          inputProps={{ 'aria-label': 'Namespaces' }}
          onChange={(e) => {
            const v = e.target.value;
            const next = typeof v === 'string' ? v.split(',') : v;
            onNamespaces(next.includes('') ? [] : next);
          }}
          renderValue={(v) => {
            if (v.length === 0) return 'All namespaces';
            if (v.length === 1) return v[0];
            return `${v.length} namespaces`;
          }}
          title={namespaces.length > 0 ? namespaces.join(', ') : undefined}
          sx={{ fontSize: 13, maxWidth: 220, '& .MuiSelect-select': { py: 0.5 } }}
        >
          <MenuItem value="" dense>
            <Checkbox size="small" checked={namespaces.length === 0} sx={{ p: 0.25, mr: 1 }} />
            <ListItemText primary="All namespaces" />
          </MenuItem>
          {allNamespaces.map((ns) => (
            <MenuItem key={ns} value={ns} dense>
              <Checkbox size="small" checked={namespaces.includes(ns)} sx={{ p: 0.25, mr: 1 }} />
              <ListItemText primary={ns} primaryTypographyProps={{ fontFamily: MONO, fontSize: 13 }} />
            </MenuItem>
          ))}
        </Select>
        <ButtonGroup size="small" variant="outlined" aria-label="Zoom">
          <Button onClick={pz.zoomOut} aria-label="Zoom out" title="Zoom out (−)" sx={{ minWidth: 30, px: 0.5 }}>
            −
          </Button>
          <Button
            onClick={pz.reset}
            title="Real size (0)"
            sx={{ minWidth: 52, px: 0.5, fontVariantNumeric: 'tabular-nums' }}
          >
            {Math.round(pz.view.k * 100)}%
          </Button>
          <Button onClick={pz.zoomIn} aria-label="Zoom in" title="Zoom in (+)" sx={{ minWidth: 30, px: 0.5 }}>
            +
          </Button>
          <Button onClick={pz.fit} title="Fit to view (double-click the canvas)" sx={{ px: 1, textTransform: 'none' }}>
            Fit to view
          </Button>
        </ButtonGroup>
        <ToggleButtonGroup
          size="small"
          exclusive
          value={direction}
          aria-label="Tree direction"
          onChange={(_, next: TreeDirection | null) => {
            if (next !== null) onDirection(next);
          }}
        >
          <ToggleButton value="vertical" aria-label="Top to bottom" sx={{ py: 0.25, px: 1, textTransform: 'none' }}>
            ↓ Top to bottom
          </ToggleButton>
          <ToggleButton value="horizontal" aria-label="Left to right" sx={{ py: 0.25, px: 1, textTransform: 'none' }}>
            → Left to right
          </ToggleButton>
        </ToggleButtonGroup>
      </Box>
      <Box
        ref={viewportRef}
        data-testid="flux-tree-scroll"
        tabIndex={0}
        aria-label="Tree canvas: drag to pan, wheel or pinch to zoom, + and − keys zoom, 0 is real size"
        onKeyDown={pz.onKeyDown}
        sx={{
          flex: 1,
          minHeight: 0,
          position: 'relative',
          overflow: 'hidden',
          cursor: 'grab',
          touchAction: 'none',
          '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: -2 },
        }}
      >
        <Box
          ref={contentRef}
          sx={{
            position: 'absolute',
            left: 0,
            top: 0,
            width: top ? viewportW : undefined,
            transform: `translate(${pz.view.x}px, ${pz.view.y}px) scale(${pz.view.k})`,
            transformOrigin: '0 0',
          }}
        >
          {top ? (
            <TopLevel estate={estate} layout={layout} selected={selected} overlays={overlays} cardProps={cardProps} />
          ) : (
            <Canvas
              estate={estate}
              layout={layout}
              direction={direction}
              selected={selected}
              overlays={overlays}
              onToggle={onToggle}
              cardProps={cardProps}
            />
          )}
        </Box>
      </Box>
    </Box>
  );
}

interface PageProps {
  estate: Estate;
  layout: TreeLayout;
  selected?: string;
  overlays?: Map<string, Overlay>;
  cardProps: (c: TreeCard) => Pick<NodeCardProps, 'onSelect' | 'onDetails' | 'drill'>;
}

/** The top level: one card per object, wrapped to the panel's width (no connectors: nothing links them). */
function TopLevel({ estate, layout, selected, overlays, cardProps }: PageProps): ReactElement {
  if (layout.cards.length === 0) return <Typography sx={{ p: 2 }}>No Flux resources match the filters.</Typography>;
  return (
    <Box
      role="tree"
      aria-label="Flux resource tree"
      sx={{ display: 'flex', flexWrap: 'wrap', gap: 3, p: 2, pt: 2.5, alignContent: 'flex-start' }}
    >
      {layout.cards.map((c) => {
        const node = c.nodeId === undefined ? undefined : estate.nodes.get(c.nodeId);
        return (
          <Box key={c.key} role="treeitem" aria-level={1}>
            <NodeCard
              node={node}
              note={node?.note ?? (c.hidden > 0 ? `${c.hidden} below` : undefined)}
              selected={c.nodeId !== undefined && c.nodeId === selected}
              overlay={c.nodeId === undefined ? undefined : overlays?.get(c.nodeId)}
              {...cardProps(c)}
            />
          </Box>
        );
      })}
    </Box>
  );
}

/** One object's page: the object, what it manages and the connectors, positioned by direction. */
function Canvas({
  estate,
  layout,
  direction,
  selected,
  overlays,
  onToggle,
  cardProps,
}: PageProps & { direction: TreeDirection; onToggle: (key: string, expanded: boolean) => void }): ReactElement {
  const theme = useTheme();
  const byKey = useMemo(() => new Map(layout.cards.map((c) => [c.key, c])), [layout]);
  const vertical = direction === 'vertical';
  const rows = Math.max(1, layout.rows);
  const width = vertical ? PAD * 2 + rows * LEAF_W : PAD * 2 + layout.depth * COL_W + CARD_W + 16;
  const height = vertical ? PAD * 2 + TOP + layout.depth * LEVEL_H + CARD_H + 16 : PAD * 2 + rows * ROW_H;
  const left = (c: TreeCard): number => PAD + (vertical ? c.row * LEAF_W : c.depth * COL_W);
  const topOf = (c: TreeCard): number => (vertical ? PAD + TOP + c.depth * LEVEL_H : PAD + c.row * ROW_H);

  const edgePath = (from: TreeCard, to: TreeCard): string => {
    if (vertical) {
      const x1 = left(from) + CARD_W / 2;
      const y1 = topOf(from) + CARD_H;
      const x2 = left(to) + CARD_W / 2;
      const y2 = topOf(to);
      const mid = (y1 + y2) / 2;
      return `M${x1},${y1} C${x1},${mid} ${x2},${mid} ${x2},${y2}`;
    }
    const x1 = left(from) + CARD_W;
    const y1 = topOf(from) + CARD_H / 2;
    const x2 = left(to);
    const y2 = topOf(to) + CARD_H / 2;
    const mid = (x1 + x2) / 2;
    return `M${x1},${y1} C${mid},${y1} ${mid},${y2} ${x2},${y2}`;
  };

  return (
    <Box sx={{ position: 'relative', width, height }} role="tree" aria-label="Flux resource tree">
      <svg width={width} height={height} style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }} aria-hidden>
        {layout.edges.map((e) => {
          const from = byKey.get(e.from);
          const to = byKey.get(e.to);
          if (from === undefined || to === undefined) return null;
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
              d={edgePath(from, to)}
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
            : {
                kind: c.group.kind,
                count: c.group.ids.length,
                state: c.worst ?? 'ready',
                kinds: c.group.kinds,
                summary: c.group.summary,
              };
        return (
          <Box
            key={c.key}
            role="treeitem"
            aria-level={c.depth + 1}
            aria-expanded={c.expandable ? c.expanded : undefined}
            sx={{ position: 'absolute', left: left(c), top: topOf(c) }}
          >
            <NodeCard
              node={node}
              group={group}
              note={node?.note}
              selected={c.nodeId !== undefined && c.nodeId === selected}
              overlay={overlayOf(c, overlays)}
              toggleSide={vertical ? 'bottom' : 'right'}
              toggle={
                c.expandable && c.depth > 0
                  ? {
                      expanded: c.expanded,
                      hidden: c.hidden,
                      worst: c.worst,
                      onToggle: () => onToggle(c.key, !c.expanded),
                    }
                  : undefined
              }
              {...cardProps(c)}
            />
          </Box>
        );
      })}
    </Box>
  );
}
