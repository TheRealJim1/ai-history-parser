
import React from 'react';
import type { App as ObApp } from 'obsidian';
import { AHPDB } from '../db/sqlite';
import { indexFolderIntoDB } from '../controller/importFlow';

type Row = { id:number; ext_id:string; source:string; title:string; started_at:number; updated_at:number };

export default function App({ app }: { app: ObApp }) {
  const [dbPath, setDbPath] = React.useState('ahp-db/aihp.sqlite');
  const [folder, setFolder] = React.useState('chatgpt-export');
  const [source, setSource] = React.useState('chatgpt');
  const [query, setQuery] = React.useState('');
  const [flags, setFlags] = React.useState('i');

  const [db, setDb] = React.useState<AHPDB | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [picked, setPicked] = React.useState<{row?: Row, msgs?: any[]}>({});
  const [status, setStatus] = React.useState<string>('Idle');

  async function initDB() {
    setStatus('Opening DB…');
    const ahp = new AHPDB(app, dbPath);
    await ahp.open();
    await ahp.save();
    setDb(ahp);
    setStatus('DB ready');
  }

  async function runIndex() {
    if (!db) return;
    setStatus('Indexing…');
    const res = await indexFolderIntoDB(app, db, folder, source, `${source}-${new Date().toISOString()}`);
    setStatus(`Indexed ${res.inserted}/${res.count}.`);
    await refresh();
  }

  async function refresh() {
    if (!db) return;
    setStatus('Querying…');
    const rx = (()=>{ try { return query ? new RegExp(query, flags || 'i') : null; } catch { return null; } })();
    const list = db.selectConversations({ source: source || undefined, q: rx || undefined }) as Row[];
    setRows(list);
    if (list.length) {
      const msgs = db.getConversationBlob(list[0].id);
      setPicked({ row: list[0], msgs });
    } else setPicked({});
    setStatus(`Loaded ${list.length}`);
  }

  async function pickRow(r: Row) {
    if (!db) return;
    const msgs = db.getConversationBlob(r.id);
    setPicked({ row: r, msgs });
  }

  const [left, setLeft] = React.useState(360);
  function onDrag(e: React.MouseEvent) {
    const startX = e.clientX;
    const startLeft = left;
    function move(ev: MouseEvent) { setLeft(Math.max(260, startLeft + (ev.clientX - startX))); }
    function up() { window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up as any); }
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up as any);
  }

  return (
    <div style={{display:'flex', flexDirection:'column', height:'100%'}}>
      <div className="ahp-toolbar ahp-bg-card ahp-border ahp-border-card ahp-rounded-xl">
        <strong>AI History Parser (SPA + SQLite)</strong>
        <span className="ahp-text-normal">Status: {status}</span>
        <input className="ahp-in" style={{minWidth:240}} value={dbPath} onChange={e=>setDbPath(e.target.value)} placeholder="DB path" />
        <button className="ahp-btn" onClick={initDB}>Init DB</button>
        <input className="ahp-in" value={folder} onChange={e=>setFolder(e.target.value)} placeholder="export folder" />
        <select className="ahp-in" value={source} onChange={e=>setSource(e.target.value)}>
          <option value="chatgpt">ChatGPT</option>
          <option value="grok">Grok</option>
          <option value="claude">Claude</option>
          <option value="google">Google</option>
        </select>
        <button className="ahp-btn" onClick={runIndex}>Load & Index → DB</button>
        <input className="ahp-in" style={{minWidth:240}} value={query} onChange={e=>setQuery(e.target.value)} placeholder="Regex (title)" />
        <input className="ahp-in" style={{width:48}} value={flags} onChange={e=>setFlags(e.target.value)} />
        <button className="ahp-btn" onClick={refresh}>Refresh</button>
      </div>

      <div style={{display:'grid', gridTemplateColumns: `${left}px 8px 1fr`, gap: '8px', height:'100%', minHeight:0, padding:'8px'}}>
        <div className="ahp-card ahp-bg-card ahp-border ahp-border-card ahp-rounded-xl" style={{overflow:'auto'}}>
          <table className="ahp-table">
            <thead><tr><th>Title</th><th>Updated</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id} className="ahp-row" onClick={()=>pickRow(r)}>
                  <td><b>{r.title || '(untitled)'}</b><div className="ahp-text-normal ahp-opacity-80">{r.source}</div></td>
                  <td>{new Date((r.updated_at>2e9?r.updated_at:r.updated_at*1000)).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div style={{cursor:'col-resize'}} onMouseDown={onDrag} />
        <div className="ahp-card ahp-bg-card ahp-border ahp-border-card ahp-rounded-xl" style={{overflow:'auto'}}>
          {picked.row ? (
            <div>
              <div style={{fontWeight:800}}>{picked.row.title}</div>
              <div className="ahp-text-normal ahp-opacity-80">{picked.row.source} • {new Date((picked.row.updated_at>2e9?picked.row.updated_at:picked.row.updated_at*1000)).toLocaleString()}</div>
              <hr/>
              <div style={{display:'grid', gap:10}}>
                {picked.msgs?.map((m,i)=> (
                  <div key={i} className="ahp-card ahp-bg-card ahp-border ahp-border-card ahp-rounded-xl">
                    <div className="ahp-text-normal ahp-opacity-80"><b>{m.role}</b> • {m.ts ? new Date((m.ts>2e9?m.ts:m.ts*1000)).toLocaleString() : ''}</div>
                    <div>{(m.text||'').split('\n').map((ln: string, j:number) => <div key={j}>{ln}</div>)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : <div>Select a conversation.</div>}
        </div>
      </div>
    </div>
  );
}
