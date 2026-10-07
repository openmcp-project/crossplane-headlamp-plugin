import * as jsYaml from 'js-yaml';
import { isDarkMode } from './crdTheme';

const { Editor: MonacoEditor } = (window as any).pluginLib?.ReactMonacoEditor ?? {};
const { Button } = (window as any).pluginLib?.MuiCore ?? {};

export function YamlSection({ item }: { item: any }) {
  const yaml = jsYaml.dump(item);
  const dark = isDarkMode();
  if (MonacoEditor) {
    return (
      <MonacoEditor
        language="yaml"
        theme={dark ? 'vs-dark' : 'light'}
        value={yaml}
        options={{
          readOnly: true,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          wordWrap: 'on',
        }}
        height="600px"
      />
    );
  }
  return (
    <pre
      style={{
        overflow: 'auto',
        borderRadius: 4,
        padding: 12,
        fontSize: 12,
        margin: 0,
        maxHeight: 600,
        background: dark ? '#1e1e1e' : '#f5f5f5',
        color: dark ? '#d4d4d4' : 'inherit',
      }}
    >
      {yaml}
    </pre>
  );
}

export function openResourceYaml(item: any) {
  const Activity = (window as any).pluginLib?.Activity;
  const EditorDialog = (window as any).pluginLib?.CommonComponents?.EditorDialog;
  if (!Activity?.launch || !EditorDialog) {
    console.warn('Native EditorDialog/Activity not available in this Headlamp version');
    return;
  }
  const id = `yaml-${item?.metadata?.uid ?? item?.metadata?.name ?? 'resource'}`;
  Activity.launch({
    id,
    location: 'split-right',
    temporary: true,
    title: `YAML · ${item?.metadata?.name ?? ''}`,
    content: (
      <EditorDialog
        noDialog
        item={item}
        open
        allowToHideManagedFields
        onSave={null}
        onClose={() => Activity.close(id)}
      />
    ),
  });
}

export function ViewYamlButton({ item }: { item: any }) {
  return (
    <Button variant="outlined" size="small" onClick={() => openResourceYaml(item)}>
      View YAML
    </Button>
  );
}
