import React, { useState, useEffect, useRef } from 'react';
import { Notice } from 'obsidian';

interface CollectionGripperProps {
  text: string;
  collections: Array<{ id: string; label: string; color?: string }>;
  onAddToCollection: (collectionId: string, text: string) => void;
  position: { x: number; y: number };
  onClose: () => void;
}

export function CollectionGripper({ text, collections, onAddToCollection, position, onClose }: CollectionGripperProps) {
  const [isDragging, setIsDragging] = useState(false);
  const gripperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (gripperRef.current && !gripperRef.current.contains(e.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleDragStart = (e: React.DragEvent, collectionId: string) => {
    e.dataTransfer.setData('text/plain', text);
    e.dataTransfer.effectAllowed = 'copy';
    setIsDragging(true);
  };

  const handleClick = (collectionId: string) => {
    onAddToCollection(collectionId, text);
    new Notice(`Added to ${collections.find(c => c.id === collectionId)?.label || 'collection'}`);
    onClose();
  };

  const handleRightClick = (e: React.MouseEvent, collectionId: string) => {
    e.preventDefault();
    handleClick(collectionId);
  };

  if (!text.trim()) return null;

  return (
    <div
      ref={gripperRef}
      style={{
        position: 'fixed',
        left: `${position.x}px`,
        top: `${position.y}px`,
        zIndex: 10000,
        background: 'var(--background-primary)',
        border: '2px solid var(--interactive-accent)',
        borderRadius: '8px',
        padding: '8px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        minWidth: '200px',
        maxWidth: '300px'
      }}
      onClick={(e) => e.stopPropagation()}
    >
      <div style={{
        fontSize: '11px',
        fontWeight: '700',
        color: '#ffffff',
        marginBottom: '6px',
        paddingBottom: '6px',
        borderBottom: '1px solid var(--background-modifier-border)'
      }}>
        📎 Add to Collection
      </div>
      <div style={{
        fontSize: '10px',
        color: 'rgba(255,255,255,0.7)',
        marginBottom: '8px',
        maxHeight: '60px',
        overflow: 'hidden',
        textOverflow: 'ellipsis'
      }}>
        {text.substring(0, 100)}{text.length > 100 ? '...' : ''}
      </div>
      <div style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '4px',
        maxHeight: '200px',
        overflowY: 'auto'
      }}>
        {collections.length === 0 ? (
          <div style={{ fontSize: '10px', color: 'rgba(255,255,255,0.5)', padding: '8px', textAlign: 'center' }}>
            No collections available
          </div>
        ) : (
          collections.map(collection => (
            <button
              key={collection.id}
              draggable
              onDragStart={(e) => handleDragStart(e, collection.id)}
              onClick={() => handleClick(collection.id)}
              onContextMenu={(e) => handleRightClick(e, collection.id)}
              style={{
                padding: '6px 10px',
                fontSize: '11px',
                fontWeight: '700',
                background: collection.color || 'var(--interactive-accent)',
                color: '#ffffff',
                border: 'none',
                borderRadius: '4px',
                cursor: 'pointer',
                textAlign: 'left',
                display: 'flex',
                alignItems: 'center',
                gap: '6px',
                transition: 'all 0.2s ease'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.transform = 'translateX(4px)';
                e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.transform = 'translateX(0)';
                e.currentTarget.style.boxShadow = 'none';
              }}
              title={`Click or drag to add to ${collection.label}. Right-click for quick add.`}
            >
              <span>☰</span>
              <span style={{ flex: 1 }}>{collection.label}</span>
            </button>
          ))
        )}
      </div>
      <div style={{
        fontSize: '9px',
        color: 'rgba(255,255,255,0.5)',
        marginTop: '6px',
        paddingTop: '6px',
        borderTop: '1px solid var(--background-modifier-border)',
        textAlign: 'center'
      }}>
        Click, drag, or right-click to add
      </div>
    </div>
  );
}

