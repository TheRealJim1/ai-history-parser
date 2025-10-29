export type Msg = {
  id: string;
  convId: string;
  convTitle: string;
  role: 'user'|'assistant'|'tool'|'system';
  ts: number;
  text: string;
  vendor?: 'CHATGPT'|'CLAUDE'|'GEMINI'|'OTHER';
};

export type ConvRow = {
  convId: string;
  title: string;
  vendor: string;
  msgCount: number;
  firstTs: number;
  lastTs: number;
};

export function buildConversationIndex(messages: Msg[]): ConvRow[] {
  const map = new Map<string, ConvRow>();
  for (const m of messages) {
    let r = map.get(m.convId);
    if (!r) {
      r = { convId: m.convId, title: m.convTitle || '(untitled)',
            vendor: m.vendor || 'OTHER', msgCount: 0, firstTs: m.ts, lastTs: m.ts };
      map.set(m.convId, r);
    }
    r.msgCount += 1;
    if (m.ts < r.firstTs) r.firstTs = m.ts;
    if (m.ts > r.lastTs)  r.lastTs  = m.ts;
  }
  return [...map.values()].sort((a,b)=> b.lastTs - a.lastTs);
}
