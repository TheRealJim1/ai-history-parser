import type { ParsedMsg } from "./chatgptParse";

export type ConvRow = {
  convId: string; 
  title: string; 
  vendor: 'CHATGPT';
  msgCount: number; 
  firstTs: number; 
  lastTs: number;
};

export function buildConvIndex(msgs: ParsedMsg[]): ConvRow[] {
  const map = new Map<string, ConvRow>();
  for (const m of msgs) {
    let r = map.get(m.convId);
    if (!r) {
      r = { 
        convId: m.convId, 
        title: m.convTitle || '(untitled)', 
        vendor: 'CHATGPT',
        msgCount: 0, 
        firstTs: m.ts, 
        lastTs: m.ts 
      };
      map.set(m.convId, r);
    }
    r.msgCount++;
    if (m.ts < r.firstTs) r.firstTs = m.ts;
    if (m.ts > r.lastTs) r.lastTs = m.ts;
  }
  return [...map.values()].sort((a,b)=> b.lastTs - a.lastTs);
}







