
import type { Vault, TFile } from 'obsidian';
import type { Conv, Msg } from './types';

export async function listJsonFiles(vault: Vault, folder: string): Promise<TFile[]> {
  const out: TFile[] = [];
  const prefix = folder.endsWith('/') ? folder : folder + '/';
  // @ts-ignore
  vault.getFiles().forEach((f: TFile) => {
    if (f.path.startsWith(prefix) && f.extension.toLowerCase() === 'json') out.push(f);
  });
  return out;
}

async function readJson<T=any>(vault: Vault, file: TFile): Promise<T | null> {
  try { const raw = await vault.read(file); return JSON.parse(raw) as T; } catch { return null; }
}

// Reconstruct ChatGPT-style message mapping
function mappingToMsgs(mapping: any): Msg[] {
  const byId: Record<string, any> = mapping || {};
  const roots = Object.values(byId).filter((n: any) => !n.parent);
  const msgs: Msg[] = [];
  function walk(node: any) {
    if (!node) return;
    const msg = node.message;
    if (msg && msg.author) {
      const role = msg.author.role || 'user';
      const ts = (msg.create_time ? msg.create_time*1000 : Date.now());
      let text = '';
      if (Array.isArray(msg.content?.parts)) text = msg.content.parts.join('\n');
      else if (typeof msg.content === 'string') text = msg.content;
      msgs.push({ role, t: ts, text });
    }
    if (Array.isArray(node.children)) node.children.forEach((id: string) => walk(byId[id]));
  }
  roots.forEach(walk);
  return msgs.sort((a,b)=>a.t-b.t);
}

export async function indexConversations(vault: Vault, files: TFile[]): Promise<Conv[]> {
  const out: Conv[] = [];
  for (const f of files) {
    const js = await readJson<any>(vault, f);
    if (!js) continue;
    // Case 1: conversations.json (array with mapping)
    if (Array.isArray(js) && js.length && js[0]?.mapping) {
      for (const c of js) {
        const id = c.id || c.conversation_id || f.path;
        const title = c.title || '(untitled)';
        const last = (c.update_time ? c.update_time*1000 : Date.now());
        const msgs = mappingToMsgs(c.mapping);
        out.push({ id, title, last, msgs, source: 'chatgpt', blob: f.path });
      }
      continue;
    }
    // Case 2: single conversation object
    if (js?.mapping) {
      const id = js.id || js.conversation_id || f.path;
      const title = js.title || '(untitled)';
      const last = (js.update_time ? js.update_time*1000 : Date.now());
      const msgs = mappingToMsgs(js.mapping);
      out.push({ id, title, last, msgs, source: 'chatgpt', blob: f.path });
      continue;
    }
  }
  // Sort by last updated desc
  out.sort((a,b)=>b.last-a.last);
  return out;
}
