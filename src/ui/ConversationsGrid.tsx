import React, {useMemo, useState} from "react";
import { ColumnDef, getCoreRowModel, getSortedRowModel, getPaginationRowModel, useReactTable, flexRender } from "@tanstack/react-table";
import type { ConvRow } from "../data/conversations";
import clsx from "clsx";

type Props = {
  rows: ConvRow[];
  pageSize: number;
  onPageSizeChange: (n:number)=>void;
  onOpen: (convId:string)=>void;
  selected: Set<string>;
  toggleSelect: (convId:string)=>void;
};

export default function ConversationsGrid({ rows, pageSize, onPageSizeChange, onOpen, selected, toggleSelect }: Props){
  const [sorting, setSorting] = useState<any>([{id:'lastTs', desc:true}]);

  const cols = useMemo<ColumnDef<ConvRow>[]>(()=>[
    { id:'sel', header: '', size: 36,
      cell: ({row}) => <input type="checkbox" checked={selected.has(row.original.convId)}
                               onChange={()=>toggleSelect(row.original.convId)} /> },
    { id:'title', header:'Conversation', accessorKey:'title', size: 360,
      cell: ({row}) =>
        <button className="text-left hover:underline" onClick={()=>onOpen(row.original.convId)}>
          {row.original.title}
        </button> },
    { id:'msgCount', header:'#', accessorKey:'msgCount', size: 60 },
    { id:'lastTs', header:'Last', accessorFn:(r)=> new Date(r.lastTs).toLocaleString(), size: 160 },
    { id:'vendor', header:'Source', accessorKey:'vendor', size: 120,
      cell: ({row}) => <span className={clsx(
          row.original.vendor==='CHATGPT'?'badge-chatgpt':row.original.vendor==='CLAUDE'?'badge-claude':
          row.original.vendor==='GEMINI'?'badge-gemini':'badge-other'
        )}>{row.original.vendor}</span> },
  ],[onOpen, selected, toggleSelect]);

  const table = useReactTable({
    data: rows, columns: cols, state:{ sorting },
    onSortingChange:setSorting,
    getCoreRowModel:getCoreRowModel(),
    getSortedRowModel:getSortedRowModel(),
    getPaginationRowModel:getPaginationRowModel(),
    initialState:{ pagination:{ pageSize } }
  });

  const page = table.getState().pagination.pageIndex + 1;
  const totalPages = Math.max(1, Math.ceil(rows.length / table.getState().pagination.pageSize));

  return (
    <div className="flex flex-col h-full">
      {/* top pager */}
      <div className="flex items-center justify-between border-b border-border px-2 py-1 sticky top-0 bg-surface z-10">
        <div className="text-sm text-faint">{rows.length.toLocaleString()} conversations</div>
        <div className="flex items-center gap-2">
          <select className="px-2 py-1 border border-border rounded"
                  value={table.getState().pagination.pageSize}
                  onChange={e=>{ table.setPageSize(+e.target.value); onPageSizeChange(+e.target.value); }}>
            {[25,50,100,200].map(n=><option key={n} value={n}>{n}/page</option>)}
          </select>
          <div className="flex items-center gap-1">
            <button onClick={()=>table.setPageIndex(0)} disabled={page===1}>⏮</button>
            <button onClick={()=>table.previousPage()} disabled={!table.getCanPreviousPage()}>◀</button>
            <span className="text-sm">Page {page}/{totalPages}</span>
            <button onClick={()=>table.nextPage()} disabled={!table.getCanNextPage()}>▶</button>
            <button onClick={()=>table.setPageIndex(totalPages-1)} disabled={page===totalPages}>⏭</button>
          </div>
        </div>
      </div>

      {/* table */}
      <div className="divide-y divide-border">
        {table.getRowModel().rows.map(r=>(
          <div key={r.id} className="px-2 py-2 hover:bg-[color-mix(in_oklab,var(--background-primary) 90%,#fff 10%)]">
            <div className="flex items-center gap-2">
              {r.getVisibleCells().map(c => (
                <div key={c.id} style={{ width: c.column.getSize() }}>
                  {flexRender(c.column.columnDef.cell ?? c.column.columnDef.header, c.getContext())}
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      {/* bottom pager */}
      <div className="flex items-center justify-end gap-2 border-t border-border px-2 py-1">
        <span className="text-sm">{rows.length} rows</span>
        <select className="px-2 py-1 border border-border rounded"
                value={table.getState().pagination.pageSize}
                onChange={e=>{ table.setPageSize(+e.target.value); onPageSizeChange(+e.target.value); }}>
          {[25,50,100,200].map(n=><option key={n} value={n}>{n}/page</option>)}
        </select>
      </div>
    </div>
  );
}

