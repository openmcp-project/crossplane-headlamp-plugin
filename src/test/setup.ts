// Stub Headlamp globals that the plugin reads from window at import time.
// Individual tests can override these as needed.
(global as any).window = global;

(global as any).pluginLib = {
  MuiCore: {},
  ApiProxy: {
    request: () => Promise.resolve({ items: [] }),
  },
};

(global as any).headlampBaseUrl = '';
