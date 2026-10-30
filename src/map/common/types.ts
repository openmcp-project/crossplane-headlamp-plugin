export type ManagedInstance = {
  metadata?: { uid?: string; name?: string; namespace?: string };
  kind?: string;
  spec?: any;
  status?: { conditions?: Array<{ type: string; status: string }> };
  jsonData?: any;
  _kind?: string;
};

export type GraphNode = {
  id: string;
  kubeObject: any;
  status: 'success' | 'error';
  customResourceDefinition?: string;
  providerName?: string;
};
export type GraphEdge = { id: string; source: string; target: string; aux?: boolean };

export type ManagedResourceError = { crdName: string; namespace?: string; error: Error };

export type ManagedGraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
  error?: Error;
  resourceErrors: ManagedResourceError[];
};
