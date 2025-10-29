import React from 'react';
import { LoadingSpinner } from './LoadingSpinner';

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

  const getVendorColor = (vendor: string) => {
    switch (vendor) {
      case 'CHATGPT': return 'bg-green-100 text-green-800 border-green-200 dark:bg-green-900/20 dark:text-green-400 dark:border-green-800';
      case 'CLAUDE': return 'bg-orange-100 text-orange-800 border-orange-200 dark:bg-orange-900/20 dark:text-orange-400 dark:border-orange-800';
      case 'GEMINI': return 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-900/20 dark:text-blue-400 dark:border-blue-800';
      default: return 'bg-gray-100 text-gray-800 border-gray-200 dark:bg-gray-700 dark:text-gray-300 dark:border-gray-600';
    }
  };

  return (
    <div
      className={`
        relative p-4 rounded-lg border-2 transition-all duration-200 cursor-pointer
        ${isSelected 
          ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20 shadow-md' 
          : 'border-gray-200 hover:border-gray-300 hover:shadow-sm dark:border-gray-700 dark:hover:border-gray-600'
        }
        ${isLoading ? 'opacity-50 pointer-events-none' : ''}
      `}
      onClick={handleClick}
    >
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/80 dark:bg-gray-900/80 rounded-lg">
          <LoadingSpinner size="sm" text="Loading..." />
        </div>
      )}

      <div className="flex items-start gap-3">
        {isMultiSelectMode && (
          <div className="flex-shrink-0 pt-1">
            <input
              type="checkbox"
              checked={isSelected}
              onChange={handleCheckboxClick}
              className="w-4 h-4 text-blue-600 bg-gray-100 border-gray-300 rounded focus:ring-blue-500 dark:focus:ring-blue-600 dark:ring-offset-gray-800 focus:ring-2 dark:bg-gray-700 dark:border-gray-600"
            />
          </div>
        )}

        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
              {conversation.title || 'Untitled Conversation'}
            </h3>
            <span className={`px-2 py-1 text-xs font-medium rounded-full border ${getVendorColor(conversation.vendor)}`}>
              {conversation.vendor}
            </span>
          </div>

          <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
            <span className="flex items-center gap-1">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
              {conversation.msgCount} messages
            </span>
            <span>{formatDate(conversation.lastTs)}</span>
          </div>
        </div>
      </div>
    </div>
  );
};
