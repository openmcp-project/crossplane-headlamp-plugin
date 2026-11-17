import { Icon } from '@iconify/react';
import {
  Badge,
  Box,
  Button,
  Checkbox,
  colors,
  IconButton,
  InputAdornment,
  MenuItem,
  Paper,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { GraphNode } from '../common/types';
import { CategoryKey, categoryLabelOf } from './graphCategories';
import { CATEGORY_SWATCH_SX, PANEL_ELEVATION, PANEL_SX } from './styles';

export type StatusFilter = GraphNode['status'][] | null;

// Match the section width while its scrollbar uses the Paper's right padding.
const FILTER_FIELD_SX = { width: '100cqw', maxWidth: '100%', flexShrink: 0 };

export interface ValueFilterConfig {
  options: CategoryKey[];
  selected: CategoryKey[] | null;
  onChange: (values: CategoryKey[] | null) => void;
  // When present, values render with their category color and swatch.
  colorMap?: ReadonlyMap<CategoryKey, string>;
}

export interface LabelFilterConfig extends ValueFilterConfig {
  key: string;
  onRemove: () => void;
}

/** `nopan`/`nowheel` keep filter interaction off the canvas. */
export function GraphControls({
  fluxFilter,
  kindFilter,
  labelFilters,
  addableLabelKeys,
  onAddLabelFilter,
  statusFilter,
  onStatusFilterChange,
  hasAggregates,
  canAggregate,
  onAggregateAll,
  onDisaggregateAll,
}: {
  fluxFilter?: ValueFilterConfig;
  kindFilter?: ValueFilterConfig;
  labelFilters: LabelFilterConfig[];
  addableLabelKeys: string[];
  onAddLabelFilter: (key: string) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (statuses: StatusFilter) => void;
  hasAggregates: boolean;
  canAggregate: boolean;
  onAggregateAll: () => void;
  onDisaggregateAll: () => void;
}) {
  return (
    <Paper
      className="nopan nowheel"
      variant="elevation"
      elevation={PANEL_ELEVATION}
      sx={{
        ...PANEL_SX,
        p: 2,
        width: 244,
        maxWidth: 'calc(100vw - 32px)',
        minHeight: 0,
        display: 'flex',
        flexDirection: 'column',
        gap: 3,
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'flex-start',
          gap: 1,
          flexShrink: 0,
        }}
      >
        <Typography
          id="crossplane-map-aggregation"
          component="h3"
          variant="subtitle2"
          sx={{ fontWeight: 'fontWeightBold' }}
        >
          Aggregation
        </Typography>
        <Box
          role="group"
          aria-labelledby="crossplane-map-aggregation"
          sx={{
            display: 'flex',
            width: '100%',
            flexShrink: 0,
            border: 1,
            borderColor: 'divider',
            borderRadius: 1,
            overflow: 'hidden',
            '& > span + span': { borderLeft: 1, borderColor: 'divider' },
            '& .MuiButton-root': {
              minWidth: 0,
              minHeight: 32,
              px: 1,
              py: 0.5,
              gap: 0.75,
              borderRadius: 0,
              '&.Mui-focusVisible': {
                outline: '2px solid',
                outlineColor: 'primary.main',
                outlineOffset: -2,
              },
            },
          }}
        >
          <Tooltip title="Combine all eligible resources" describeChild>
            <Box component="span" sx={{ display: 'flex', flex: 1, minWidth: 0 }}>
              <Button
                fullWidth
                color="inherit"
                size="small"
                aria-label="Combine all"
                disabled={!canAggregate}
                onClick={onAggregateAll}
              >
                <Icon icon="mdi:group" width={16} height={16} aria-hidden="true" />
                Combine
              </Button>
            </Box>
          </Tooltip>
          <Tooltip title="Show resources individually" describeChild>
            <Box component="span" sx={{ display: 'flex', flex: 1, minWidth: 0 }}>
              <Button
                fullWidth
                color="inherit"
                size="small"
                aria-label="Separate all"
                disabled={!hasAggregates}
                onClick={onDisaggregateAll}
              >
                <Icon icon="mdi:ungroup" width={16} height={16} aria-hidden="true" />
                Separate
              </Button>
            </Box>
          </Tooltip>
        </Box>
      </Box>

      <Box
        role="group"
        aria-labelledby="crossplane-map-filters"
        sx={{
          display: 'flex',
          flexDirection: 'column',
          gap: 1,
          minHeight: 0,
          containerType: 'inline-size',
        }}
      >
        <Typography
          id="crossplane-map-filters"
          component="h3"
          variant="subtitle2"
          sx={{ fontWeight: 'fontWeightBold' }}
        >
          Filter
        </Typography>
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: 1.5,
            minHeight: 0,
            mr: -2,
            overflowY: 'auto',
            overflowX: 'hidden',
          }}
        >
          {kindFilter && (
            <ValueFilter id="crossplane-map-filter-kind" label="Kind" {...kindFilter} />
          )}
          <StatusFilterControl
            statusFilter={statusFilter}
            onStatusFilterChange={onStatusFilterChange}
          />
          {fluxFilter && (
            <ValueFilter id="crossplane-map-filter-flux" label="Flux" {...fluxFilter} />
          )}
          {labelFilters.map(filter => (
            <ValueFilter
              key={filter.key}
              id={`crossplane-map-filter-label-${filter.key}`}
              label={filter.key}
              options={filter.options}
              selected={filter.selected}
              onChange={filter.onChange}
              onRemove={filter.onRemove}
            />
          ))}
          {addableLabelKeys.length > 0 && (
            <TextField
              id="crossplane-map-add-label-filter"
              select
              fullWidth
              size="small"
              value=""
              inputProps={{ 'aria-label': '+ Label filter' }}
              SelectProps={{ displayEmpty: true, renderValue: () => '+ Label filter' }}
              sx={FILTER_FIELD_SX}
              onChange={(e: any) => onAddLabelFilter(e.target.value)}
            >
              {addableLabelKeys.map(k => (
                <MenuItem key={k} value={k}>
                  {k}
                </MenuItem>
              ))}
            </TextField>
          )}
        </Box>
      </Box>
    </Paper>
  );
}

function StatusFilterControl({
  statusFilter,
  onStatusFilterChange,
}: {
  statusFilter: StatusFilter;
  onStatusFilterChange: (statuses: StatusFilter) => void;
}) {
  const theme = useTheme();
  const errorColor = theme.palette.mode === 'dark' ? colors.red[200] : theme.palette.error.main;
  const statusOptions = (['success', 'error'] as const).map(status => ({
    value: status,
    label: (
      <Box
        component="span"
        sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: '1lh' }}
      >
        <Icon
          icon={status === 'success' ? 'mdi:check-circle' : 'mdi:alert-circle'}
          width={16}
          height={16}
          aria-hidden="true"
          style={{
            flexShrink: 0,
            color: status === 'success' ? theme.palette.success.main : errorColor,
          }}
        />
        {status === 'success' ? 'Healthy' : 'Needs Attention'}
      </Box>
    ),
  }));
  // null means "all"; render nothing checked and let the badge stay empty.
  const selectedStatuses = statusFilter ?? [];

  return (
    <TextField
      id="crossplane-map-status"
      select
      fullWidth
      size="small"
      sx={FILTER_FIELD_SX}
      value={selectedStatuses}
      InputLabelProps={{ shrink: true }}
      inputProps={{ 'aria-label': 'Status' }}
      SelectProps={{
        multiple: true,
        displayEmpty: true,
        renderValue: () => labelWithBadge('Status', selectedStatuses.length),
        MenuProps: {
          MenuListProps: {
            sx: {
              '& .MuiMenuItem-root.Mui-selected': {
                backgroundColor: 'transparent',
                '&:hover': { backgroundColor: 'action.hover' },
                '&.Mui-focusVisible': { backgroundColor: 'action.focus' },
              },
            },
          },
        },
      }}
      onChange={(event: any) => {
        const next: string[] =
          typeof event.target.value === 'string'
            ? event.target.value.split(',')
            : event.target.value;
        const values = statusOptions
          .filter(option => next.includes(option.value))
          .map(option => option.value);
        // Empty or full selection both mean "all", represented as null.
        onStatusFilterChange(
          values.length === 0 || values.length === statusOptions.length ? null : values
        );
      }}
    >
      {statusOptions.map(({ value, label }) => (
        <MenuItem key={value} value={value}>
          <Checkbox
            size="small"
            checked={selectedStatuses.includes(value)}
            disableRipple
            tabIndex={-1}
            inputProps={{ 'aria-hidden': true }}
            sx={{ pointerEvents: 'none' }}
          />
          {label}
        </MenuItem>
      ))}
    </TextField>
  );
}

function ValueFilter({
  id,
  label,
  options: valueOptions,
  selected,
  onChange,
  colorMap,
  onRemove,
}: {
  id: string;
  label: string;
  options: CategoryKey[];
  selected: CategoryKey[] | null;
  onChange: (values: CategoryKey[] | null) => void;
  colorMap?: ReadonlyMap<CategoryKey, string>;
  onRemove?: () => void;
}) {
  const selectedKeys = selected ?? [];
  // Keep selections removable after their values disappear from live data.
  const availableKeys = [...new Set([...valueOptions, ...selectedKeys])];
  // MUI compares primitive values as strings; serialize to distinguish null from "null".
  const options = availableKeys.map(key => ({
    key,
    value: JSON.stringify(key),
    label: categoryLabelOf(key),
  }));
  const selectedValues = selectedKeys.map(key => JSON.stringify(key));

  return (
    <TextField
      id={id}
      select
      fullWidth
      size="small"
      sx={FILTER_FIELD_SX}
      disabled={options.length === 0}
      value={selectedValues}
      InputLabelProps={{ shrink: true }}
      inputProps={{ 'aria-label': label }}
      InputProps={
        onRemove
          ? {
              endAdornment: (
                <InputAdornment position="end" sx={{ mr: 3 }}>
                  <IconButton
                    size="small"
                    aria-label={`Remove ${label} filter`}
                    onClick={onRemove}
                    sx={{ width: 28, height: 28 }}
                  >
                    <Icon icon="mdi:close" width={16} height={16} aria-hidden="true" />
                  </IconButton>
                </InputAdornment>
              ),
            }
          : undefined
      }
      SelectProps={{
        // The adornment already reserves space for the dropdown arrow.
        SelectDisplayProps: onRemove ? { style: { paddingRight: 0 } } : undefined,
        multiple: true,
        displayEmpty: true,
        renderValue: () => labelWithBadge(label, selectedKeys.length),
        MenuProps: {
          PaperProps: { sx: { maxHeight: 320, maxWidth: 'calc(100vw - 32px)' } },
          MenuListProps: {
            sx: {
              '& .MuiMenuItem-root.Mui-selected': {
                backgroundColor: 'transparent',
                '&:hover': { backgroundColor: 'action.hover' },
                '&.Mui-focusVisible': { backgroundColor: 'action.focus' },
              },
            },
          },
        },
      }}
      onChange={(event: any) => {
        const next: string[] =
          typeof event.target.value === 'string'
            ? event.target.value.split(',')
            : event.target.value;
        const values = options
          .filter(option => next.includes(option.value))
          .map(option => option.key);
        // Empty or full selection both mean "all", represented as null.
        onChange(values.length === 0 || values.length === options.length ? null : values);
      }}
    >
      {options.map(({ key, value, label: optionLabel }) => (
        <MenuItem key={value} value={value}>
          <Checkbox
            size="small"
            checked={selectedKeys.includes(key)}
            tabIndex={-1}
            inputProps={{ 'aria-hidden': true }}
          />
          {colorMap && (
            <Box
              component="span"
              aria-hidden="true"
              sx={{ ...CATEGORY_SWATCH_SX, color: colorMap.get(key), mr: 1 }}
            />
          )}
          <Typography
            component="span"
            sx={{
              color: colorMap?.get(key),
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {optionLabel}
          </Typography>
        </MenuItem>
      ))}
    </TextField>
  );
}

/**
 * Collapsed filter field content: the filter name on the left and a right-aligned
 * badge counting explicitly selected values (hidden at zero, i.e. the "all" state).
 */
function labelWithBadge(label: string, count: number) {
  return (
    <Box
      component="span"
      sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', width: '100%' }}
    >
      <Box
        component="span"
        sx={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
      >
        {label}
      </Box>
      <Badge
        badgeContent={count || undefined}
        color="primary"
        sx={{
          flexShrink: 0,
          '& .MuiBadge-badge': { position: 'static', transform: 'none', ml: 1 },
        }}
      />
    </Box>
  );
}
