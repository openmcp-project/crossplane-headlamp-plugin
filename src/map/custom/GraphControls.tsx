import { Icon } from '@iconify/react';
import {
  Box,
  Button,
  Checkbox,
  colors,
  FormLabel,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import type { GraphNode } from '../common/types';
import { CategoryKey, categoryLabelOf, CategoryMode } from './graphCategories';
import { CATEGORY_SWATCH_SX, PANEL_ELEVATION, PANEL_SX, TRIMMED_TEXT_SX } from './styles';

export type StatusFilter = GraphNode['status'][] | null;

// UI labels for the category-mode switch (internal names are the clear ones).
const CATEGORY_MODE_OPTIONS: ReadonlyArray<{ value: CategoryMode; label: string }> = [
  { value: 'provider', label: 'Provider' },
  { value: 'providerConfig', label: 'Provider Config' },
  { value: 'flux', label: 'Flux' },
  { value: 'label', label: 'Common Label' },
  { value: 'none', label: 'None' },
];

/** `nopan`/`nowheel` keep filter interaction off the canvas. */
export function GraphControls({
  categoryMode,
  onCategoryModeChange,
  labelKey,
  labelKeys,
  onLabelKeyChange,
  categoryColorMap,
  categoryOptions,
  selectedCategories,
  onCategorySelectionChange,
  statusFilter,
  onStatusFilterChange,
  hasActiveFilters,
  matchingCount,
  totalCount,
  hasGroups,
  canGroup,
  onGroupAll,
  onUngroupAll,
}: {
  categoryMode: CategoryMode;
  onCategoryModeChange: (m: CategoryMode) => void;
  labelKey: string;
  labelKeys: string[];
  onLabelKeyChange: (k: string) => void;
  categoryColorMap: ReadonlyMap<CategoryKey, string>;
  categoryOptions: CategoryKey[];
  selectedCategories: CategoryKey[] | null;
  onCategorySelectionChange: (values: CategoryKey[] | null) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (statuses: StatusFilter) => void;
  hasActiveFilters: boolean;
  matchingCount: number;
  totalCount: number;
  hasGroups: boolean;
  canGroup: boolean;
  onGroupAll: () => void;
  onUngroupAll: () => void;
}) {
  return (
    <Paper
      className="nopan nowheel"
      variant="elevation"
      elevation={PANEL_ELEVATION}
      sx={{ ...PANEL_SX, p: 2, width: 220 }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 2 }}>
        <Button
          size="small"
          variant="outlined"
          disabled={!canGroup}
          onClick={onGroupAll}
          sx={{ justifyContent: 'flex-start', gap: 0.75 }}
        >
          <Icon icon="mdi:group" width={16} height={16} aria-hidden="true" />
          Group all
        </Button>
        <Button
          size="small"
          variant="outlined"
          disabled={!hasGroups}
          onClick={onUngroupAll}
          sx={{ justifyContent: 'flex-start', gap: 0.75 }}
        >
          <Icon icon="mdi:ungroup" width={16} height={16} aria-hidden="true" />
          Ungroup all
        </Button>
      </Box>
      <TextField
        id="crossplane-map-category"
        select
        size="small"
        fullWidth
        label="Categorize by"
        value={categoryMode}
        onChange={(e: any) => onCategoryModeChange(e.target.value as CategoryMode)}
      >
        {CATEGORY_MODE_OPTIONS.map(opt => (
          <MenuItem key={opt.value} value={opt.value}>
            {opt.label}
          </MenuItem>
        ))}
      </TextField>

      {categoryMode === 'label' && (
        <TextField
          id="crossplane-map-label"
          select
          size="small"
          fullWidth
          label="Label"
          value={labelKey}
          disabled={labelKeys.length === 0}
          onChange={(e: any) => onLabelKeyChange(e.target.value)}
          sx={{ mt: 1 }}
        >
          {labelKeys.map(k => (
            <MenuItem key={k} value={k}>
              {k}
            </MenuItem>
          ))}
        </TextField>
      )}

      <Box component="fieldset" sx={{ border: 0, m: 0, p: 0, minWidth: 0, mt: 3 }}>
        <FormLabel
          component="legend"
          sx={{ typography: 'subtitle2', fontWeight: 600, color: 'text.primary', p: 0, mb: 1.5 }}
        >
          Filter by
        </FormLabel>
        <Box sx={{ pl: 1.5 }}>
          <CategoryFilter
            categoryMode={categoryMode}
            categoryColorMap={categoryColorMap}
            categoryOptions={categoryOptions}
            selectedCategories={selectedCategories}
            onCategorySelectionChange={onCategorySelectionChange}
          />
          <StatusFilterControl
            statusFilter={statusFilter}
            onStatusFilterChange={onStatusFilterChange}
          />
          {hasActiveFilters && (
            <Typography
              variant="caption"
              color="text.secondary"
              component="p"
              sx={{ m: 0, mt: 1.5 }}
            >
              {matchingCount} of {totalCount} {totalCount === 1 ? 'resource' : 'resources'}{' '}
              {totalCount === 1 ? 'matches' : 'match'} filters
            </Typography>
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
  const allStatusesSelected = statusFilter === null;
  const selectedStatuses = statusFilter ?? statusOptions.map(option => option.value);

  return (
    <TextField
      id="crossplane-map-status"
      select
      size="small"
      fullWidth
      label="Status"
      value={allStatusesSelected ? ['', ...selectedStatuses] : selectedStatuses}
      InputLabelProps={{ shrink: true }}
      SelectProps={{
        multiple: true,
        displayEmpty: true,
        renderValue: () =>
          allStatusesSelected
            ? 'All'
            : selectedStatuses.length === 0
            ? 'None'
            : statusOptions.find(option => option.value === selectedStatuses[0])?.label,
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
        if (next.includes('') !== allStatusesSelected) {
          onStatusFilterChange(allStatusesSelected ? [] : null);
        } else {
          const values = statusOptions
            .filter(option => next.includes(option.value))
            .map(option => option.value);
          onStatusFilterChange(values.length === statusOptions.length ? null : values);
        }
      }}
      sx={{ mt: 1.5 }}
    >
      <MenuItem value="" sx={{ borderBottom: 1, borderColor: 'divider', mb: 0.5 }}>
        <Checkbox
          size="small"
          checked={allStatusesSelected}
          indeterminate={!allStatusesSelected && selectedStatuses.length > 0}
          disableRipple
          tabIndex={-1}
          inputProps={{ 'aria-hidden': true }}
          sx={{ pointerEvents: 'none' }}
        />
        All
      </MenuItem>
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

function CategoryFilter({
  categoryMode,
  categoryColorMap,
  categoryOptions,
  selectedCategories,
  onCategorySelectionChange,
}: {
  categoryMode: CategoryMode;
  categoryColorMap: ReadonlyMap<CategoryKey, string>;
  categoryOptions: CategoryKey[];
  selectedCategories: CategoryKey[] | null;
  onCategorySelectionChange: (values: CategoryKey[] | null) => void;
}) {
  const allSelected = selectedCategories === null;
  const selectedKeys = categoryOptions.filter(
    key => selectedCategories === null || selectedCategories.includes(key)
  );
  const filterLabel =
    categoryMode === 'none'
      ? 'Category'
      : CATEGORY_MODE_OPTIONS.find(option => option.value === categoryMode)?.label;
  // MUI compares primitive values as strings; serialize to distinguish null from "null".
  const options = categoryOptions.map(key => ({
    key,
    value: JSON.stringify(key),
    label: categoryLabelOf(key),
  }));
  const selectedValues = selectedKeys.map(key => JSON.stringify(key));

  return (
    <TextField
      id="crossplane-map-filter"
      select
      size="small"
      fullWidth
      label={filterLabel}
      disabled={categoryOptions.length === 0}
      value={allSelected ? ['', ...selectedValues] : selectedValues}
      InputLabelProps={{ shrink: true }}
      SelectProps={{
        multiple: true,
        displayEmpty: true,
        renderValue: () =>
          categoryMode === 'none' || allSelected ? (
            'All'
          ) : selectedKeys.length === 0 ? (
            'None'
          ) : selectedKeys.length === 1 ? (
            <Box
              component="span"
              sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: '1lh' }}
            >
              <Box
                component="span"
                aria-hidden="true"
                sx={{
                  ...CATEGORY_SWATCH_SX,
                  color: categoryColorMap.get(selectedKeys[0]),
                }}
              />
              <Box
                component="span"
                sx={{
                  ...TRIMMED_TEXT_SX,
                  minWidth: 0,
                  overflowX: 'clip',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {categoryLabelOf(selectedKeys[0])}
              </Box>
            </Box>
          ) : (
            `${selectedKeys.length} selected`
          ),
        SelectDisplayProps: { title: selectedKeys.map(categoryLabelOf).join(', ') },
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
        // Every serialized category is non-empty, leaving '' available for the All option.
        if (next.includes('') !== allSelected) {
          onCategorySelectionChange(allSelected ? [] : null);
        } else {
          const values = options
            .filter(option => next.includes(option.value))
            .map(option => option.key);
          onCategorySelectionChange(values.length === categoryOptions.length ? null : values);
        }
      }}
    >
      <MenuItem value="" sx={{ borderBottom: 1, borderColor: 'divider', mb: 0.5 }}>
        <Checkbox
          size="small"
          checked={allSelected}
          indeterminate={!allSelected && selectedKeys.length > 0}
          tabIndex={-1}
          inputProps={{ 'aria-hidden': true }}
        />
        All
      </MenuItem>
      {options.map(({ key, value, label }) => (
        <MenuItem key={value} value={value}>
          <Checkbox
            size="small"
            checked={selectedKeys.includes(key)}
            tabIndex={-1}
            inputProps={{ 'aria-hidden': true }}
          />
          <Box
            component="span"
            aria-hidden="true"
            sx={{
              ...CATEGORY_SWATCH_SX,
              color: categoryColorMap.get(key),
              mr: 1,
            }}
          />
          <Typography
            component="span"
            sx={{
              ...TRIMMED_TEXT_SX,
              whiteSpace: 'normal',
              overflowWrap: 'anywhere',
            }}
          >
            {label}
          </Typography>
        </MenuItem>
      ))}
    </TextField>
  );
}
