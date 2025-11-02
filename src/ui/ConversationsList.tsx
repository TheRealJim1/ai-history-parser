import React from 'react';

interface Conversation {
  convId: string;
  title: string;
  vendor: string;
  msgCount: number;
  firstTs: number;
  lastTs: number;
  tags?: string[];
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

  // Debug: log what we're rendering
  React.useEffect(() => {
    console.log("🔄 ConversationsList render:", {
      conversationsCount: conversations.length,
      isLoading,
      isMultiSelectMode,
      selectedCount: selectedConversations.size,
      firstFew: conversations.slice(0, 3).map(c => ({
        convId: c?.convId,
        title: c?.title,
        hasTitle: !!c?.title,
        vendor: c?.vendor,
        msgCount: c?.msgCount
      }))
    });
  }, [conversations.length, isLoading, isMultiSelectMode, selectedConversations.size]);

  // Debug: log container rendering
  console.log("🔄 ConversationsList container render:", {
    conversationsLength: conversations.length,
    willShowEmpty: conversations.length === 0,
    willShowList: conversations.length > 0
  });
  
  return (
    <div 
      className="aihp-conversations-list" 
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '6px',
        padding: '12px',
        height: '100%',
        overflowY: 'auto',
        overflowX: 'hidden',
        minHeight: '200px',
        backgroundColor: 'transparent',
        width: '100%',
        boxSizing: 'border-box'
      }}
    >
      {conversations.length === 0 ? (
        <div style={{
          padding: '24px',
          textAlign: 'center',
          color: '#888',
          fontSize: '13px'
        }}>
          {isLoading ? 'Loading conversations...' : 'No conversations found'}
        </div>
      ) : (
        conversations.map((conv, index) => {
          if (!conv) {
            console.warn("⚠️ Null conversation at index", index);
            return null;
          }
          
          // Debug first few items
          if (index < 3) {
            console.log(`🔄 Rendering conversation ${index}:`, {
              raw: conv,
              convId: conv.convId,
              title: conv.title,
              vendor: conv.vendor,
              msgCount: conv.msgCount,
              allKeys: Object.keys(conv)
            });
          }
          
          const displayTitle = conv.title || "(untitled)";
          const displayConvId = conv.convId || `conv-${index}`;
          
          // Ensure we have a valid convId
          if (!displayConvId) {
            console.error("❌ Conversation missing convId:", conv, index);
            return null;
          }
          
          return (
            <div
            key={displayConvId}
            className={`aihp-conversation ${selectedConversations.has(displayConvId) ? 'selected' : ''}`}
            onClick={() => onSelectConversation(displayConvId)}
            style={{ 
              cursor: 'pointer',
              padding: '12px 14px',
              borderRadius: '8px',
              backgroundColor: selectedConversations.has(displayConvId) 
                ? 'rgba(139, 208, 255, 0.15)' 
                : 'rgba(255,255,255,0.03)',
              border: selectedConversations.has(displayConvId) 
                ? '1px solid rgba(139, 208, 255, 0.4)' 
                : '1px solid rgba(255,255,255,0.08)',
              transition: 'all 0.2s ease',
              marginBottom: '6px',
              position: 'relative',
              minHeight: '70px',
              display: 'flex',
              flexDirection: 'column',
              width: '100%',
              boxSizing: 'border-box',
              wordWrap: 'break-word',
              overflow: 'hidden'
            }}
            onMouseEnter={(e) => {
              if (!selectedConversations.has(displayConvId)) {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.06)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.12)';
              }
            }}
            onMouseLeave={(e) => {
              if (!selectedConversations.has(displayConvId)) {
                (e.currentTarget as HTMLElement).style.backgroundColor = 'rgba(255,255,255,0.03)';
                (e.currentTarget as HTMLElement).style.borderColor = 'rgba(255,255,255,0.08)';
              }
            }}
          >
            {isMultiSelectMode && (
              <div className="aihp-conv-checkbox" style={{
                position: 'absolute',
                left: '8px',
                top: '50%',
                transform: 'translateY(-50%)',
                zIndex: 10
              }}>
                <input
                  type="checkbox"
                  checked={selectedConversations.has(displayConvId)}
                  onChange={() => onToggleConversation(displayConvId)}
                  onClick={(e) => e.stopPropagation()}
                  style={{ cursor: 'pointer' }}
                />
              </div>
            )}
            
            <div className="aihp-conv-content" style={{
              marginLeft: isMultiSelectMode ? '32px' : '0',
              flex: 1,
              minWidth: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '8px'
            }}>
              <div className="aihp-conv-header" style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                gap: '10px',
                width: '100%'
              }}>
                <span className="aihp-conv-title" style={{
                  fontWeight: '600',
                  fontSize: '14px',
                  lineHeight: '1.5',
                  color: selectedConversations.has(displayConvId) ? '#e8f4ff' : '#e0e0e0',
                  flex: 1,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  wordBreak: 'break-word',
                  minWidth: 0
                }}>{displayTitle}</span>
                <span className={`aihp-conv-vendor ${getVendorColor(conv.vendor)}`} style={{
                  fontSize: '10px',
                  fontWeight: '500',
                  padding: '4px 8px',
                  borderRadius: '4px',
                  backgroundColor: 'rgba(139, 208, 255, 0.15)',
                  color: '#8bd0ff',
                  textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                  flexShrink: 0,
                  letterSpacing: '0.5px'
                }}>
                  {conv.vendor === 'CHATGPT' ? 'ChatGPT' : 
                   conv.vendor === 'CLAUDE' ? 'Claude' :
                   conv.vendor === 'GEMINI' ? 'Gemini' :
                   conv.vendor === 'GROK' ? 'Grok' :
                   conv.vendor}
                </span>
              </div>
              
              <div className="aihp-conv-meta" style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                fontSize: '11px',
                color: '#aaa',
                marginTop: '2px'
              }}>
                <span className="aihp-conv-count" style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: '6px',
                  fontSize: '11px'
                }}>
                  <span style={{ opacity: 0.7, fontSize: '12px' }}>💬</span>
                  <span>{conv.msgCount.toLocaleString()} {conv.msgCount === 1 ? 'msg' : 'msgs'}</span>
                </span>
                <span className="aihp-conv-date" style={{
                  fontSize: '10px',
                  opacity: 0.8,
                  fontFamily: 'monospace'
                }}>
                  {conv.lastTs && conv.lastTs > 0 ? formatDate(conv.lastTs) : (conv.firstTs && conv.firstTs > 0 ? formatDate(conv.firstTs) : '')}
                </span>
              </div>
              
              {conv.tags && conv.tags.length > 0 && (
                <div style={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: '4px',
                  marginTop: '4px'
                }}>
                  {conv.tags.slice(0, 3).map(t => (
                    <span 
                      key={t} 
                      className="pill" 
                      data-tag={t}
                      style={{
                        fontSize: '9px',
                        padding: '3px 8px',
                        borderRadius: '4px',
                        backgroundColor: 'rgba(255,255,255,0.05)',
                        color: '#aaa',
                        border: '1px solid rgba(255,255,255,0.1)',
                        fontWeight: '500'
                      }}
                    >{t.replace(/^batch:/, '')}</span>
                  ))}
                  {conv.tags.length > 3 && (
                    <span style={{
                      fontSize: '9px',
                      color: '#888',
                      padding: '3px 8px',
                      opacity: 0.7
                    }}>+{conv.tags.length - 3}</span>
                  )}
                </div>
              )}
            </div>
          </div>
          );
        })
      )}
    </div>
  );
};


