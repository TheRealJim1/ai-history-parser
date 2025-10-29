import { App, normalizePath, TFile, TFolder } from 'obsidian';
import type { Graph } from '../types/graph';

export interface WriteOptions {
  baseDir: string;  // '/_ai-graph'
  sampleOnly?: boolean;
}

export async function ensureFolder(app: App, path: string): Promise<TFolder> {
  const norm = normalizePath(path);
  const exists = app.vault.getAbstractFileByPath(norm);
  if (exists instanceof TFolder) return exists;
  if (exists) await app.vault.delete(exists);
  await app.vault.createFolder(norm);
  return app.vault.getAbstractFileByPath(norm) as TFolder;
}

export async function writeGraph(app: App, g: Graph, opt: WriteOptions) {
  const base = normalizePath(opt.baseDir);
  await ensureFolder(app, base);
  await ensureFolder(app, `${base}/projects`);
  await ensureFolder(app, `${base}/topics`);
  await ensureFolder(app, `${base}/conversations`);

  const write = async (path: string, body: string) => {
    const norm = normalizePath(path);
    const f = app.vault.getAbstractFileByPath(norm);
    if (f instanceof TFile) await app.vault.modify(f, body);
    else await app.vault.create(norm, body);
  };

  // write index json
  await write(`${base}/graph${opt.sampleOnly ? '.sample' : ''}.json`,
    JSON.stringify({ nodes: [...g.nodes.values()], edges: g.edges }, null, 2));

  // markdown nodes
  const nodes = [...g.nodes.values()];
  const edgesByFrom = new Map<string, string[]>();
  for (const e of g.edges) {
    const arr = edgesByFrom.get(e.from) ?? [];
    arr.push(e.to); 
    edgesByFrom.set(e.from, arr);
  }

  for (const n of nodes) {
    const dir = n.kind === 'topic' ? 'topics' : 
                n.kind === 'conversation' ? 'conversations' :
                n.kind === 'project' ? 'projects' : 'conversations'; // chunk notes sit with convs
    
    const links = (edgesByFrom.get(n.id) || [])
      .map(id => g.nodes.get(id))
      .filter(Boolean)
      .map(t => `- [[${dirFor(t!.kind)}/${t!.slug}|${t!.title}]]`)
      .join('\n');

    const fm = [
      '---',
      `kind: ${n.kind}`,
      `slug: ${n.slug}`,
      (n.meta?.sourceId ? `source: ${n.meta.sourceId}` : ''),
      '---'
    ].filter(Boolean).join('\n');

    const body = `${fm}\n# ${n.title}\n\n## Links\n${links || '_none_'}\n`;
    await write(`${base}/${dir}/${n.slug}.md`, body);
  }

  function dirFor(k: string) { 
    return k === 'topic' ? 'topics' : k === 'project' ? 'projects' : 'conversations'; 
  }
}

export async function resetGraph(app: App, baseDir: string) {
  const base = normalizePath(baseDir);
  const f = app.vault.getAbstractFileByPath(base);
  if (f) await app.vault.delete(f, true);
}

