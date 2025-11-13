import React, { useState, useMemo } from 'react';
import { Attachment } from './AttachmentViewer';
import { AttachmentViewer } from './AttachmentViewer';

interface AttachmentGalleryProps {
  attachments: Attachment[];
  vaultBasePath: string;
  onClose: () => void;
}

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB

export const AttachmentGallery: React.FC<AttachmentGalleryProps> = ({
  attachments,
  vaultBasePath,
  onClose
}) => {
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedAttachment, setSelectedAttachment] = useState<Attachment | null>(null);

  const filteredAttachments = useMemo(() => {
    let filtered = attachments;

    // Filter by type
    if (typeFilter !== 'all') {
      filtered = filtered.filter(att => att.type_category === typeFilter);
    }

    // Filter by search query
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(att => 
        att.file_name.toLowerCase().includes(query) ||
        att.mime_type.toLowerCase().includes(query)
      );
    }

    return filtered;
  }, [attachments, typeFilter, searchQuery]);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {
      all: attachments.length,
      image: 0,
      video: 0,
      audio: 0,
      document: 0,
      text: 0,
      other: 0
    };

    attachments.forEach(att => {
      counts[att.type_category] = (counts[att.type_category] || 0) + 1;
    });

    return counts;
  }, [attachments]);

  const totalSize = useMemo(() => {
    return attachments.reduce((sum, att) => sum + att.file_size, 0);
  }, [attachments]);

  const formatTotalSize = (bytes: number) => {
    for (const unit of ['B', 'KB', 'MB', 'GB']) {
      if (bytes < 1024.0) return `${bytes.toFixed(1)} ${unit}`;
      bytes /= 1024.0;
    }
    return `${bytes.toFixed(1)} TB`;
  };

  if (selectedAttachment) {
    return (
      <AttachmentViewer
        attachment={selectedAttachment}
        onClose={() => setSelectedAttachment(null)}
        vaultBasePath={vaultBasePath}
      />
    );
  }

  return (
    <div style={{
      display: 'flex',
      flexDirection: 'column',
      height: '100%',
      backgroundColor: 'var(--background-primary)'
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        borderBottom: '1px solid var(--background-modifier-border)',
        backgroundColor: 'var(--background-secondary)'
      }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' }}>
          <h3 style={{ margin: 0, fontSize: '16px', fontWeight: '600' }}>
            Attachments ({filteredAttachments.length} / {attachments.length})
          </h3>
          <button onClick={onClose} className="aip-btn" style={{ padding: '4px 12px' }}>
            × Close
          </button>
        </div>

        {/* Search and Filters */}
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="Search attachments..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{
              flex: 1,
              minWidth: '200px',
              padding: '6px 10px',
              border: '1px solid var(--background-modifier-border)',
              borderRadius: '4px',
              backgroundColor: 'var(--background-primary)',
              fontSize: '13px'
            }}
          />
          
          <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
            {(['all', 'image', 'video', 'audio', 'document', 'text', 'other'] as const).map(type => (
              <button
                key={type}
                onClick={() => setTypeFilter(type)}
                style={{
                  padding: '4px 8px',
                  fontSize: '11px',
                  border: '1px solid var(--background-modifier-border)',
                  borderRadius: '4px',
                  backgroundColor: typeFilter === type 
                    ? 'var(--aihp-accent)' 
                    : 'var(--background-primary)',
                  color: typeFilter === type 
                    ? 'var(--text-on-accent)' 
                    : 'var(--text-normal)',
                  cursor: 'pointer'
                }}
                title={`${type.charAt(0).toUpperCase() + type.slice(1)} (${typeCounts[type]})`}
              >
                {type === 'all' ? 'All' : type.charAt(0).toUpperCase() + type.slice(1)} ({typeCounts[type]})
              </button>
            ))}
          </div>

          <div style={{ display: 'flex', gap: '4px' }}>
            <button
              onClick={() => setViewMode('grid')}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                border: '1px solid var(--background-modifier-border)',
                borderRadius: '4px',
                backgroundColor: viewMode === 'grid' 
                  ? 'var(--background-modifier-hover)' 
                  : 'var(--background-primary)',
                cursor: 'pointer'
              }}
            >
              ⊞ Grid
            </button>
            <button
              onClick={() => setViewMode('list')}
              style={{
                padding: '4px 8px',
                fontSize: '11px',
                border: '1px solid var(--background-modifier-border)',
                borderRadius: '4px',
                backgroundColor: viewMode === 'list' 
                  ? 'var(--background-modifier-hover)' 
                  : 'var(--background-primary)',
                cursor: 'pointer'
              }}
            >
              ☰ List
            </button>
          </div>
        </div>

        {/* Stats */}
        <div style={{ 
          fontSize: '11px', 
          opacity: 0.7, 
          marginTop: '8px',
          display: 'flex',
          gap: '12px'
        }}>
          <span>Total size: {formatTotalSize(totalSize)}</span>
          <span>Large files ({'>'}10MB): {attachments.filter(a => a.file_size > LARGE_FILE_THRESHOLD).length}</span>
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        overflow: 'auto',
        padding: viewMode === 'grid' ? '16px' : '8px'
      }}>
        {filteredAttachments.length === 0 ? (
          <div style={{
            textAlign: 'center',
            padding: '40px',
            opacity: 0.6
          }}>
            <div style={{ fontSize: '48px', marginBottom: '16px' }}>📎</div>
            <div>No attachments found</div>
            {(typeFilter !== 'all' || searchQuery) && (
              <div style={{ fontSize: '12px', marginTop: '8px' }}>
                Try adjusting your filters
              </div>
            )}
          </div>
        ) : viewMode === 'grid' ? (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: '12px'
          }}>
            {filteredAttachments.map(att => (
              <div
                key={att.id}
                onClick={() => setSelectedAttachment(att)}
                style={{
                  border: '1px solid var(--background-modifier-border)',
                  borderRadius: '6px',
                  padding: '8px',
                  backgroundColor: 'var(--background-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  position: 'relative',
                  overflow: 'hidden'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--aihp-accent)';
                  e.currentTarget.style.transform = 'translateY(-2px)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--background-modifier-border)';
                  e.currentTarget.style.transform = 'translateY(0)';
                }}
              >
                {att.type_category === 'image' && att.is_accessible ? (
                  <div style={{
                    width: '100%',
                    height: '120px',
                    backgroundColor: 'var(--background-primary)',
                    borderRadius: '4px',
                    marginBottom: '8px',
                    overflow: 'hidden',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    position: 'relative'
                  }}>
                    <img
                      src={`file:///${att.accessible_path?.replace(/\\/g, '/')}`}
                      alt={att.file_name}
                      style={{
                        maxWidth: '100%',
                        maxHeight: '100%',
                        objectFit: 'contain'
                      }}
                      onError={(e) => {
                        (e.target as HTMLImageElement).style.display = 'none';
                      }}
                    />
                    {att.file_size > LARGE_FILE_THRESHOLD && (
                      <div style={{
                        position: 'absolute',
                        top: '4px',
                        right: '4px',
                        backgroundColor: 'rgba(0,0,0,0.7)',
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '3px',
                        fontSize: '10px'
                      }}>
                        Large
                      </div>
                    )}
                  </div>
                ) : (
                  <div style={{
                    width: '100%',
                    height: '120px',
                    backgroundColor: 'var(--background-primary)',
                    borderRadius: '4px',
                    marginBottom: '8px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontSize: '48px',
                    opacity: 0.5
                  }}>
                    {att.type_category === 'document' && '📄'}
                    {att.type_category === 'video' && '🎥'}
                    {att.type_category === 'audio' && '🎵'}
                    {att.type_category === 'text' && '📝'}
                    {att.type_category === 'other' && '📎'}
                  </div>
                )}
                <div style={{ fontSize: '12px', fontWeight: '600', marginBottom: '4px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {att.file_name}
                </div>
                <div style={{ fontSize: '10px', opacity: 0.7 }}>
                  {att.file_size_formatted} • {att.mime_type.split('/')[1] || att.mime_type}
                </div>
                {!att.is_accessible && (
                  <div style={{ fontSize: '10px', color: 'var(--text-error)', marginTop: '4px' }}>
                    ⚠ {att.storage_status}
                  </div>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
            {filteredAttachments.map(att => (
              <div
                key={att.id}
                onClick={() => setSelectedAttachment(att)}
                style={{
                  border: '1px solid var(--background-modifier-border)',
                  borderRadius: '4px',
                  padding: '12px',
                  backgroundColor: 'var(--background-secondary)',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = 'var(--aihp-accent)';
                  e.currentTarget.style.backgroundColor = 'var(--background-modifier-hover)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = 'var(--background-modifier-border)';
                  e.currentTarget.style.backgroundColor = 'var(--background-secondary)';
                }}
              >
                <div style={{ fontSize: '24px', opacity: 0.7 }}>
                  {att.type_category === 'image' && '🖼️'}
                  {att.type_category === 'document' && '📄'}
                  {att.type_category === 'video' && '🎥'}
                  {att.type_category === 'audio' && '🎵'}
                  {att.type_category === 'text' && '📝'}
                  {att.type_category === 'other' && '📎'}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: '600', marginBottom: '4px' }}>
                    {att.file_name}
                  </div>
                  <div style={{ fontSize: '11px', opacity: 0.7 }}>
                    {att.file_size_formatted} • {att.mime_type} • {att.storage_status}
                  </div>
                </div>
                {att.file_size > LARGE_FILE_THRESHOLD && (
                  <div style={{
                    padding: '4px 8px',
                    backgroundColor: 'var(--background-modifier-border)',
                    borderRadius: '3px',
                    fontSize: '10px',
                    color: 'var(--text-warning)'
                  }}>
                    Large
                  </div>
                )}
                {!att.is_accessible && (
                  <div style={{
                    padding: '4px 8px',
                    backgroundColor: 'var(--background-modifier-border)',
                    borderRadius: '3px',
                    fontSize: '10px',
                    color: 'var(--text-error)'
                  }}>
                    ⚠ Not accessible
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};

