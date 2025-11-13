import React, { useState, useEffect, useRef } from 'react';
import { Notice } from 'obsidian';

export interface Attachment {
  id: number;
  conversation_id: string;
  message_id?: string;
  file_name: string;
  mime_type: string;
  file_size: number;
  file_size_formatted: string;
  sha256_hash?: string;
  storage_status: string;
  is_accessible: boolean;
  accessible_path?: string;
  type_category: 'image' | 'video' | 'audio' | 'document' | 'text' | 'other';
  created_at?: string;
}

interface AttachmentViewerProps {
  attachment: Attachment;
  onClose: () => void;
  vaultBasePath: string;
}

const LARGE_FILE_THRESHOLD = 10 * 1024 * 1024; // 10MB
const MAX_PREVIEW_SIZE = 5 * 1024 * 1024; // 5MB for preview

export const AttachmentViewer: React.FC<AttachmentViewerProps> = ({ 
  attachment, 
  onClose,
  vaultBasePath 
}) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageSrc, setImageSrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const imageRef = useRef<HTMLImageElement>(null);

  const isLargeFile = attachment.file_size > LARGE_FILE_THRESHOLD;
  const canPreview = attachment.type_category === 'image' && attachment.is_accessible;

  useEffect(() => {
    if (canPreview && attachment.accessible_path) {
      loadImage();
    } else {
      setLoading(false);
    }
  }, [attachment]);

  const loadImage = async () => {
    if (!attachment.accessible_path) {
      setError('File path not available');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      // For large files, use file:// URL instead of loading into memory
      if (isLargeFile) {
        // Use file:// protocol for large files (Obsidian can handle this)
        const fileUrl = `file:///${attachment.accessible_path.replace(/\\/g, '/')}`;
        setImageSrc(fileUrl);
        setLoading(false);
      } else {
        // For smaller files, we could load as data URL, but for Obsidian, file:// is better
        const fileUrl = `file:///${attachment.accessible_path.replace(/\\/g, '/')}`;
        setImageSrc(fileUrl);
        setLoading(false);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to load image');
      setLoading(false);
    }
  };

  const handleDownload = async () => {
    if (!attachment.accessible_path) {
      new Notice('File not accessible for download');
      return;
    }

    try {
      const fs = require('fs');
      const path = require('path');
      
      // Read file and create download
      const fileData = fs.readFileSync(attachment.accessible_path);
      const blob = new Blob([fileData], { type: attachment.mime_type });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = attachment.file_name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      
      new Notice(`Downloaded: ${attachment.file_name}`);
    } catch (err: any) {
      new Notice(`Download failed: ${err.message}`);
    }
  };

  const handleOpenExternal = () => {
    if (!attachment.accessible_path) {
      new Notice('File not accessible');
      return;
    }

    try {
      const { shell } = require('electron');
      shell.openPath(attachment.accessible_path);
    } catch (err: any) {
      new Notice(`Failed to open file: ${err.message}`);
    }
  };

  const handleZoomIn = () => setZoom(prev => Math.min(prev + 0.25, 5));
  const handleZoomOut = () => setZoom(prev => Math.max(prev - 0.25, 0.25));
  const handleZoomReset = () => setZoom(1);

  const handleMouseDown = (e: React.MouseEvent) => {
    if (zoom > 1) {
      setIsDragging(true);
      setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
    }
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (isDragging && zoom > 1) {
      setPosition({
        x: e.clientX - dragStart.x,
        y: e.clientY - dragStart.y
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  return (
    <div 
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: 'rgba(0, 0, 0, 0.85)',
        zIndex: 10000,
        display: 'flex',
        flexDirection: 'column',
        color: 'var(--text-normal)'
      }}
      onClick={(e) => {
        if (e.target === e.currentTarget) {
          onClose();
        }
      }}
    >
      {/* Header */}
      <div style={{
        padding: '12px 16px',
        backgroundColor: 'var(--background-secondary)',
        borderBottom: '1px solid var(--background-modifier-border)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center'
      }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontWeight: '600', fontSize: '14px', marginBottom: '4px' }}>
            {attachment.file_name}
          </div>
          <div style={{ fontSize: '12px', opacity: 0.7 }}>
            {attachment.file_size_formatted} • {attachment.mime_type} • {attachment.storage_status}
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px' }}>
          {canPreview && (
            <>
              <button onClick={handleZoomOut} className="aip-btn" title="Zoom out">−</button>
              <span style={{ padding: '4px 8px', fontSize: '12px' }}>{Math.round(zoom * 100)}%</span>
              <button onClick={handleZoomIn} className="aip-btn" title="Zoom in">+</button>
              <button onClick={handleZoomReset} className="aip-btn" title="Reset zoom">⌂</button>
            </>
          )}
          <button onClick={handleDownload} className="aip-btn" title="Download">
            ⬇️
          </button>
          <button onClick={handleOpenExternal} className="aip-btn" title="Open in external app">
            🔗
          </button>
          <button onClick={onClose} className="aip-btn" title="Close">×</button>
        </div>
      </div>

      {/* Content */}
      <div style={{
        flex: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        overflow: 'auto',
        padding: '20px',
        position: 'relative'
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      >
        {loading && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: '14px', opacity: 0.7 }}>Loading...</div>
          </div>
        )}

        {error && (
          <div style={{ textAlign: 'center', color: 'var(--text-error)' }}>
            <div style={{ fontSize: '14px', marginBottom: '8px' }}>Error loading file</div>
            <div style={{ fontSize: '12px', opacity: 0.7 }}>{error}</div>
          </div>
        )}

        {!loading && !error && canPreview && imageSrc && (
          <img
            ref={imageRef}
            src={imageSrc}
            alt={attachment.file_name}
            style={{
              maxWidth: '100%',
              maxHeight: '100%',
              transform: `scale(${zoom}) translate(${position.x / zoom}px, ${position.y / zoom}px)`,
              cursor: zoom > 1 ? (isDragging ? 'grabbing' : 'grab') : 'default',
              transition: isDragging ? 'none' : 'transform 0.1s ease-out'
            }}
            onMouseDown={handleMouseDown}
            onError={() => {
              setError('Failed to load image');
              setLoading(false);
            }}
            onLoad={() => setLoading(false)}
          />
        )}

        {!loading && !error && !canPreview && (
          <div style={{ textAlign: 'center', maxWidth: '600px' }}>
            <div style={{ fontSize: '48px', marginBottom: '16px', opacity: 0.5 }}>
              {attachment.type_category === 'document' && '📄'}
              {attachment.type_category === 'video' && '🎥'}
              {attachment.type_category === 'audio' && '🎵'}
              {attachment.type_category === 'text' && '📝'}
              {attachment.type_category === 'other' && '📎'}
            </div>
            <div style={{ fontSize: '16px', fontWeight: '600', marginBottom: '8px' }}>
              {attachment.file_name}
            </div>
            <div style={{ fontSize: '14px', opacity: 0.7, marginBottom: '16px' }}>
              {attachment.file_size_formatted} • {attachment.mime_type}
            </div>
            {isLargeFile && (
              <div style={{ 
                fontSize: '12px', 
                color: 'var(--text-warning)', 
                marginBottom: '16px',
                padding: '8px',
                backgroundColor: 'var(--background-modifier-border)',
                borderRadius: '4px'
              }}>
                ⚠️ Large file ({attachment.file_size_formatted}). Use download or open externally.
              </div>
            )}
            {!attachment.is_accessible && (
              <div style={{ 
                fontSize: '12px', 
                color: 'var(--text-error)', 
                marginBottom: '16px',
                padding: '8px',
                backgroundColor: 'var(--background-modifier-border)',
                borderRadius: '4px'
              }}>
                ⚠️ File not accessible ({attachment.storage_status})
              </div>
            )}
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center' }}>
              <button onClick={handleDownload} className="aip-btn" disabled={!attachment.is_accessible}>
                ⬇️ Download
              </button>
              <button onClick={handleOpenExternal} className="aip-btn" disabled={!attachment.is_accessible}>
                🔗 Open Externally
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

