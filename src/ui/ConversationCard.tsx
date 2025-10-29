import React from 'react';

interface ConversationCardProps {
  conversation: {
    convId: string;
    title: string;
    vendor: string;
    msgCount: number;
    firstTs: number;
    lastTs: number;
  };
  isSelected: boolean;
  isMultiSelectMode: boolean;
  onSelect: (convId: string) => void;
  onToggle: (convId: string) => void;
  isLoading?: boolean;
}

export const ConversationCard: React.FC<ConversationCardProps> = ({
  conversation,
  isSelected,
  isMultiSelectMode,
  onSelect,
  onToggle,
  isLoading = false
}) => {
  const handleClick = (e: React.MouseEvent) => {
    if (isMultiSelectMode) {
      e.stopPropagation();
      onToggle(conversation.convId);
    } else {
      onSelect(conversation.convId);
    }
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onToggle(conversation.convId);
  };

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

  return (
    <div
      className={`aihp-conversation ${isSelected ? 'selected' : ''} ${isLoading ? 'loading' : ''}`}
      onClick={handleClick}
      style={{ cursor: 'pointer' }}
    >
      {isMultiSelectMode && (
        <div className="aihp-conv-checkbox">
          <input
            type="checkbox"
            checked={isSelected}
            onChange={handleCheckboxClick}
            onClick={(e) => e.stopPropagation()}
          />
        </div>
      )}
      
      <div className="aihp-conv-content">
        <div className="aihp-conv-header">
          <span className="aihp-conv-title">{conversation.title || "(untitled)"}</span>
          <span className={`aihp-conv-vendor aihp-vendor-${conversation.vendor.toLowerCase()}`}>
            {conversation.vendor}
          </span>
        </div>
        <div className="aihp-conv-meta">
          <span className="aihp-conv-count">{conversation.msgCount} msgs</span>
          <span className="aihp-conv-date">
            {formatDate(conversation.lastTs)}
          </span>
        </div>
      </div>
      
      {isLoading && (
        <div className="aihp-loading-overlay">
          <div className="aihp-spinner"></div>
        </div>
      )}
    </div>
  );
};
