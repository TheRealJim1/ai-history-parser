import React, { useMemo, useState } from 'react';
import { 
  createColumnHelper, 
  flexRender, 
  getCoreRowModel, 
  getSortedRowModel, 
  getPaginationRowModel, 
  useReactTable,
  SortingState,
  PaginationState
} from '@tanstack/react-table';

interface Conversation {
  convId: string;
  title: string;
  vendor: string;
  msgCount: number;
  firstTs: number;
  lastTs: number;
}

interface ConversationsTableProps {
  conversations: Conversation[];
  selectedConversations: Set<string>;
  isMultiSelectMode: boolean;
  onSelectConversation: (convId: string) => void;
  onToggleConversation: (convId: string) => void;
  isLoading?: boolean;
}

const columnHelper = createColumnHelper<Conversation>();

export const ConversationsTable: React.FC<ConversationsTableProps> = ({
  conversations,
  selectedConversations,
  isMultiSelectMode,
  onSelectConversation,
  onToggleConversation,
  isLoading = false
}) => {
  const [sorting, setSorting] = useState<SortingState>([]);
  const [pagination, setPagination] = useState<PaginationState>({
    pageIndex: 0,
    pageSize: 50,
  });

  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } else if (diffDays === 1) {
      return 'Yesterday';
    } else if (diffDays < 7) {
      return date.toLocaleDateString([], { weekday: 'short' });
    } else {
      return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
    }
  };

  const getVendorColor = (vendor: string) => {
    switch (vendor.toLowerCase()) {
      case 'chatgpt': return 'aihp-vendor-chatgpt';
      case 'claude': return 'aihp-vendor-claude';
      case 'gemini': return 'aihp-vendor-gemini';
      default: return 'aihp-vendor-other';
    }
  };

  const columns = useMemo(() => {
    const baseColumns = [
      // Title column
      columnHelper.accessor('title', {
        header: 'Conversation',
        cell: ({ getValue, row }) => (
          <div className="aihp-conv-content">
            <div className="aihp-conv-header">
              <span className="aihp-conv-title">
                {getValue() || "(untitled)"}
              </span>
              <span className={`aihp-conv-vendor ${getVendorColor(row.original.vendor)}`}>
                {row.original.vendor}
              </span>
            </div>
            <div className="aihp-conv-meta">
              <span className="aihp-conv-count">{row.original.msgCount} msgs</span>
              <span className="aihp-conv-date">
                {formatDate(row.original.lastTs)}
              </span>
            </div>
          </div>
        ),
        size: 400,
      }),
      
      // Message count column
      columnHelper.accessor('msgCount', {
        header: 'Messages',
        size: 80,
        cell: ({ getValue }) => (
          <span className="aihp-conv-count">{getValue().toLocaleString()}</span>
        ),
      }),
      
      // Last activity column
      columnHelper.accessor('lastTs', {
        header: 'Last Activity',
        size: 120,
        cell: ({ getValue }) => (
          <span className="aihp-conv-date">
            {formatDate(getValue())}
          </span>
        ),
      }),
    ];

    // Add selection column if in multi-select mode
    if (isMultiSelectMode) {
      return [
        columnHelper.display({
          id: 'select',
          header: '',
          size: 50,
          cell: ({ row }) => (
            <div className="aihp-conv-checkbox">
              <input
                type="checkbox"
                checked={selectedConversations.has(row.original.convId)}
                onChange={() => onToggleConversation(row.original.convId)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          ),
        }),
        ...baseColumns
      ];
    }

    return baseColumns;
  }, [isMultiSelectMode, selectedConversations, onToggleConversation]);

  const table = useReactTable({
    data: conversations,
    columns,
    state: {
      sorting,
      pagination,
    },
    onSortingChange: setSorting,
    onPaginationChange: setPagination,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getPaginationRowModel: getPaginationRowModel(),
    manualPagination: false,
  });

  const handleRowClick = (conversation: Conversation) => {
    if (isMultiSelectMode) {
      onToggleConversation(conversation.convId);
    } else {
      onSelectConversation(conversation.convId);
    }
  };

  return (
    <div className="aihp-conversations-table">
      <div className="aihp-table-container">
        <table className="aihp-table">
          <thead className="aihp-table-header">
            {table.getHeaderGroups().map(headerGroup => (
              <tr key={headerGroup.id} className="aihp-table-header-row">
                {headerGroup.headers.map(header => (
                  <th 
                    key={header.id} 
                    className="aihp-table-header-cell"
                    style={{ width: header.getSize() }}
                  >
                    {header.isPlaceholder ? null : (
                      <div
                        className={`aihp-table-header-content ${header.column.getCanSort() ? 'sortable' : ''}`}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getCanSort() && (
                          <span className="aihp-sort-indicator">
                            {{
                              asc: '↑',
                              desc: '↓',
                            }[header.column.getIsSorted() as string] ?? '↕'}
                          </span>
                        )}
                      </div>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody className="aihp-table-body">
            {table.getRowModel().rows.map(row => (
              <tr 
                key={row.id} 
                className={`aihp-table-row ${selectedConversations.has(row.original.convId) ? 'selected' : ''}`}
                onClick={() => handleRowClick(row.original)}
              >
                {row.getVisibleCells().map(cell => (
                  <td 
                    key={cell.id} 
                    className="aihp-table-cell"
                    style={{ width: cell.column.getSize() }}
                  >
                    {flexRender(cell.column.columnDef.cell, cell.getContext())}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Pagination */}
      <div className="aihp-table-pagination">
        <div className="aihp-pagination-info">
          Showing {table.getState().pagination.pageIndex * table.getState().pagination.pageSize + 1} to{' '}
          {Math.min(
            (table.getState().pagination.pageIndex + 1) * table.getState().pagination.pageSize,
            table.getFilteredRowModel().rows.length
          )}{' '}
          of {table.getFilteredRowModel().rows.length} conversations
        </div>
        
        <div className="aihp-pagination-controls">
          <button
            onClick={() => table.setPageIndex(0)}
            disabled={!table.getCanPreviousPage()}
            className="aihp-btn-small"
          >
            ⏮
          </button>
          <button
            onClick={() => table.previousPage()}
            disabled={!table.getCanPreviousPage()}
            className="aihp-btn-small"
          >
            ◀
          </button>
          <span className="aihp-pagination-page">
            Page {table.getState().pagination.pageIndex + 1} of {table.getPageCount()}
          </span>
          <button
            onClick={() => table.nextPage()}
            disabled={!table.getCanNextPage()}
            className="aihp-btn-small"
          >
            ▶
          </button>
          <button
            onClick={() => table.setPageIndex(table.getPageCount() - 1)}
            disabled={!table.getCanNextPage()}
            className="aihp-btn-small"
          >
            ⏭
          </button>
        </div>
        
        <div className="aihp-pagination-size">
          <select
            value={table.getState().pagination.pageSize}
            onChange={e => table.setPageSize(Number(e.target.value))}
            className="aihp-select"
          >
            {[25, 50, 100, 200].map(pageSize => (
              <option key={pageSize} value={pageSize}>
                {pageSize} per page
              </option>
            ))}
          </select>
        </div>
      </div>
    </div>
  );
};
