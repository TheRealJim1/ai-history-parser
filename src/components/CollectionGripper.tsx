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
  const [isExpanded, setIsExpanded] = useState(false);
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
        borderRadius: isExpanded ? '8px' : '20px',
        padding: isExpanded ? '8px' : '6px 12px',
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        minWidth: isExpanded ? '200px' : 'auto',
        maxWidth: isExpanded ? '220px' : 'none',
        transition: 'all 0.2s ease',
        cursor: isExpanded ? 'default' : 'pointer'
      }}
      onClick={(e) => {
        e.stopPropagation();
        if (!isExpanded) {
          setIsExpanded(true);
        }
      }}
      onMouseEnter={() => {
        if (!isExpanded) {
          setIsExpanded(true);
        }
      }}
    >
      {isExpanded ? (
        <>
          <div style={{
            fontSize: '11px',
            fontWeight: '700',
            color: '#ffffff',
            marginBottom: '6px',
            paddingBottom: '6px',
            borderBottom: '1px solid var(--background-modifier-border)',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center'
          }}>
            <span>📎 Add to Collection</span>
            <button
              onClick={(e) => {
                e.stopPropagation();
                onClose();
              }}
              style={{
                background: 'transparent',
                border: 'none',
                color: '#ffffff',
                cursor: 'pointer',
                fontSize: '14px',
                padding: '0',
                width: '18px',
                height: '18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: '3px'
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = 'rgba(255,255,255,0.1)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = 'transparent';
              }}
              title="Close"
            >
              ×
            </button>
          </div>
          <div style={{
            fontSize: '9px',
            color: 'rgba(255,255,255,0.6)',
            marginBottom: '6px',
            maxHeight: '40px',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            lineHeight: '1.3'
          }}>
            {text.substring(0, 80)}{text.length > 80 ? '...' : ''}
          </div>
          <div style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '3px',
            maxHeight: '150px',
            overflowY: 'auto'
          }}>
            {collections.length === 0 ? (
              <div style={{ fontSize: '9px', color: 'rgba(255,255,255,0.5)', padding: '6px', textAlign: 'center' }}>
                No collections available
              </div>
            ) : (
              collections.slice(0, 5).map(collection => (
                <button
                  key={collection.id}
                  draggable
                  onDragStart={(e) => handleDragStart(e, collection.id)}
                  onClick={() => handleClick(collection.id)}
                  onContextMenu={(e) => handleRightClick(e, collection.id)}
                  style={{
                    padding: '5px 8px',
                    fontSize: '10px',
                    fontWeight: '600',
                    background: collection.color || 'var(--interactive-accent)',
                    color: '#ffffff',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '4px',
                    transition: 'all 0.2s ease'
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.transform = 'translateX(3px)';
                    e.currentTarget.style.boxShadow = '0 2px 4px rgba(0,0,0,0.2)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.transform = 'translateX(0)';
                    e.currentTarget.style.boxShadow = 'none';
                  }}
                  title={`Click or drag to add to ${collection.label}. Right-click for quick add.`}
                >
                  <span style={{ fontSize: '9px' }}>☰</span>
                  <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{collection.label}</span>
                </button>
              ))
            )}
            {collections.length > 5 && (
              <div style={{
                fontSize: '8px',
                color: 'rgba(255,255,255,0.5)',
                padding: '4px',
                textAlign: 'center',
                fontStyle: 'italic'
              }}>
                +{collections.length - 5} more (scroll in collections panel)
              </div>
            )}
          </div>
          <div style={{
            fontSize: '8px',
            color: 'rgba(255,255,255,0.4)',
            marginTop: '4px',
            paddingTop: '4px',
            borderTop: '1px solid var(--background-modifier-border)',
            textAlign: 'center'
          }}>
            Click, drag, or right-click
          </div>
        </>
      ) : (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '6px',
          fontSize: '11px',
          fontWeight: '700',
          color: '#ffffff'
        }}>
          <span>📎</span>
          <span>Add to Collection</span>
        </div>
      )}
    </div>
  );
}

