import { useEffect, useRef, useState } from 'react';
import Editor, { DiffEditor } from '@monaco-editor/react';
import { configureMonacoYaml } from 'monaco-yaml';
import * as jsYaml from 'js-yaml';

const { Box, Button, Alert, Typography, Chip } =
  (window as any).pluginLib?.MuiCore ?? {};

// ── YAML language server (module-level singleton) ─────────────────────────────

// One configureMonacoYaml instance shared across all editors; use .update() to
// swap schemas rather than calling configureMonacoYaml again (docs requirement).
let monacoYamlInst: ReturnType<typeof configureMonacoYaml> | null = null;

// path → inline JSON Schema; kept in sync with monacoYamlInst via syncSchemas()
const schemaRegistry = new Map<string, object>();

// Increment to give each schema-bound editor a stable unique path
let editorCounter = 0;

function initMonacoYaml(monaco: any) {
  if (monacoYamlInst) return;
  // Don't patch MonacoEnvironment — Headlamp already runs monaco-yaml internally
  // and has the yaml worker registered. Just configure the language features.
  monacoYamlInst = configureMonacoYaml(monaco, {
    validate: true,
    hover: true,
    completion: true,
    format: true,
    enableSchemaRequest: false,
    schemas: [],
  });
}

function syncSchemas() {
  if (!monacoYamlInst) return;
  monacoYamlInst.update({
    schemas: Array.from(schemaRegistry.entries()).map(([path, schema]) => ({
      // '**/*.yaml' matches any inmemory://model/*.yaml URI Monaco creates
      fileMatch: ['**/*.yaml'],
      uri: `https://crossplane-headlamp-plugin/schemas/${path}.json`,
      schema,
    })),
  });
}

// ── Editor options ────────────────────────────────────────────────────────────

const EDITOR_OPTIONS = {
  minimap: { enabled: false },
  scrollBeyondLastLine: false,
  fontSize: 13,
  lineHeight: 20,
  fontFamily: "'JetBrains Mono', 'Fira Code', Menlo, monospace",
  fontLigatures: true,
  padding: { top: 12, bottom: 12 },
  scrollbar: { verticalScrollbarSize: 6, horizontalScrollbarSize: 6 },
  overviewRulerLanes: 0,
  renderLineHighlight: 'gutter' as const,
  bracketPairColorization: { enabled: true },
  autoIndent: 'full' as const,
  tabSize: 2,
  quickSuggestions: { other: true, comments: false, strings: true },
};

const DIFF_OPTIONS = {
  ...EDITOR_OPTIONS,
  readOnly: true,
  renderSideBySide: true,
  enableSplitViewResizing: true,
  diffWordWrap: 'on' as const,
  renderOverviewRuler: false,
  ignoreTrimWhitespace: false,
};

// ── Types ─────────────────────────────────────────────────────────────────────

type Stage = 'view' | 'edit' | 'review';

interface YamlEditorProps {
  item: any;
  onSave: (obj: any) => Promise<void>;
  readOnly?: boolean;
  initialStage?: Stage;
  /** Optional JSON Schema for inline validation, hover docs, and autocomplete. */
  schema?: object;
}

// ── Component ─────────────────────────────────────────────────────────────────

export function YamlEditor({ item, onSave, readOnly = false, initialStage, schema }: YamlEditorProps) {
  const originalYaml = jsYaml.dump(item);
  const [stage, setStage] = useState<Stage>(initialStage ?? 'view');
  const [value, setValue] = useState(originalYaml);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const editorRef = useRef<any>(null);

  // Stable per-instance path; schema-bound editors get a unique path so their
  // fileMatch doesn't collide with other open editors.
  const editorPath = useRef(schema ? `crd-resource-${++editorCounter}.yaml` : 'resource.yaml');

  // Register / update / clean up schema in the global registry
  useEffect(() => {
    if (!schema) return;
    const path = editorPath.current;
    schemaRegistry.set(path, schema);
    syncSchemas();
    return () => {
      schemaRegistry.delete(path);
      syncSchemas();
    };
  }, [schema]);

  // Reset when item changes externally
  useEffect(() => {
    setValue(jsYaml.dump(item));
    setStage(initialStage ?? 'view');
    setSaveError(null);
    setSaveSuccess(false);
  }, [item]); // eslint-disable-line react-hooks/exhaustive-deps

  const isDirty = value !== originalYaml;
  const isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const theme = isDark ? 'vs-dark' : 'vs';

  function handleBeforeMount(monaco: any) {
    // Initialize the YAML language server (no-op after first call)
    initMonacoYaml(monaco);
    // If a schema was registered before this editor mounted, push it now
    if (schema) syncSchemas();
  }

  function handleDiscard() {
    setValue(originalYaml);
    setStage('view');
    setSaveError(null);
  }

  async function handleSave() {
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    try {
      const parsed = jsYaml.load(value);
      await onSave(parsed);
      setSaveSuccess(true);
      setStage('view');
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

  // ── Toolbar ────────────────────────────────────────────────────────────────

  const toolbar = (
    <Box display="flex" alignItems="center" justifyContent="space-between"
      style={{ padding: '8px 12px', borderBottom: '1px solid var(--border, #e0e0e0)', flexShrink: 0, minHeight: 44 }}>

      <Box display="flex" alignItems="center" gap={1}>
        {stage === 'view' && (
          <Typography variant="caption" color="textSecondary" style={{ fontSize: 11, letterSpacing: 0.5 }}>
            READ-ONLY
          </Typography>
        )}
        {stage === 'edit' && (
          <>
            <Typography variant="caption" style={{ fontSize: 11, letterSpacing: 0.5, color: '#1565c0', fontWeight: 700 }}>
              EDITING
            </Typography>
            {isDirty && (
              <Chip label="unsaved changes" size="small"
                style={{ fontSize: 10, height: 18, background: 'rgba(21,101,192,0.1)', color: '#1565c0' }} />
            )}
          </>
        )}
        {stage === 'review' && (
          <Typography variant="caption" style={{ fontSize: 11, letterSpacing: 0.5, color: '#2e7d32', fontWeight: 700 }}>
            REVIEWING CHANGES
          </Typography>
        )}
      </Box>

      <Box display="flex" alignItems="center" gap={1}>
        {stage === 'view' && !readOnly && (
          <Button size="small" variant="outlined" onClick={() => setStage('edit')}
            style={{ fontSize: 12, padding: '3px 14px' }}>
            Edit
          </Button>
        )}

        {stage === 'edit' && (
          <>
            <Button size="small" variant="text" onClick={handleFormat}
              style={{ fontSize: 12, padding: '3px 10px', color: '#555' }}>
              Format
            </Button>
            <Button size="small" variant="outlined" onClick={handleDiscard}
              style={{ fontSize: 12, padding: '3px 14px' }}>
              Discard
            </Button>
            <Button size="small" variant="contained" disabled={!isDirty}
              onClick={() => setStage('review')}
              style={{ fontSize: 12, padding: '3px 14px' }}>
              Review Changes
            </Button>
          </>
        )}

        {stage === 'review' && (
          <>
            <Button size="small" variant="outlined" onClick={() => setStage('edit')}
              style={{ fontSize: 12, padding: '3px 14px' }}>
              ← Back to Edit
            </Button>
            <Button size="small" variant="contained" disabled={saving} onClick={handleSave}
              style={{ fontSize: 12, padding: '3px 14px', background: '#2e7d32' }}>
              {saving ? 'Saving…' : 'Confirm & Save'}
            </Button>
          </>
        )}
      </Box>
    </Box>
  );

  // ── Editor area ────────────────────────────────────────────────────────────

  return (
    <Box display="flex" flexDirection="column" style={{ height: '100%', minHeight: 520 }}>
      {toolbar}

      {saveError && (
        <Alert severity="error" style={{ margin: '8px 12px 0', flexShrink: 0 }}
          onClose={() => setSaveError(null)}>
          {saveError}
        </Alert>
      )}
      {saveSuccess && (
        <Alert severity="success" style={{ margin: '8px 12px 0', flexShrink: 0 }}>
          Saved successfully.
        </Alert>
      )}

      <Box style={{ flex: 1, overflow: 'hidden' }}>
        {stage === 'review' ? (
          <DiffEditor
            height="100%"
            language="yaml"
            original={originalYaml}
            modified={value}
            theme={theme}
            options={DIFF_OPTIONS}
            beforeMount={handleBeforeMount}
          />
        ) : (
          <Editor
            height="100%"
            defaultLanguage="yaml"
            value={value}
            theme={theme}
            path={editorPath.current}
            options={{ ...EDITOR_OPTIONS, readOnly: stage === 'view' }}
            onChange={(v) => setValue(v ?? '')}
            onMount={(editor) => { editorRef.current = editor; }}
            beforeMount={handleBeforeMount}
          />
        )}
      </Box>
    </Box>
  );
}
