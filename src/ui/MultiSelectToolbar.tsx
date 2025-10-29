import React from 'react';

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
      <div className="aip-pane-header">
        <div className="aip-pane-header-top">
          <span>Conversations ({totalCount.toLocaleString()})</span>
        </div>
        <div className="aip-pane-header-controls">
          <button
            onClick={onToggleMultiSelect}
            className="aihp-btn-small"
          >
            Multi-Select
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="aip-pane-header" style={{ backgroundColor: 'var(--aihp-bg-modifier)' }}>
      <div className="aip-pane-header-top">
        <span>
          {isMultiSelectMode ? 'Multi-Select Mode' : 'Conversations'} 
          ({selectedCount} of {totalCount} selected)
        </span>
      </div>
      <div className="aip-pane-header-controls">
        <button
          onClick={onToggleMultiSelect}
          className="aihp-btn-small"
        >
          {isMultiSelectMode ? 'Exit Multi-Select' : 'Multi-Select'}
        </button>
        
        {isMultiSelectMode && (
          <>
            <button
              onClick={onSelectAll}
              disabled={isLoading}
              className="aihp-btn-small"
            >
              Select All
            </button>
            
            <button
              onClick={onSelectNone}
              disabled={isLoading || selectedCount === 0}
              className="aihp-btn-small"
            >
              Select None
            </button>

            {onExportSelected && (
              <button
                onClick={onExportSelected}
                disabled={selectedCount === 0 || isLoading}
                className="aihp-btn-small"
                style={{ backgroundColor: 'var(--aihp-accent)', color: 'white' }}
              >
                Export Selected
              </button>
            )}

            {onDeleteSelected && (
              <button
                onClick={onDeleteSelected}
                disabled={selectedCount === 0 || isLoading}
                className="aihp-btn-small"
                style={{ backgroundColor: '#dc3545', color: 'white' }}
              >
                Delete Selected
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};
