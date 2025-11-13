import React, {useMemo, useRef} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import type { Msg } from "../data/conversations";
import { groupIntoTurns, bucketByDay } from "../data/groupMessages";
import clsx from "clsx";

type Props = {
  messages: Msg[];
  pageSize: number;
  page: number;
  onPageChange: (p:number)=>void;
  onPageSizeChange: (s:number)=>void;
  collapseTools?: boolean;
  showSystem?: boolean;
  isMessageSelectMode?: boolean;
  selectedMessages?: Set<string>;
  onToggleMessage?: (messageId: string) => void;
  onSelectMessageText?: (messageId: string, text: string) => void;
};

const RolePill: React.FC<{role: Msg['role']}> = ({role}) => (
  <span className={clsx("pill",
    role==='user'?'pill-user':
    role==='assistant'?'pill-assistant':
    role==='tool'?'pill-tool':'pill-system')}>
    {role.toUpperCase()}
  </span>
);

const VendorBadge: React.FC<{v?: string}> = ({v}) => {
  const c = v==='CHATGPT'?'badge-chatgpt':v==='CLAUDE'?'badge-claude':v==='GEMINI'?'badge-gemini':'badge-other';
  return <span className={clsx(c,"ml-2")}>{v || 'OTHER'}</span>;
};

export default function MessageTurns(props: Props){
  const { 
    messages, 
    pageSize, 
    page, 
    onPageChange, 
    onPageSizeChange, 
    collapseTools, 
    showSystem,
    isMessageSelectMode = false,
    selectedMessages = new Set(),
    onToggleMessage,
    onSelectMessageText
  } = props;

  // filter roles
  const filtered = useMemo(()=> messages.filter(m =>
    (showSystem || m.role!=='system') && (!collapseTools || m.role!=='tool')
  ), [messages, collapseTools, showSystem]);

  const turns = useMemo(()=> groupIntoTurns(filtered), [filtered]);
  const buckets = useMemo(()=> bucketByDay(turns), [turns]);

  // simple pagination (turn-level)
  const flatTurns = buckets.flatMap(b => [{__day:b.day} as any, ...b.turns]);
  const totalPages = Math.max(1, Math.ceil(flatTurns.length / pageSize));
  const cur = flatTurns.slice((page-1)*pageSize, (page-1)*pageSize + pageSize);

  const parentRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: cur.length,
    getScrollElement:()=>parentRef.current,
    estimateSize: i => ("__day" in (cur[i] as any) ? 36 : 160),
    overscan: 8
  });

  return (
    <div className="flex flex-col h-full">
      {/* top pager */}
      <div className="flex items-center justify-between border-b border-border px-2 py-1">
        <div className="text-sm text-faint">{filtered.length} msgs • {turns.length} turns</div>
        <div className="flex items-center gap-2">
          <select className="px-2 py-1 border border-border rounded"
                  value={pageSize} onChange={e=>onPageSizeChange(+e.target.value)}>
            {[25,50,100,200].map(n=><option key={n} value={n}>{n}/page</option>)}
          </select>
          <div className="flex items-center gap-1">
            <button onClick={()=>onPageChange(1)} disabled={page===1}>⏮</button>
            <button onClick={()=>onPageChange(Math.max(1,page-1))} disabled={page===1}>◀</button>
            <span className="text-sm">Page {page}/{totalPages}</span>
            <button onClick={()=>onPageChange(Math.min(totalPages,page+1))} disabled={page===totalPages}>▶</button>
            <button onClick={()=>onPageChange(totalPages)} disabled={page===totalPages}>⏭</button>
          </div>
        </div>
      </div>

      {/* body */}
      <div ref={parentRef} className="flex-1 overflow-auto">
        <div style={{ height: rowVirtualizer.getTotalSize(), position:'relative' }}>
          {rowVirtualizer.getVirtualItems().map(v=>{
            const item = cur[v.index] as any;
            if ("__day" in item) {
              return (
                <div key={'d'+v.index}
                     style={{position:'absolute', top:0, left:0, right:0, transform:`translateY(${v.start}px)`}}
                     className="px-3 py-2 text-xs text-faint uppercase tracking-wide">
                  {item.__day}
                </div>
              );
            }
            const t = item; // Turn
            return (
              <div key={t.id}
                   style={{position:'absolute', top:0, left:0, right:0, transform:`translateY(${v.start}px)`}}
                   className="px-3 py-3">
                <div className="card p-3">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center">
                      <RolePill role={t.role} />
                      <VendorBadge v={t.vendor} />
                    </div>
                    <div className="text-xs text-faint">
                      {new Date(t.tsStart).toLocaleString()} – {new Date(t.tsEnd).toLocaleTimeString()}
                    </div>
                  </div>
                  <div className="space-y-3">
                    {t.items.map(m => {
                      const isSelected = selectedMessages.has(m.id);
                      return (
                        <div 
                          key={m.id} 
                          className="whitespace-pre-wrap break-words leading-6 aihp-message"
                          data-role={m.role}
                          style={{
                            padding: '12px 16px',
                            marginBottom: '12px',
                            borderRadius: '8px',
                            lineHeight: '1.6',
                            position: 'relative',
                            border: isSelected ? '2px solid var(--aihp-accent)' : undefined,
                            backgroundColor: isSelected ? 'rgba(139, 208, 255, 0.1)' : undefined
                          }}
                          onMouseUp={(e) => {
                            // Handle text selection
                            const selection = window.getSelection();
                            if (selection && selection.toString().trim().length > 0) {
                              const selectedText = selection.toString();
                              onSelectMessageText?.(m.id, selectedText);
                            }
                          }}
                        >
                          {isMessageSelectMode && (
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={(e) => {
                                e.stopPropagation();
                                onToggleMessage?.(m.id);
                              }}
                              onClick={(e) => e.stopPropagation()}
                              style={{
                                position: 'absolute',
                                top: '8px',
                                left: '8px',
                                zIndex: 10,
                                cursor: 'pointer',
                                width: '18px',
                                height: '18px'
                              }}
                            />
                          )}
                          <div style={{
                            marginLeft: isMessageSelectMode ? '28px' : '0',
                            userSelect: 'text',
                            WebkitUserSelect: 'text',
                            MozUserSelect: 'text',
                            msUserSelect: 'text'
                          }}>
                            {renderToolSafe(m)}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* bottom pager */}
      <div className="flex items-center justify-end gap-2 border-t border-border px-2 py-1">
        <span className="text-sm">{flatTurns.length} rows</span>
        <select className="px-2 py-1 border border-border rounded"
                value={pageSize} onChange={e=>onPageSizeChange(+e.target.value)}>
          {[25,50,100,200].map(n=><option key={n} value={n}>{n}/page</option>)}
        </select>
      </div>
    </div>
  );
}

function renderToolSafe(m: Msg){
  if (m.role!=='tool') return m.text;
  try {
    const obj = JSON.parse(m.text);
    return "```json\n" + JSON.stringify(obj, null, 2) + "\n```";
  } catch { return m.text; }
}







