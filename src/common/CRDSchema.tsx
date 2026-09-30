import { useState } from 'react';
import { neutralColors } from './crdTheme';

const { Typography, Box } = (window as any).pluginLib?.MuiCore ?? {};

// ── Type chip ─────────────────────────────────────────────────────────────────

export function TypeChip({ type }: { type: string }) {
  const colors: Record<string, string> = {
    string: '#1565c0',
    integer: '#6a1b9a',
    number: '#6a1b9a',
    boolean: '#e65100',
    object: '#2e7d32',
    array: '#00695c',
  };
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '1px 7px',
        borderRadius: 4,
        fontSize: 10,
        fontWeight: 700,
        background: colors[type] ?? '#616161',
        color: '#fff',
        fontFamily: 'monospace',
        marginLeft: 6,
      }}
    >
      {type}
    </span>
  );
}

// ── Schema property tree ──────────────────────────────────────────────────────

export function SchemaPropertyTree({
  schema,
  required = [],
  depth = 0,
}: {
  schema: any;
  required?: string[];
  depth?: number;
}) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const neutral = neutralColors();

  if (!schema?.properties) {
    return (
      <Typography
        variant="body2"
        color="textSecondary"
        style={{ padding: '4px 0', fontStyle: 'italic' }}
      >
        No properties defined.
      </Typography>
    );
  }

  const props = Object.entries(schema.properties) as [string, any][];

  return (
    <Box style={{ paddingLeft: depth * 16 }}>
      {props.map(([name, propSchema]) => {
        const isRequired = required.includes(name);
        const hasChildren =
          (propSchema.type === 'object' || propSchema.properties) && propSchema.properties;
        const isCollapsed = collapsed.has(name);
        const type: string = propSchema.type ?? (propSchema.properties ? 'object' : '?');
        const arrayItemType: string | null =
          type === 'array' && propSchema.items?.type ? propSchema.items.type : null;

        return (
          <Box key={name} style={{ marginBottom: 6 }}>
            <Box
              display="flex"
              alignItems="flex-start"
              style={{ gap: 6, cursor: hasChildren ? 'pointer' : 'default' }}
              onClick={() => {
                if (!hasChildren) return;
                setCollapsed(prev => {
                  const next = new Set(prev);
                  next.has(name) ? next.delete(name) : next.add(name);
                  return next;
                });
              }}
            >
              {hasChildren ? (
                <span
                  style={{
                    fontSize: 10,
                    color: neutral.muted,
                    marginTop: 3,
                    userSelect: 'none',
                    width: 10,
                  }}
                >
                  {isCollapsed ? '▸' : '▾'}
                </span>
              ) : (
                <span style={{ display: 'inline-block', width: 10 }} />
              )}
              <span style={{ fontWeight: 600, fontFamily: 'monospace', fontSize: 13 }}>{name}</span>
              <TypeChip type={type} />
              {arrayItemType && (
                <span style={{ fontSize: 10, color: neutral.muted, marginTop: 2 }}>
                  of {arrayItemType}
                </span>
              )}
              {isRequired && (
                <span
                  style={{
                    fontSize: 9,
                    fontWeight: 700,
                    padding: '1px 5px',
                    borderRadius: 3,
                    background: '#c62828',
                    color: '#fff',
                    marginLeft: 2,
                    marginTop: 1,
                  }}
                >
                  required
                </span>
              )}
              {propSchema.description && (
                <Typography
                  variant="caption"
                  color="textSecondary"
                  style={{ fontSize: 11, marginTop: 1, flex: 1, lineHeight: 1.4 }}
                >
                  {propSchema.description}
                </Typography>
              )}
            </Box>
            {hasChildren && !isCollapsed && (
              <Box
                style={{ marginTop: 4, paddingLeft: 16, borderLeft: `2px solid ${neutral.border}` }}
              >
                <SchemaPropertyTree
                  schema={propSchema}
                  required={propSchema.required ?? []}
                  depth={0}
                />
              </Box>
            )}
          </Box>
        );
      })}
    </Box>
  );
}
