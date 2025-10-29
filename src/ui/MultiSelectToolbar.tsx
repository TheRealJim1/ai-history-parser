import React from 'react';
import { LoadingButton } from './LoadingSpinner';

interface MultiSelectToolbarProps {
  selectedCount: number;
  totalCount: number;
  isMultiSelectMode: boolean;
  onToggleMultiSelect: () => void;
  onSelectAll: () => void;
  onSelectNone: () => void;
  onExportSelected?: () => void;
  onDeleteSelected?: () => void;
  isLoading?: boolean;
}

export const MultiSelectToolbar: React.FC<MultiSelectToolbarProps> = ({
  selectedCount,
  totalCount,
  isMultiSelectMode,
  onToggleMultiSelect,
  onSelectAll,
  onSelectNone,
  onExportSelected,
  onDeleteSelected,
  isLoading = false
}) => {
  if (!isMultiSelectMode && selectedCount === 0) {
    return (
      <div className="flex items-center justify-between p-3 border-b border-gray-200 dark:border-gray-700">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            Conversations
          </h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {totalCount.toLocaleString()} total
          </span>
        </div>
        
        <button
          onClick={onToggleMultiSelect}
          className="px-3 py-1.5 text-sm font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 dark:text-blue-400 dark:hover:text-blue-300 dark:hover:bg-blue-900/20 rounded-md transition-colors duration-200"
        >
          Multi-Select
        </button>
      </div>
    );
  }

  return (
    <div className="p-3 border-b border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
            {isMultiSelectMode ? 'Multi-Select Mode' : 'Conversations'}
          </h2>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {selectedCount} of {totalCount} selected
          </span>
        </div>
        
        <button
          onClick={onToggleMultiSelect}
          className="px-3 py-1.5 text-sm font-medium text-gray-600 hover:text-gray-700 hover:bg-gray-100 dark:text-gray-400 dark:hover:text-gray-300 dark:hover:bg-gray-700 rounded-md transition-colors duration-200"
        >
          {isMultiSelectMode ? 'Exit Multi-Select' : 'Multi-Select'}
        </button>
      </div>

      {isMultiSelectMode && (
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={onSelectAll}
            disabled={isLoading}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Select All
          </button>
          
          <button
            onClick={onSelectNone}
            disabled={isLoading || selectedCount === 0}
            className="px-3 py-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 hover:bg-gray-100 dark:text-gray-300 dark:hover:text-gray-100 dark:hover:bg-gray-700 rounded-md transition-colors duration-200 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Select None
          </button>

          <div className="w-px h-6 bg-gray-300 dark:bg-gray-600" />

          {onExportSelected && (
            <LoadingButton
              isLoading={isLoading}
              onClick={onExportSelected}
              disabled={selectedCount === 0}
              variant="primary"
              size="sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
              Export Selected
            </LoadingButton>
          )}

          {onDeleteSelected && (
            <LoadingButton
              isLoading={isLoading}
              onClick={onDeleteSelected}
              disabled={selectedCount === 0}
              variant="danger"
              size="sm"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
              </svg>
              Delete Selected
            </LoadingButton>
          )}
        </div>
      )}
    </div>
  );
};
