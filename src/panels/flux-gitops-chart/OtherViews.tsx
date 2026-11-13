import {
  Box,
  Breadcrumbs,
  Link,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TableSortLabel,
  Typography,
  useTheme,
} from '@mui/material';
import type { ReactElement, ReactNode } from 'react';
import { useMemo, useState } from 'react';

import type { Estate } from '../../model/estate';
import { displayName } from '../../model/estate';
import { STATE_ICON, STATE_LABEL, shortRevision } from '../../model/state';
import type {
  ListSortKey,
  StagesView as Stages,
  SourceRow,
  InventoryView as Inventory,
  ListRow,
} from '../../model/views';
import { sortList } from '../../model/views';
import { NodeCard } from './NodeCard';
import type { Overlay } from './NodeCard';
import { MONO, stateColor } from './style';

interface Common {
  estate: Estate;
  selected?: string;
  overlays?: Map<string, Overlay>;
  onSelect: (id: string) => void;
}

function Column({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return (
    <Box
      component="section"
      aria-label={title}
      sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, minWidth: 250, pt: 1 }}
    >
      <Typography variant="overline" sx={{ lineHeight: 1.2, color: 'text.secondary' }}>
        {title}
      </Typography>
      {children}
    </Box>
  );
}

/** dependsOn stages: sources, then one column per stage; blocked Kustomizations say what they wait on. */
export function StagesView({
  estate,
  stages,
  selected,
  overlays,
  onSelect,
}: Common & { stages: Stages }): ReactElement {
  const card = (id: string, note?: string): ReactElement | null => {
    const n = estate.nodes.get(id);
    if (n === undefined) return null;
    return (
      <NodeCard
        key={id}
        node={n}
        note={note ?? n.note}
        selected={id === selected}
        overlay={overlays?.get(id)}
        onSelect={() => onSelect(id)}
      />
    );
  };
  if (stages.columns.length === 0) return <Typography sx={{ p: 2 }}>No Kustomizations to show.</Typography>;
  return (
    <Box sx={{ display: 'flex', gap: 4, p: 2, alignItems: 'flex-start' }}>
      {stages.sources.length > 0 && <Column title="Sources">{stages.sources.map((id) => card(id))}</Column>}
      {stages.columns.map((c) => (
        <Column key={c.stage} title={`Stage ${c.stage}`}>
          {c.ids.map((id) => {
            const b = stages.blockedBy.get(id);
            const blocker = b === undefined ? undefined : estate.nodes.get(b);
            return card(id, blocker === undefined ? undefined : `blocked by ${blocker.name}`);
          })}
        </Column>
      ))}
    </Box>
  );
}

function NameLink({
  estate,
  id,
  onSelect,
}: {
  estate: Estate;
  id: string;
  onSelect: (id: string) => void;
}): ReactElement {
  const theme = useTheme();
  const n = estate.nodes.get(id);
  if (n === undefined) return <span>{id}</span>;
  return (
    <Link
      component="button"
      type="button"
      onClick={() => onSelect(id)}
      sx={{ fontSize: 'inherit', verticalAlign: 'baseline' }}
    >
      <span style={{ color: stateColor(theme, n.state) }}>{STATE_ICON[n.state]}</span> {displayName(n)}
    </Link>
  );
}

/** Each source, what it feeds and what it delivered; nested when a source's output defines further sources. */
export function SourcesView({
  estate,
  sources,
  selected,
  overlays,
  onSelect,
}: Common & { sources: SourceRow[] }): ReactElement {
  if (sources.length === 0) return <Typography sx={{ p: 2 }}>No sources found.</Typography>;
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 2.5, p: 2 }}>
      {sources.map((row) => {
        const n = estate.nodes.get(row.id);
        if (n === undefined) return null;
        const byKind = new Map<string, number>();
        for (const d of row.delivered) {
          const k = estate.nodes.get(d)?.kind ?? '';
          byKind.set(k, (byKind.get(k) ?? 0) + 1);
        }
        return (
          <Box
            key={row.id}
            sx={{ display: 'flex', gap: 3, alignItems: 'flex-start', ml: row.level * 4, flexWrap: 'wrap' }}
          >
            <NodeCard
              node={n}
              note={shortRevision(n.appliedRevision) || n.note}
              selected={row.id === selected}
              overlay={overlays?.get(row.id)}
              onSelect={() => onSelect(row.id)}
            />
            <Box sx={{ minWidth: 240, flex: 1, fontSize: 13 }}>
              <Typography variant="body2" component="div">
                {row.kustomizations.length} Kustomizations, {row.helmReleases.length} HelmReleases
                {row.otherConsumers.length > 0 ? `, ${row.otherConsumers.length} other` : ''} → {row.delivered.length}{' '}
                objects
                {row.unhealthy > 0 && (
                  <Box component="span" sx={{ color: 'error.main', fontWeight: 600 }}>
                    {' '}
                    ({row.unhealthy} unhealthy)
                  </Box>
                )}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', mt: 0.5 }}>
                {[...row.kustomizations, ...row.helmReleases, ...row.otherConsumers].map((id) => (
                  <NameLink key={id} estate={estate} id={id} onSelect={onSelect} />
                ))}
              </Box>
              {byKind.size > 0 && (
                <Typography
                  variant="caption"
                  component="div"
                  sx={{ color: 'text.secondary', mt: 0.5, fontFamily: MONO }}
                >
                  {[...byKind.entries()]
                    .sort((a, b) => b[1] - a[1])
                    .map(([k, c]) => `${c} ${k}`)
                    .join(' · ')}
                </Typography>
              )}
              {row.definedIn !== undefined && (
                <Typography variant="caption" component="div" sx={{ color: 'text.secondary' }}>
                  defined in <NameLink estate={estate} id={row.definedIn} onSelect={onSelect} />
                </Typography>
              )}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}

/** Everything under one Flux object, grouped by kind, with breadcrumbs back to the root. */
export function InventoryView({
  estate,
  inventory,
  selected,
  overlays,
  onSelect,
  onOpen,
}: Common & { inventory: Inventory; onOpen: (id: string) => void }): ReactElement {
  return (
    <Box sx={{ p: 2 }}>
      <Breadcrumbs aria-label="Inventory path" sx={{ mb: 2 }}>
        {inventory.breadcrumbs.map((id, i) => {
          const n = estate.nodes.get(id);
          const label = n === undefined ? id : `${n.kind} ${n.name}`;
          return i === inventory.breadcrumbs.length - 1 ? (
            <Typography key={id} color="text.primary" sx={{ fontWeight: 600 }}>
              {label} ({inventory.total})
            </Typography>
          ) : (
            <Link key={id} component="button" type="button" onClick={() => onOpen(id)}>
              {label}
            </Link>
          );
        })}
      </Breadcrumbs>
      {inventory.groups.length === 0 && <Typography>Nothing applied by this object.</Typography>}
      {inventory.groups.map((g) => (
        <Box key={g.kind} component="section" aria-label={g.kind} sx={{ mb: 2.5 }}>
          <Typography variant="overline" sx={{ color: 'text.secondary' }}>
            {g.kind} ({g.ids.length})
          </Typography>
          <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 2.5, mt: 1 }}>
            {g.ids.map((id) => {
              const n = estate.nodes.get(id);
              return n === undefined ? null : (
                <NodeCard
                  key={id}
                  node={n}
                  note={n.namespace || n.note}
                  selected={id === selected}
                  overlay={overlays?.get(id)}
                  onSelect={() => onSelect(id)}
                />
              );
            })}
          </Box>
        </Box>
      ))}
    </Box>
  );
}

const COLUMNS: Array<{ key: ListSortKey; label: string }> = [
  { key: 'status', label: 'Status' },
  { key: 'kind', label: 'Kind' },
  { key: 'namespace', label: 'Namespace' },
  { key: 'name', label: 'Name' },
  { key: 'stage', label: 'Stage' },
  { key: 'revision', label: 'Revision' },
  { key: 'age', label: 'Age' },
];

function age(createdAt: string | undefined, now: number): string {
  if (createdAt === undefined) return '';
  const s = Math.max(0, Math.floor((now - Date.parse(createdAt)) / 1000));
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  return `${Math.floor(s / 86400)}d`;
}

function sortDirection(dir: 1 | -1): 'asc' | 'desc' {
  return dir === 1 ? 'asc' : 'desc';
}

/** Every Flux object as a sortable table. */
export function ListView({
  estate,
  rows,
  selected,
  onSelect,
  now,
}: Omit<Common, 'overlays'> & { rows: ListRow[]; now: number }): ReactElement {
  const theme = useTheme();
  const [sort, setSort] = useState<{ key: ListSortKey; dir: 1 | -1 }>({ key: 'status', dir: 1 });
  const sorted = useMemo(() => sortList(rows, sort.key, sort.dir), [rows, sort]);
  void estate;
  return (
    <Table size="small" stickyHeader aria-label="Flux objects">
      <TableHead>
        <TableRow>
          {COLUMNS.map((c) => (
            <TableCell key={c.key} sortDirection={sort.key === c.key && sortDirection(sort.dir)}>
              <TableSortLabel
                active={sort.key === c.key}
                direction={sort.key === c.key && sort.dir === -1 ? 'desc' : 'asc'}
                onClick={() => setSort((s) => ({ key: c.key, dir: s.key === c.key ? (-s.dir as 1 | -1) : 1 }))}
              >
                {c.label}
              </TableSortLabel>
            </TableCell>
          ))}
        </TableRow>
      </TableHead>
      <TableBody>
        {sorted.map((r) => (
          <TableRow
            key={r.id}
            hover
            selected={r.id === selected}
            tabIndex={0}
            onClick={() => onSelect(r.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSelect(r.id);
            }}
            sx={{ cursor: 'pointer' }}
          >
            <TableCell sx={{ color: stateColor(theme, r.state), whiteSpace: 'nowrap', fontWeight: 600 }}>
              {STATE_ICON[r.state]} {STATE_LABEL[r.state]}
            </TableCell>
            <TableCell>{r.kind}</TableCell>
            <TableCell>{r.namespace}</TableCell>
            <TableCell sx={{ fontWeight: 600 }}>{r.name}</TableCell>
            <TableCell>{r.stage ?? ''}</TableCell>
            <TableCell sx={{ fontFamily: MONO, fontSize: 12 }}>{shortRevision(r.revision) || r.revision}</TableCell>
            <TableCell>{age(r.createdAt, now)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
