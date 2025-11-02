export type RawMsg = any;

export function normalizeRole(author?: any): 'user'|'assistant'|'tool'|'system' {
  const r = author?.role || author || "";
  if (/^user$/i.test(r)) return 'user';
  if (/^(assistant|gpt)$/i.test(r)) return 'assistant';
  if (/tool/i.test(r)) return 'tool';
  return 'system';
}

export function normalizeText(msg: RawMsg): string {
  const m = msg?.message || msg;

  // 1) new array-of-parts
  if (Array.isArray(m?.content)) {
    const parts = m.content.map((p:any) => {
      if (typeof p === 'string') return p;
      if (p?.type === 'text' && typeof p?.text === 'string') return p.text;
      if (p?.type === 'input_text' && p?.text) return p.text;
      if (p?.type === 'tool_result' && p?.content) {
        return typeof p.content === 'string' ? p.content : JSON.stringify(p.content);
      }
      return JSON.stringify(p);
    });
    return parts.join('\n\n').trim();
  }

  // 2) legacy parts[]
  if (Array.isArray(m?.content?.parts)) {
    return m.content.parts.join('\n\n').trim();
  }

  // 3) plain string
  if (typeof m?.content === 'string') return m.content;

  // 4) fallbacks
  if (typeof m?.text === 'string') return m.text;
  return '';
}

// robust conversation walker (for conversations.json)
export function extractMessagesFromConversation(conv:any){
  const out: {id:string, convId:string, convTitle:string, role:'user'|'assistant'|'tool'|'system', ts:number, text:string}[] = [];
  const convId = conv?.id || conv?.conversation_id || cryptoRandom();
  const convTitle = conv?.title || '(untitled)';

  const mapping = conv?.mapping; // ChatGPT export tree
  if (mapping && typeof mapping === 'object') {
    for (const nodeId of Object.keys(mapping)) {
      const node = mapping[nodeId];
      const m = node?.message;
      if (!m) continue;

      const role = normalizeRole(m?.author);
      const text = normalizeText(node);
      const ts = (m?.create_time ? m.create_time*1000 : Date.parse(m?.update_time || m?.create_time || '')) || 0;

      if (text) out.push({ id: nodeId, convId, convTitle, role, ts, text });
    }
    return out.sort((a,b)=>a.ts-b.ts);
  }

  // fallback: messages array
  const msgs = conv?.messages || [];
  for (const m of msgs){
    const role = normalizeRole(m?.author);
    const text = normalizeText(m);
    const ts = (m?.create_time ? m.create_time*1000 : Date.parse(m?.update_time || m?.create_time || '')) || 0;
    if (text) out.push({ id: m.id || cryptoRandom(), convId, convTitle, role, ts, text });
  }
  return out.sort((a,b)=>a.ts-b.ts);
}

function cryptoRandom(){ return Math.random().toString(36).slice(2,10); }







