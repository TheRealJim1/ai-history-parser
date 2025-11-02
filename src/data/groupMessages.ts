import type { Msg } from "./conversations";

export type Turn = {
  id: string;
  role: Msg['role'];
  vendor?: Msg['vendor'];
  tsStart: number;
  tsEnd: number;
  items: Msg[];
};

export type DayBucket = {
  day: string;            // YYYY-MM-DD
  turns: Turn[];
};

export function groupIntoTurns(msgs: Msg[], gapMs = 5*60*1000): Turn[] {
  const s = [...msgs].sort((a,b)=>(a.ts)-(b.ts));
  const out: Turn[] = [];
  let cur: Turn|undefined;

  for (const m of s) {
    const startNew = !cur || m.role !== cur.role || (m.ts - cur.tsEnd) > gapMs;

    if (startNew) {
      cur = { id: `turn_${m.id}`, role: m.role, vendor: m.vendor,
              tsStart: m.ts, tsEnd: m.ts, items: [m] };
      out.push(cur);
    } else {
      cur.items.push(m);
      cur.tsEnd = m.ts;
    }
  }
  return out;
}

export function bucketByDay(turns: Turn[]): DayBucket[] {
  const buckets = new Map<string, Turn[]>();
  for (const t of turns) {
    const d = new Date(t.tsStart);
    const key = `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
    (buckets.get(key) ?? buckets.set(key, []).get(key)!).push(t);
  }
  return [...buckets.entries()]
    .sort((a,b)=> new Date(a[0]).getTime() - new Date(b[0]).getTime())
    .map(([day, turns])=>({ day, turns }));
}







