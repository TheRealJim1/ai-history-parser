import type { ParsedMsg } from "./chatgptParse";

export type Turn = {
  id: string; 
  role: ParsedMsg['role']; 
  vendor: 'CHATGPT';
  tsStart: number; 
  tsEnd: number;
  items: ParsedMsg[];
};

export function groupTurns(msgs: ParsedMsg[], gapMs = 7*60*1000): Turn[] {
  const m = [...msgs].sort((a,b)=>a.ts-b.ts);
  const out: Turn[] = [];
  let cur: Turn | undefined;

  for (const x of m) {
    const startNew = !cur || x.role !== cur.role || (x.ts - cur.tsEnd) > gapMs;
    if (startNew) {
      cur = { 
        id: `turn_${x.id}`, 
        role: x.role, 
        vendor: x.vendor, 
        tsStart: x.ts, 
        tsEnd: x.ts, 
        items: [x] 
      };
      out.push(cur);
    } else {
      cur.items.push(x);
      cur.tsEnd = x.ts;
    }
  }
  return out;
}
