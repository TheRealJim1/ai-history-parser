import React from 'react';

interface Conversation {
  convId: string;
  title: string;
  vendor: string;
  msgCount: number;
  firstTs: number;
  lastTs: number;
}

interface ConversationsListProps {
  conversations: Conversation[];
  selectedConversations: Set<string>;
  isMultiSelectMode: boolean;
  onSelectConversation: (convId: string) => void;
  onToggleConversation: (convId: string) => void;
  isLoading?: boolean;
}

export const ConversationsList: React.FC<ConversationsListProps> = ({
  conversations,
  selectedConversations,
  isMultiSelectMode,
  onSelectConversation,
  onToggleConversation,
  isLoading = false
}) => {
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

  return (
    <div className="aihp-conversations-list">
      {conversations.map(conv => (
        <div
          key={conv.convId}
          className={`aihp-conversation ${selectedConversations.has(conv.convId) ? 'selected' : ''}`}
          onClick={() => onSelectConversation(conv.convId)}
          style={{ cursor: 'pointer' }}
        >
          {isMultiSelectMode && (
            <div className="aihp-conv-checkbox">
              <input
                type="checkbox"
                checked={selectedConversations.has(conv.convId)}
                onChange={() => onToggleConversation(conv.convId)}
                onClick={(e) => e.stopPropagation()}
              />
            </div>
          )}
          
          <div className="aihp-conv-content">
            <div className="aihp-conv-header">
              <span className="aihp-conv-title">{conv.title || "(untitled)"}</span>
              <span className={`aihp-conv-vendor ${getVendorColor(conv.vendor)}`}>
                {conv.vendor}
              </span>
            </div>
            <div className="aihp-conv-meta">
              <span className="aihp-conv-count">{conv.msgCount} msgs</span>
              <span className="aihp-conv-date">
                {formatDate(conv.lastTs)}
              </span>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
};
