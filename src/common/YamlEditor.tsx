import { useEffect, useRef, useState } from 'react';
import Editor, { DiffEditor, useMonaco } from '@monaco-editor/react';
import { configureMonacoYaml } from 'monaco-yaml';
import * as jsYaml from 'js-yaml';

const { Box, Button, Alert, Typography, Chip } =
  (window as any).pluginLib?.MuiCore ?? {};

// ── Kubernetes schema wiring ──────────────────────────────────────────────────

let schemaConfigured = false;

function useKubernetesSchema(monaco: any) {
  useEffect(() => {
    if (!monaco || schemaConfigured) return;
    schemaConfigured = true;
    configureMonacoYaml(monaco, {
      enableSchemaRequest: true,
      schemas: [{
        fileMatch: ['resource.yaml'],
        uri: 'https://raw.githubusercontent.com/yannh/kubernetes-json-schema/master/v1.30.0-standalone-strict/all.json',
      }],
    });
  }, [monaco]);
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
}

// ── Component ─────────────────────────────────────────────────────────────────

export function YamlEditor({ item, onSave, readOnly = false, initialStage }: YamlEditorProps) {
  const monaco = useMonaco();
  useKubernetesSchema(monaco);

  const originalYaml = jsYaml.dump(item);
  const [stage, setStage] = useState<Stage>(initialStage ?? 'view');
  const [value, setValue] = useState(originalYaml);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const editorRef = useRef<any>(null);

  // Reset when item changes externally
  useEffect(() => {
    setValue(jsYaml.dump(item));
    setStage('view');
    setSaveError(null);
    setSaveSuccess(false);
  }, [item]);

  const isDirty = value !== originalYaml;
  const isDark = window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  const theme = isDark ? 'vs-dark' : 'vs';

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

      {/* Left: stage indicator */}
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

      {/* Right: actions */}
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
              style={{ fontSize: 12, padding: '3px 14px', background: isDirty ? '#1565c0' : undefined }}>
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
          />
        ) : (
          <Editor
            height="100%"
            defaultLanguage="yaml"
            value={value}
            theme={theme}
            path="resource.yaml"
            options={{ ...EDITOR_OPTIONS, readOnly: stage === 'view' }}
            onChange={(v) => setValue(v ?? '')}
            onMount={(editor) => { editorRef.current = editor; }}
          />
        )}
      </Box>
    </Box>
  );
}
