import type { Graph, GraphNode, GraphEdge, GraphBuildOptions } from '../types/graph';
import { fnv1a, slugify } from '../lib/hash';
import { extractTopics } from '../lib/topics';

interface Message {
  id: string;               // stable id already in your app
  role: 'user'|'assistant'|'tool'|'system';
  text: string;
  ts: number;               // epoch ms
  convId: string;           // conversation id
  convTitle: string;
  sourceId: string;         // folder/source
}

export function buildGraph(msgs: Message[], opts: GraphBuildOptions): Graph {
  const g: Graph = { nodes: new Map(), edges: [] };
  const CW = Math.max(2, opts.contextWindow ?? 8);

  const sorted = msgs
    .filter(m => (!opts.dateFrom || m.ts >= opts.dateFrom) && (!opts.dateTo || m.ts <= opts.dateTo))
    .sort((a, b) => a.ts - b.ts);

  const ensureNode = (id: string, node: Omit<GraphNode, 'id'>) => {
    if (!g.nodes.has(id)) g.nodes.set(id, { id, ...node });
    return g.nodes.get(id)!;
  };

  const pushEdge = (e: GraphEdge) => {
    g.edges.push(e);
  };

  // conversation nodes
  const convIndex = new Map<string, string>();
  for (const m of sorted) {
    let cid = convIndex.get(m.convId);

    if (!cid) {
      const title = m.convTitle || `Conversation ${m.convId.slice(0, 6)}`;
      cid = `c_${fnv1a(`${m.sourceId}:${m.convId}`)}`;
      convIndex.set(m.convId, cid);
      ensureNode(cid, { 
        kind: 'conversation', 
        title, 
        slug: slugify(title), 
        meta: { sourceId: m.sourceId } 
      });
    }
  }

  // optional project per conversation title
  const projectForConv = new Map<string, string>();
  if (opts.projectDetector) {
    for (const [convId, cid] of convIndex) {
      const title = g.nodes.get(cid)!.title;
      const match = title.match(opts.projectDetector);
      if (match) {
        const projTitle = match[0];
        const pid = `p_${fnv1a(projTitle)}`;
        ensureNode(pid, { kind: 'project', title: projTitle, slug: slugify(projTitle) });
        projectForConv.set(convId, pid);
        pushEdge({ from: cid, to: pid, kind: 'belongsTo', weight: 1 });
      }
    }
  }

  // walk in chunks
  for (let i = 0; i < sorted.length; i += CW) {
    const chunk = sorted.slice(i, i + CW);
    if (!chunk.length) continue;

    const convId = chunk[0].convId;
    const cid = convIndex.get(convId)!;

    // messageChunk node per window
    const chunkTitle = `${g.nodes.get(cid)!.title} · ${new Date(chunk[0].ts).toLocaleString()}`;
    const chunkId = `m_${fnv1a(chunk.map(m => m.id).join('|'))}`;
    ensureNode(chunkId, { 
      kind: 'messageChunk', 
      title: chunkTitle, 
      slug: slugify(chunkTitle), 
      meta: { convId } 
    });
    pushEdge({ from: cid, to: chunkId, kind: 'sameThreadAs', weight: 1 });

    // extract topics from combined text
    const text = chunk.map(m => m.text).join('\n');
    const topics = extractTopics(text, Math.min(opts.maxTopicsPerChunk ?? 8, 12));
    
    for (const t of topics) {
      const tSlug = slugify(t);
      const tid = `t_${fnv1a(t)}`;
      ensureNode(tid, { kind: 'topic', title: t, slug: tSlug });
      pushEdge({ from: chunkId, to: tid, kind: 'hasTopic', weight: 1 });
      pushEdge({ from: cid, to: tid, kind: 'mentions', weight: 0.25 });
      
      const proj = projectForConv.get(convId);
      if (proj) pushEdge({ from: tid, to: proj, kind: 'affiliatedWith', weight: 0.25 });
    }
  }

  return g;
}
