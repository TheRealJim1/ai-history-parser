export type NodeID = string;

export type NodeKind = 'conversation'|'messageChunk'|'topic'|'person'|'tag'|'project';
export type EdgeKind = 'hasTopic'|'mentions'|'sameThreadAs'|'belongsTo'|'affiliatedWith';

export interface GraphNode {
  id: NodeID;
  kind: NodeKind;
  title: string;
  slug: string;           // fs-safe
  meta?: Record<string, any>;
}

export interface GraphEdge {
  from: NodeID;
  to: NodeID;
  kind: EdgeKind;
  weight: number;         // accumulate weights across passes
}

export interface Graph {
  nodes: Map<NodeID, GraphNode>;
  edges: GraphEdge[];
}

export interface GraphBuildOptions {
  contextWindow: number;         // msgs per chunk (default 8)
  minTopicLen: number;           // tokens
  maxTopicsPerChunk: number;     // cap per chunk
  projectDetector?: RegExp;      // /Health\-Radiculopathy\-EMR/i
  dateFrom?: number;
  dateTo?: number;
}
