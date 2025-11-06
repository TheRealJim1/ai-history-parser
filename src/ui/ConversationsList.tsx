import React from 'react';
import { VendorIcon } from '../components/VendorIcon';

interface Conversation {
  convId: string;
  title: string;
  vendor: string;
  msgCount: number;
  firstTs: number;
  lastTs: number;
  tags?: string[];
  firstUserLine?: string;
  folder_path?: string;
  meta?: any;
  outlierCount?: number;
  attachmentCount?: number;
}

interface ConversationsListProps {
  conversations: Conversation[];
  selectedConversations: Set<string>;
  isMultiSelectMode: boolean;
  onSelectConversation: (convId: string) => void;
  onToggleConversation: (convId: string) => void;
  isLoading?: boolean;
  treeNodes?: any[];
  onNavigateToBranch?: (convId: string, branchNodeId: string) => void;
  selectedBranchPath?: string[];
  onTagClick?: (tag: string) => void; // New: callback for tag clicks
}

export const ConversationsList: React.FC<ConversationsListProps> = ({
  conversations,
  selectedConversations,
  isMultiSelectMode,
  onSelectConversation,
  onToggleConversation,
  isLoading = false,
  treeNodes = [],
  onNavigateToBranch,
  selectedBranchPath = [],
  onTagClick
}) => {
  const formatDate = (timestamp: number) => {
    if (!timestamp || timestamp <= 0) return '';
    
    // Handle both seconds and milliseconds timestamps
    // If timestamp is less than year 2000 in milliseconds, assume it's in seconds
    const ts = timestamp < 946684800000 ? timestamp * 1000 : timestamp;
    const date = new Date(ts);
    
    // Check if date is valid
    if (isNaN(date.getTime())) return '';
    
    // Always show full date with year, matching the middle panel format
    // Format: M/D/YYYY (e.g., "3/7/2024")
    return date.toLocaleDateString('en-US', { 
      month: 'numeric', 
      day: 'numeric', 
      year: 'numeric' 
    });
  };

  const getVendorColor = (vendor: string) => {
    switch (vendor.toLowerCase()) {
      case 'chatgpt': return 'aihp-vendor-chatgpt';
      case 'claude': return 'aihp-vendor-claude';
      case 'gemini': return 'aihp-vendor-gemini';
      case 'grok': return 'aihp-vendor-grok';
      default: return 'aihp-vendor-other';
    }
  };

  const getVendorIcon = (vendor: string) => {
    switch (vendor.toLowerCase()) {
      case 'chatgpt': return '🤖';
      case 'claude': return '🧠';
      case 'gemini': return '💎';
      case 'grok': return '⚡';
      default: return '💬';
    }
  };

  return (
    <div 
      className="aihp-conversations-list" 
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '10px',
        padding: '16px',
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
          if (!conv) return null;
          
          const bad = new Set(['','openai','untitled']);
          const displayTitle = (!bad.has((conv.title||'').toLowerCase()))
            ? conv.title
            : (conv.firstUserLine || '(untitled)');
          const displayConvId = conv.convId || `conv-${index}`;
          
          // Parse meta for additional info
          let meta: any = {};
          try {
            meta = typeof conv.meta === 'string' ? JSON.parse(conv.meta || '{}') : (conv.meta || {});
          } catch {}
          
          // Check for attachments (from images JSON column - would need to query separately)
          const hasAttachments = conv.attachmentCount ? conv.attachmentCount > 0 : false;
          
          // Check for outliers
          const hasOutliers = conv.outlierCount ? conv.outlierCount > 0 : false;
          
          // Check tree structure - show if any branches exist
          const baseConvId = displayConvId.includes(':') ? displayConvId.split(':').slice(1).join(':') : displayConvId;
          const convNodes = treeNodes?.filter((n: any) => {
            const nodeConvId = n.conversation_id || n.conversationId;
            return nodeConvId === displayConvId || nodeConvId === baseConvId || nodeConvId === conv.convId;
          }) || [];
          const branchPoints = convNodes.filter((n: any) => n.is_branch_point === 1 || n.isBranchPoint === true);
          const hasTreeStructure = branchPoints.length > 0; // Show if any branches exist
          const treeDepth = convNodes.length > 0 ? Math.max(...convNodes.map((n: any) => n.depth || 0)) : 0;
          
          const hasPairedHTML = !!meta.paired_html_id;
          
          // Folder provenance
          const folderProvenance = (() => {
            const fp = conv.folder_path || '';
            if (!fp) return null;
            const parts = fp.split(/[\\/]/).filter(Boolean);
            if (parts.length >= 2) return parts.slice(-2).join('/');
            if (parts.length === 1) return parts[0];
            return null;
          })();
          
          if (!displayConvId) return null;
          
          return (
            <div
              key={displayConvId}
              className={`aihp-conversation ${selectedConversations.has(displayConvId) ? 'selected' : ''}`}
              onClick={() => onSelectConversation(displayConvId)}
              style={{ 
                cursor: 'pointer',
                padding: '24px 28px',
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
                display: 'flex',
                flexDirection: 'column',
                width: '100%',
                boxSizing: 'border-box',
                wordWrap: 'break-word',
                overflow: 'hidden',
                gap: '8px',
                alignItems: 'center',
                justifyContent: 'flex-start',
                minHeight: 'auto'
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
              {/* Single row: Title + all indicators */}
              <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'flex-start',
                gap: '8px',
                width: '100%',
                height: '100%'
              }}>
                {/* Title - takes most space, allows wrapping */}
                <span className="aihp-conv-title" style={{
                  fontWeight: '600',
                  fontSize: '13px',
                  lineHeight: '1.4',
                  color: selectedConversations.has(displayConvId) ? '#e8f4ff' : '#e0e0e0',
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  wordBreak: 'break-word',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  flex: '1 1 0%',
                  minWidth: 0,
                  paddingRight: '8px',
                  alignSelf: 'center'
                }} title={displayTitle}>{displayTitle}</span>
                
                {/* All indicators - compact but visible */}
                <div style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'flex-end',
                  gap: '6px',
                  flexShrink: 0,
                  fontSize: '10px',
                  alignSelf: 'center',
                  height: '100%'
                }}>
                  {/* Message count */}
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.7,
                    whiteSpace: 'nowrap',
                    fontSize: '10px',
                    lineHeight: '1'
                  }} title={`${conv.msgCount.toLocaleString()} messages`}>
                    💬{conv.msgCount > 999 ? `${(conv.msgCount/1000).toFixed(1)}k` : conv.msgCount}
                  </span>
                  
                  {/* Tree indicator - clickable - always show if branches exist */}
                  {hasTreeStructure && branchPoints.length > 0 && (
                    <span 
                      onClick={(e) => {
                        e.stopPropagation();
                        if (onNavigateToBranch && branchPoints.length > 0) {
                          const isCurrentlyViewingBranch = selectedBranchPath.length > 0 && 
                            selectedConversations.has(displayConvId);
                          if (isCurrentlyViewingBranch) {
                            onNavigateToBranch(displayConvId, '');
                          } else {
                            onNavigateToBranch(displayConvId, branchPoints[0].id || branchPoints[0].messageId);
                          }
                        }
                      }}
                      style={{
                        display: 'inline-flex',
                        alignItems: 'center',
                        padding: '2px 5px',
                        backgroundColor: (selectedBranchPath.length > 0 && selectedConversations.has(displayConvId))
                          ? 'rgba(139, 208, 255, 0.25)'
                          : 'rgba(139, 208, 255, 0.15)',
                        borderRadius: '3px',
                        color: '#8bd0ff',
                        cursor: onNavigateToBranch ? 'pointer' : 'default',
                        fontWeight: '500',
                        fontSize: '9px',
                        whiteSpace: 'nowrap',
                        border: (selectedBranchPath.length > 0 && selectedConversations.has(displayConvId))
                          ? '1px solid rgba(139, 208, 255, 0.4)'
                          : '1px solid rgba(139, 208, 255, 0.2)'
                      }}
                      title={`${branchPoints.length} branches - Click to view`}
                    >
                      🌳{branchPoints.length}
                    </span>
                  )}
                  
                  {/* Attachments - only if present */}
                  {hasAttachments && (
                    <span style={{
                      opacity: 0.7,
                      fontSize: '10px',
                      whiteSpace: 'nowrap'
                    }} title={`${conv.attachmentCount} attachment${conv.attachmentCount !== 1 ? 's' : ''}`}>
                      📎{conv.attachmentCount}
                    </span>
                  )}
                  
                  {/* Outliers - always show if present, make more visible */}
                  {hasOutliers && (
                    <span style={{
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      padding: '1px 4px',
                      backgroundColor: 'rgba(255, 193, 7, 0.15)',
                      borderRadius: '3px',
                      border: '1px solid rgba(255, 193, 7, 0.3)',
                      fontSize: '9px',
                      whiteSpace: 'nowrap',
                      lineHeight: '1',
                      color: '#ffc107',
                      fontWeight: '500'
                    }} title={`${conv.outlierCount} outlier ID${conv.outlierCount !== 1 ? 's' : ''}`}>
                      ⭐{conv.outlierCount}
                    </span>
                  )}
                  
                  {/* Contact Tags - up to 5 tags inline */}
                  {conv.tags && conv.tags.length > 0 && (
                    <>
                      {conv.tags.slice(0, 5).map((t, idx) => {
                        const tagText = t.replace(/^batch:/, '');
                        const isBatchTag = t.startsWith('batch:');
                        return (
                          <span
                            key={`${displayConvId}-tag-${idx}`}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              padding: '3px 6px',
                              borderRadius: '4px',
                              backgroundColor: isBatchTag 
                                ? 'rgba(139, 208, 255, 0.15)' 
                                : 'rgba(139, 208, 255, 0.2)',
                              color: '#8bd0ff',
                              border: '1px solid rgba(139, 208, 255, 0.3)',
                              fontSize: '10px',
                              fontWeight: '600',
                              whiteSpace: 'nowrap',
                              cursor: onTagClick ? 'pointer' : 'default',
                              lineHeight: '1.2',
                              maxWidth: '80px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              transition: 'all 0.2s ease'
                            }}
                            onClick={(e) => {
                              e.stopPropagation();
                              if (onTagClick) {
                                onTagClick(t);
                              }
                            }}
                            onMouseEnter={(e) => {
                              if (onTagClick) {
                                e.currentTarget.style.backgroundColor = 'rgba(139, 208, 255, 0.25)';
                                e.currentTarget.style.borderColor = 'rgba(139, 208, 255, 0.5)';
                                e.currentTarget.style.transform = 'scale(1.05)';
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (onTagClick) {
                                e.currentTarget.style.backgroundColor = isBatchTag 
                                  ? 'rgba(139, 208, 255, 0.15)' 
                                  : 'rgba(139, 208, 255, 0.2)';
                                e.currentTarget.style.borderColor = 'rgba(139, 208, 255, 0.3)';
                                e.currentTarget.style.transform = 'scale(1)';
                              }
                            }}
                            title={onTagClick 
                              ? `Tag: ${tagText}\n\nClick to filter conversations by this tag.\n\nTags help organize and categorize conversations for easier searching and filtering.` 
                              : `Tag: ${tagText}\n\nTags help organize and categorize conversations.`}
                          >
                            {tagText.length > 8 ? tagText.substring(0, 7) + '…' : tagText}
                          </span>
                        );
                      })}
                      {conv.tags.length > 5 && (
                        <span style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          fontSize: '9px',
                          fontWeight: '500',
                          color: '#888',
                          opacity: 0.7,
                          lineHeight: '1.2',
                          marginLeft: '4px'
                        }} title={`+${conv.tags.length - 5} more tags\n\nThis conversation has ${conv.tags.length} total tags.`}>
                          +{conv.tags.length - 5}
                        </span>
                      )}
                    </>
                  )}
                  
                  {/* Vendor icon */}
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    opacity: 0.9,
                    lineHeight: '1'
                  }} title={conv.vendor}>
                    <VendorIcon vendor={conv.vendor} size={18} />
                  </span>
                  
                  {/* Date - compact */}
                  <span style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '9px',
                    opacity: 0.7,
                    fontFamily: 'monospace',
                    whiteSpace: 'nowrap',
                    lineHeight: '1'
                  }} title={conv.lastTs && conv.lastTs > 0 ? new Date(conv.lastTs).toLocaleDateString() : (conv.firstTs && conv.firstTs > 0 ? new Date(conv.firstTs).toLocaleDateString() : '')}>
                    {conv.lastTs && conv.lastTs > 0 ? formatDate(conv.lastTs) : (conv.firstTs && conv.firstTs > 0 ? formatDate(conv.firstTs) : '')}
                  </span>
                </div>
              </div>
            </div>
          );
        })
      )}
    </div>
  );
};
