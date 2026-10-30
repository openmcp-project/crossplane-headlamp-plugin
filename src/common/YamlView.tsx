import { Activity } from '@kinvolk/headlamp-plugin/lib';
import { EditorDialog } from '@kinvolk/headlamp-plugin/lib/CommonComponents';
import Editor from '@monaco-editor/react';
import { Button, useTheme } from '@mui/material';
import * as jsYaml from 'js-yaml';
import React, { useMemo } from 'react';

export function YamlSection({ item }: { item: any }) {
  const theme = useTheme();
  const dark = theme.palette.mode === 'dark';
  const yaml = useMemo(() => jsYaml.dump(item), [item]);

  return (
    <Editor
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

export function openResourceYaml(item: any) {
  if (!Activity?.launch) {
    console.warn('Native Activity not available in this Headlamp version');
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
