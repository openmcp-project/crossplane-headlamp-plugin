import { Icon } from '@iconify/react';
import {
  Box,
  Checkbox,
  colors,
  FormLabel,
  MenuItem,
  Paper,
  TextField,
  Typography,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { CategoryKey, categoryLabelOf, CategoryMode } from './graphCategories';
import { CATEGORY_SWATCH_SX, PANEL_ELEVATION, PANEL_SX, TRIMMED_TEXT_SX } from './styles';

export type StatusFilter = 'all' | 'success' | 'error';

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
}: {
  categoryMode: CategoryMode;
  onCategoryModeChange: (m: CategoryMode) => void;
  labelKey: string;
  labelKeys: string[];
  onLabelKeyChange: (k: string) => void;
  categoryColorMap: ReadonlyMap<CategoryKey, string>;
  categoryOptions: CategoryKey[];
  selectedCategories: CategoryKey[];
  onCategorySelectionChange: (values: CategoryKey[] | null) => void;
  statusFilter: StatusFilter;
  onStatusFilterChange: (status: StatusFilter) => void;
}) {
  const theme = useTheme();
  const errorColor = theme.palette.mode === 'dark' ? colors.red[200] : theme.palette.error.main;

  return (
    <Paper
      className="nopan nowheel"
      variant="elevation"
      elevation={PANEL_ELEVATION}
      sx={{ ...PANEL_SX, p: 2, width: 220 }}
    >
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
          <TextField
            id="crossplane-map-status"
            select
            size="small"
            fullWidth
            label="Status"
            value={statusFilter}
            onChange={(event: any) => onStatusFilterChange(event.target.value as StatusFilter)}
            sx={{ mt: 1.5 }}
          >
            <MenuItem value="all">All</MenuItem>
            {(['success', 'error'] as const).map(status => (
              <MenuItem key={status} value={status}>
                <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
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
                  {status === 'success' ? 'Ready' : 'Not Ready'}
                </Box>
              </MenuItem>
            ))}
          </TextField>
        </Box>
      </Box>
    </Paper>
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
  selectedCategories: CategoryKey[];
  onCategorySelectionChange: (values: CategoryKey[] | null) => void;
}) {
  const allSelected =
    categoryOptions.length > 0 && selectedCategories.length === categoryOptions.length;
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
  const selectedValues = selectedCategories.map(key => JSON.stringify(key));

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
          ) : selectedCategories.length === 0 ? (
            'None'
          ) : selectedCategories.length === 1 ? (
            <Box
              component="span"
              sx={{ display: 'flex', alignItems: 'center', gap: 1, minHeight: '1lh' }}
            >
              <Box
                component="span"
                aria-hidden="true"
                sx={{
                  ...CATEGORY_SWATCH_SX,
                  color: categoryColorMap.get(selectedCategories[0]),
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
                {categoryLabelOf(selectedCategories[0])}
              </Box>
            </Box>
          ) : (
            `${selectedCategories.length} selected`
          ),
        SelectDisplayProps: { title: selectedCategories.map(categoryLabelOf).join(', ') },
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
          indeterminate={!allSelected && selectedCategories.length > 0}
          tabIndex={-1}
          inputProps={{ 'aria-hidden': true }}
        />
        All
      </MenuItem>
      {options.map(({ key, value, label }) => (
        <MenuItem key={value} value={value}>
          <Checkbox
            size="small"
            checked={selectedCategories.includes(key)}
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
