import { useEffect, useRef, useState } from 'react';
import Editor, { DiffEditor, useMonaco } from '@monaco-editor/react';
import { configureMonacoYaml } from 'monaco-yaml';
import * as jsYaml from 'js-yaml';

const { Box, Button, Alert, Typography, ToggleButton, ToggleButtonGroup } =
  (window as any).pluginLib?.MuiCore ?? {};

// ── Kubernetes schema wiring ──────────────────────────────────────────────────

let schemaConfigured = false;

function useKubernetesSchema(monaco: any) {
  useEffect(() => {
    if (!monaco || schemaConfigured) return;
    schemaConfigured = true;

    configureMonacoYaml(monaco, {
      enableSchemaRequest: true,
      schemas: [
        {
          // Matches all YAML files in this "virtual" path
          fileMatch: ['**/*.yaml', '**/*.yml', 'resource.yaml'],
          // Kubernetes JSON schema — fetched at runtime, nothing bundled
          uri: 'https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/v1.30.0-standalone-strict/all.json',
        },
      ],
    });
  }, [monaco]);
}

// ── Shared editor options ─────────────────────────────────────────────────────

const BASE_OPTIONS = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 13,
  lineHeight: 20,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
  fontLigatures: true,
  padding: { top: 12, bottom: 12 },
  scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
  overviewRulerLanes: 0,
  renderLineHighlight: 'gutter' as const,
  bracketPairColorization: { enabled: true },
  formatOnPaste: true,
  autoIndent: 'full' as const,
  tabSize: 2,
};

// ── Main component ────────────────────────────────────────────────────────────

interface YamlEditorProps {
  item: any;
  onSave: (obj: any) => Promise<void>;
  readOnly?: boolean;
}

type ViewMode = 'edit' | 'diff';

export function YamlEditor({ item, onSave, readOnly = false }: YamlEditorProps) {
  const monaco = useMonaco();
  useKubernetesSchema(monaco);

  const originalYaml = jsYaml.dump(item);
  const [value, setValue] = useState(originalYaml);
  const [mode, setMode] = useState<ViewMode>('edit');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const editorRef = useRef<any>(null);

  // Reset when item changes externally
  useEffect(() => {
    setValue(jsYaml.dump(item));
    setSaveError(null);
    setSaveSuccess(false);
  }, [item]);

  // Determine theme from Headlamp's active theme
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark'
    || document.body.classList.contains('dark-theme')
    || window.matchMedia?.('(prefers-color-scheme: dark)').matches;

  const monacoTheme = isDark ? 'vs-dark' : 'vs';

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const parsed = jsYaml.load(value);
      await onSave(parsed);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (e: any) {
      setSaveError(String(e?.message ?? e));
    } finally {
      setSaving(false);
    }
  }

  function handleFormat() {
    editorRef.current?.getAction('editor.action.formatDocument')?.run();
  }

  const isDirty = value !== originalYaml;

  return (
    <Box display="flex" flexDirection="column" style={{ height: '100%', minHeight: 500 }}>
      {/* Toolbar */}
      <Box display="flex" alignItems="center" justifyContent="space-between"
        style={{ padding: '8px 12px', borderBottom: '1px solid #e0e0e0', flexShrink: 0 }}>
        <Box display="flex" alignItems="center" gap={1}>
          {!readOnly && (
            <ToggleButtonGroup
              value={mode}
              exclusive
              size="small"
              onChange={(_: any, v: ViewMode | null) => { if (v) setMode(v); }}
            >
              <ToggleButton value="edit" style={{ padding: '2px 12px', fontSize: 12 }}>Edit</ToggleButton>
              <ToggleButton value="diff" style={{ padding: '2px 12px', fontSize: 12 }} disabled={!isDirty}>
                Changes{isDirty ? ' ●' : ''}
              </ToggleButton>
            </ToggleButtonGroup>
          )}
        </Box>
        <Box display="flex" alignItems="center" gap={1}>
          {!readOnly && (
            <Button size="small" variant="outlined" onClick={handleFormat}
              style={{ fontSize: 11, padding: '2px 10px' }}>
              Format
            </Button>
          )}
          {!readOnly && (
            <Button size="small" variant="contained" disabled={saving || !isDirty}
              onClick={handleSave} style={{ fontSize: 11, padding: '2px 10px' }}>
              {saving ? 'Saving…' : 'Save'}
            </Button>
          )}
        </Box>
      </Box>

      {/* Alerts */}
      {saveError && (
        <Alert severity="error" style={{ margin: '8px 12px 0', flexShrink: 0 }}>{saveError}</Alert>
      )}
      {saveSuccess && (
        <Alert severity="success" style={{ margin: '8px 12px 0', flexShrink: 0 }}>Saved successfully.</Alert>
      )}

      {/* Editor */}
      <Box style={{ flex: 1, overflow: 'hidden' }}>
        {mode === 'edit' ? (
          <Editor
            height="100%"
            defaultLanguage="yaml"
            value={value}
            theme={monacoTheme}
            path="resource.yaml"
            options={{ ...BASE_OPTIONS, readOnly }}
            onChange={(v) => setValue(v ?? '')}
            onMount={(editor) => { editorRef.current = editor; }}
          />
        ) : (
          <DiffEditor
            height="100%"
            language="yaml"
            original={originalYaml}
            modified={value}
            theme={monacoTheme}
            options={{
              ...BASE_OPTIONS,
              readOnly: true,
              renderSideBySide: true,
              enableSplitViewResizing: true,
              // GitHub-style: word-level diff highlighting
              diffWordWrap: 'on',
              renderOverviewRuler: false,
              ignoreTrimWhitespace: false,
            }}
          />
        )}
      </Box>
    </Box>
  );
}
