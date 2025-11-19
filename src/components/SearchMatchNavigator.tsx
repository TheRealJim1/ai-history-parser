import React, { useState, useEffect, useRef, useCallback } from 'react';

interface SearchMatchNavigatorProps {
  query: string;
  totalMatches: number;
  currentMatchIndex: number;
  onNavigate: (index: number) => void;
  onClose?: () => void;
}

export const SearchMatchNavigator: React.FC<SearchMatchNavigatorProps> = ({
  query,
  totalMatches,
  currentMatchIndex,
  onNavigate,
  onClose
}) => {
  const [showBubbles, setShowBubbles] = useState(false);
  const bubblesRef = useRef<HTMLDivElement>(null);

  // Show bubbles when there are matches
  useEffect(() => {
    if (totalMatches > 0 && query.trim()) {
      setShowBubbles(true);
    } else {
      setShowBubbles(false);
    }
  }, [totalMatches, query]);

  if (!query.trim() || totalMatches === 0) {
    return null;
  }

  const handlePrevious = () => {
    const prevIndex = currentMatchIndex <= 1 ? totalMatches : currentMatchIndex - 1;
    onNavigate(prevIndex);
  };

  const handleNext = () => {
    const nextIndex = currentMatchIndex >= totalMatches ? 1 : currentMatchIndex + 1;
    onNavigate(nextIndex);
  };

  const handleBubbleClick = (index: number) => {
    onNavigate(index);
  };

  // Generate bubbles (show up to 20, then show "..." if more)
  const maxVisibleBubbles = 20;
  const showEllipsis = totalMatches > maxVisibleBubbles;
  const visibleBubbles = Math.min(totalMatches, maxVisibleBubbles);

  return (
    <div style={{
      position: 'fixed',
      bottom: '20px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: 10001,
      background: 'var(--background-primary)',
      border: '2px solid var(--interactive-accent)',
      borderRadius: '12px',
      padding: '8px 12px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
      display: 'flex',
      alignItems: 'center',
      gap: '8px',
      minWidth: '300px',
      maxWidth: '90vw'
    }}>
      {/* Close button */}
      {onClose && (
        <button
          onClick={onClose}
          style={{
            background: 'transparent',
            border: 'none',
            color: 'var(--text-normal)',
            cursor: 'pointer',
            padding: '4px',
            fontSize: '14px',
            lineHeight: '1',
            borderRadius: '4px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '20px',
            height: '20px'
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = 'var(--background-modifier-hover)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = 'transparent';
          }}
          title="Close match navigator"
        >
          ×
        </button>
      )}

      {/* Previous button */}
      <button
        onClick={handlePrevious}
        disabled={totalMatches === 0}
        style={{
          background: currentMatchIndex <= 1 ? 'var(--background-modifier-border)' : 'var(--interactive-accent)',
          border: 'none',
          color: '#ffffff',
          cursor: currentMatchIndex <= 1 ? 'not-allowed' : 'pointer',
          padding: '6px 10px',
          borderRadius: '6px',
          fontSize: '12px',
          fontWeight: '700',
          display: 'flex',
          alignItems: 'center',
          opacity: currentMatchIndex <= 1 ? 0.5 : 1
        }}
        title="Previous match"
      >
        ◀
      </button>

      {/* Match counter */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        minWidth: '80px',
        justifyContent: 'center'
      }}>
        <span style={{
          fontSize: '13px',
          fontWeight: '700',
          color: 'var(--text-normal)',
          whiteSpace: 'nowrap'
        }}>
          {currentMatchIndex} of {totalMatches}
        </span>
      </div>

      {/* Next button */}
      <button
        onClick={handleNext}
        disabled={totalMatches === 0}
        style={{
          background: currentMatchIndex >= totalMatches ? 'var(--background-modifier-border)' : 'var(--interactive-accent)',
          border: 'none',
          color: '#ffffff',
          cursor: currentMatchIndex >= totalMatches ? 'not-allowed' : 'pointer',
          padding: '6px 10px',
          borderRadius: '6px',
          fontSize: '12px',
          fontWeight: '700',
          display: 'flex',
          alignItems: 'center',
          opacity: currentMatchIndex >= totalMatches ? 0.5 : 1
        }}
        title="Next match"
      >
        ▶
      </button>

      {/* Bubbles toggle */}
      <button
        onClick={() => setShowBubbles(!showBubbles)}
        style={{
          background: showBubbles ? 'var(--interactive-accent)' : 'var(--background-modifier-border)',
          border: 'none',
          color: '#ffffff',
          cursor: 'pointer',
          padding: '6px 10px',
          borderRadius: '6px',
          fontSize: '11px',
          fontWeight: '700',
          marginLeft: '4px'
        }}
        title={showBubbles ? "Hide match bubbles" : "Show match bubbles"}
      >
        {showBubbles ? '🔽' : '🔺'}
      </button>

      {/* Bubbles container */}
      {showBubbles && (
        <div
          ref={bubblesRef}
          style={{
            position: 'absolute',
            bottom: '100%',
            left: '50%',
            transform: 'translateX(-50%)',
            marginBottom: '8px',
            background: 'var(--background-primary)',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '8px',
            padding: '8px',
            maxWidth: '90vw',
            maxHeight: '200px',
            overflowY: 'auto',
            display: 'flex',
            flexWrap: 'wrap',
            gap: '4px',
            boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
            zIndex: 10002
          }}
        >
          {/* Show first few bubbles */}
          {Array.from({ length: Math.min(visibleBubbles, 10) }, (_, i) => i + 1).map((index) => (
            <button
              key={index}
              onClick={() => handleBubbleClick(index)}
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                border: '2px solid',
                borderColor: index === currentMatchIndex ? 'var(--interactive-accent)' : 'var(--background-modifier-border)',
                background: index === currentMatchIndex 
                  ? 'var(--interactive-accent)' 
                  : index < currentMatchIndex 
                    ? 'var(--background-modifier-hover)' 
                    : 'var(--background-primary)',
                color: index === currentMatchIndex ? '#ffffff' : 'var(--text-normal)',
                cursor: 'pointer',
                fontSize: '11px',
                fontWeight: '700',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'all 0.2s ease',
                boxShadow: index === currentMatchIndex ? '0 2px 8px rgba(0,0,0,0.3)' : 'none'
              }}
              onMouseEnter={(e) => {
                if (index !== currentMatchIndex) {
                  e.currentTarget.style.transform = 'scale(1.1)';
                  e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
                }
              }}
              onMouseLeave={(e) => {
                if (index !== currentMatchIndex) {
                  e.currentTarget.style.transform = 'scale(1)';
                  e.currentTarget.style.boxShadow = 'none';
                }
              }}
              title={`Go to match ${index}`}
            >
              {index}
            </button>
          ))}

          {/* Ellipsis if more matches */}
          {showEllipsis && (
            <>
              <span style={{
                padding: '0 4px',
                color: 'var(--text-muted)',
                fontSize: '12px',
                alignSelf: 'center'
              }}>
                ...
              </span>
              {/* Show last few bubbles */}
              {Array.from({ length: Math.min(5, totalMatches - visibleBubbles + 5) }, (_, i) => {
                const index = totalMatches - 4 + i;
                if (index <= visibleBubbles) return null;
                return (
                  <button
                    key={index}
                    onClick={() => handleBubbleClick(index)}
                    style={{
                      width: '28px',
                      height: '28px',
                      borderRadius: '50%',
                      border: '2px solid',
                      borderColor: index === currentMatchIndex ? 'var(--interactive-accent)' : 'var(--background-modifier-border)',
                      background: index === currentMatchIndex 
                        ? 'var(--interactive-accent)' 
                        : index < currentMatchIndex 
                          ? 'var(--background-modifier-hover)' 
                          : 'var(--background-primary)',
                      color: index === currentMatchIndex ? '#ffffff' : 'var(--text-normal)',
                      cursor: 'pointer',
                      fontSize: '11px',
                      fontWeight: '700',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      transition: 'all 0.2s ease',
                      boxShadow: index === currentMatchIndex ? '0 2px 8px rgba(0,0,0,0.3)' : 'none'
                    }}
                    onMouseEnter={(e) => {
                      if (index !== currentMatchIndex) {
                        e.currentTarget.style.transform = 'scale(1.1)';
                        e.currentTarget.style.boxShadow = '0 2px 6px rgba(0,0,0,0.2)';
                      }
                    }}
                    onMouseLeave={(e) => {
                      if (index !== currentMatchIndex) {
                        e.currentTarget.style.transform = 'scale(1)';
                        e.currentTarget.style.boxShadow = 'none';
                      }
                    }}
                    title={`Go to match ${index}`}
                  >
                    {index}
                  </button>
                );
              })}
            </>
          )}
        </div>
      )}
    </div>
  );
};


