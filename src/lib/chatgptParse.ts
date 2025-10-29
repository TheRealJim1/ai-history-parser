export type Role = 'user'|'assistant'|'tool'|'system';

export interface ParsedMsg {
  id: string;
  convId: string;
  convTitle: string;
  role: Role;
  ts: number;          // epoch ms
  text: string;        // flattened content
  vendor: 'CHATGPT';
}

/* ---------- content flatteners ---------- */

function flattenBlocks(content: any): string {
  // v2: array of content blocks
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const b of content) {
      try {
        if (typeof b === 'string') { parts.push(b); continue; }
        const t = (b?.type || '').toLowerCase();
        if ((t === 'text' || t === 'output_text' || t === 'input_text') && b?.text) {
          parts.push(String(b.text));
        } else if (t === 'tool_result') {
          // tool results can be text or structured
          if (typeof b.content === 'string') parts.push(b.content);
          else if (Array.isArray(b.content)) {
            for (const c of b.content) {
              if (typeof c === 'string') parts.push(c);
              else if (c?.type === 'text' && c?.text) parts.push(c.text);
              else parts.push('```json\n' + JSON.stringify(c, null, 2) + '\n```');
            }
          } else if (b?.content) {
            parts.push('```json\n' + JSON.stringify(b.content, null, 2) + '\n```');
          }
        } else if (t.includes('image')) {
          // emit a placeholder so we don't drop messages
          parts.push(`![image:${b?.id || b?.name || 'asset'}]`);
        } else if (b?.text) {
          parts.push(String(b.text));
        } else {
          parts.push('```json\n' + JSON.stringify(b, null, 2) + '\n```');
        }
      } catch (e) {
        parts.push('[[unparsed block]]');
      }
    }
    return parts.join('\n\n').trim();
  }

  // v1: {content_type:'text', parts:[...]}
  if (content?.parts && Array.isArray(content.parts)) {
    return content.parts.map((x:any)=> typeof x === 'string' ? x : JSON.stringify(x)).join('\n\n').trim();
  }

  if (typeof content === 'string') return content;
  if (content?.text) return String(content.text);
  return '';
}

function normRole(r: any): Role {
  const x = (r?.role || r || '').toLowerCase();
  if (x === 'user') return 'user';
  if (x === 'assistant' || x === 'gpt') return 'assistant';
  if (x.includes('tool')) return 'tool';
  return 'system';
}

/* ---------- mapping path extraction ---------- */

function choosePath(mapping: Record<string, any>, currentNode?: string): string[] {
  // Prefer the exact path to currentNode (ChatGPT's visible run)
  if (currentNode && mapping[currentNode]) {
    const path: string[] = [];
    let n: any = mapping[currentNode];
    while (n) { path.push(n.id || currentNode); n = n.parent ? mapping[n.parent] : null; }
    return path.reverse();
  }

  // Fallback: find the latest leaf and walk up
  let leaf: any = null;
  for (const id in mapping) {
    const node = mapping[id];
    const hasMessage = !!node?.message;
    if (!hasMessage) continue;
    const isLeaf = !node.children || node.children.length === 0;
    if (isLeaf) {
      if (!leaf) leaf = node;
      else {
        const a = (node.message?.create_time ?? 0);
        const b = (leaf.message?.create_time ?? 0);
        if (a > b) leaf = node;
      }
    }
  }

  const path: string[] = [];
  let n = leaf;
  while (n) { path.push(n.id); n = n.parent ? mapping[n.parent] : null; }
  return path.reverse();
}

/* ---------- main extractor ---------- */

export function extractChatGPTConversation(conv: any): ParsedMsg[] {
  const convId = conv?.id || conv?.conversation_id || crypto();
  const convTitle = conv?.title || '(untitled)';
  const out: ParsedMsg[] = [];

  const mapping = conv?.mapping;
  if (mapping && typeof mapping === 'object') {
    const path = choosePath(mapping, conv?.current_node);
    for (const id of path) {
      const node = mapping[id];
      const msg = node?.message;
      if (!msg) continue;

      const role = normRole(msg.author);
      const text = flattenBlocks(msg.content);
      const ts = (msg.create_time ? msg.create_time*1000
                : Date.parse(msg.update_time || msg.create_time || '')) || 0;

      // Keep empty system/tool messages if you want; here we require text
      if (text || role !== 'assistant') {
        out.push({ id, convId, convTitle, role, ts, text, vendor:'CHATGPT' });
      }
    }
    return out.sort((a,b)=> a.ts - b.ts);
  }

  // fallback shape: conv.messages[]
  const msgs = Array.isArray(conv?.messages) ? conv.messages : [];
  for (const m of msgs) {
    const role = normRole(m?.author);
    const text = flattenBlocks(m?.content);
    const ts = (m?.create_time ? m.create_time*1000 : Date.parse(m?.update_time || m?.create_time || '')) || 0;
    if (text || role !== 'assistant') out.push({ id: m.id || crypto(), convId, convTitle, role, ts, text, vendor:'CHATGPT' });
  }
  return out.sort((a,b)=> a.ts - b.ts);
}

function crypto(){ return Math.random().toString(36).slice(2,10); }
