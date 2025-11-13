import React, { useState, useEffect, useRef, useMemo } from 'react';

interface AccentTheme {
  base: string;
  hover: string;
  border: string;
  glow: string;
}

interface SearchWithHistoryProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxHistory?: number;
  showSuggestions?: boolean;
  accentTheme?: AccentTheme;
  trendingLimit?: number;
  onSaveSearch?: (query: string) => void; // Callback to save search to collection/project
  collections?: Array<{ id: string; label: string }>; // Available collections for saving
}

interface SearchHistoryItem {
  query: string;
  timestamp: number;
  count: number; // How many times this query was used
}

export const SearchWithHistory: React.FC<SearchWithHistoryProps> = ({
  value,
  onChange,
  onSearch,
  placeholder = "Search...",
  disabled = false,
  maxHistory = 50,
  showSuggestions = true,
  accentTheme,
  trendingLimit = 4,
  onSaveSearch,
  collections = []
}) => {
  const [searchHistory, setSearchHistory] = useState<SearchHistoryItem[]>([]);
  const [showSuggestionsDropdown, setShowSuggestionsDropdown] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Load search history from localStorage
  useEffect(() => {
    const stored = localStorage.getItem('aihp-search-history');
    if (stored) {
      try {
        const history = JSON.parse(stored) as SearchHistoryItem[];
        setSearchHistory(history);
      } catch (e) {
        console.error('Failed to load search history:', e);
      }
    }
  }, []);

  // Save search history to localStorage
  const saveSearchHistory = (history: SearchHistoryItem[]) => {
    try {
      localStorage.setItem('aihp-search-history', JSON.stringify(history));
    } catch (e) {
      console.error('Failed to save search history:', e);
    }
  };

  // Add search to history
  const addToHistory = (query: string) => {
    if (!query.trim()) return;
    
    const trimmedQuery = query.trim();
    setSearchHistory(prev => {
      const existing = prev.find(item => item.query.toLowerCase() === trimmedQuery.toLowerCase());
      let updated: SearchHistoryItem[];
      
      if (existing) {
        // Update existing: increment count and update timestamp
        updated = prev.map(item =>
          item.query.toLowerCase() === trimmedQuery.toLowerCase()
            ? { ...item, count: item.count + 1, timestamp: Date.now() }
            : item
        );
      } else {
        // Add new entry
        updated = [
          { query: trimmedQuery, timestamp: Date.now(), count: 1 },
          ...prev
        ].slice(0, maxHistory); // Keep only maxHistory items
      }
      
      // Sort by most recent first, then by count
      updated.sort((a, b) => {
        if (a.count !== b.count) return b.count - a.count;
        return b.timestamp - a.timestamp;
      });
      
      saveSearchHistory(updated);
      return updated;
    });
  };

  // Generate suggestions based on current input and history
  const suggestions = useMemo(() => {
    if (!value.trim() || !showSuggestions) {
      // Show recent searches when input is empty
      return searchHistory.slice(0, 10);
    }

    const queryLower = value.toLowerCase();
    const matched: SearchHistoryItem[] = [];
    const partial: SearchHistoryItem[] = [];

    // Find exact and partial matches in history
    searchHistory.forEach(item => {
      const itemLower = item.query.toLowerCase();
      if (itemLower === queryLower) {
        // Exact match - don't show duplicates
        return;
      } else if (itemLower.startsWith(queryLower)) {
        matched.push(item);
      } else if (itemLower.includes(queryLower)) {
        partial.push(item);
      }
    });

    // Combine: exact matches first, then partial matches
    return [...matched, ...partial].slice(0, 10);
  }, [value, searchHistory, showSuggestions]);

  const trendingSuggestions = useMemo(() => {
    const sorted = [...searchHistory];
    sorted.sort((a, b) => {
      if (a.count !== b.count) return b.count - a.count;
      return b.timestamp - a.timestamp;
    });
    return sorted.slice(0, trendingLimit);
  }, [searchHistory, trendingLimit]);

  const accentWrapperStyle = accentTheme
    ? {
        position: 'relative' as const,
        display: 'flex',
        alignItems: 'center',
        gap: '10px',
        padding: '10px 16px',
        borderRadius: '14px',
        border: `1px solid ${accentTheme.border}`,
        background: `linear-gradient(135deg, ${accentTheme.base}, ${accentTheme.hover})`,
        boxShadow: `inset 0 2px 4px rgba(0,0,0,0.45), 0 15px 28px ${accentTheme.glow}`,
      }
    : {
        position: 'relative' as const,
        display: 'flex',
        alignItems: 'center',
      };

  const inputStyle: React.CSSProperties = {
    flex: 1,
    minWidth: '320px',
    maxWidth: '520px',
    fontSize: '14px',
    padding: '8px 4px',
    border: 'none',
    outline: 'none',
    background: accentTheme ? 'transparent' : 'var(--background-primary)',
    color: '#ffffff',
    fontWeight: 700,
  };

  // Handle input change
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    onChange(newValue);
    setShowSuggestionsDropdown(true);
    setSelectedIndex(-1);
  };

  // Handle input focus
  const handleFocus = () => {
    if (showSuggestions && (value.trim() || searchHistory.length > 0)) {
      setShowSuggestionsDropdown(true);
    }
  };

  // Handle input blur (with delay to allow clicks on suggestions)
  const handleBlur = () => {
    setTimeout(() => {
      setShowSuggestionsDropdown(false);
      setSelectedIndex(-1);
    }, 200);
  };

  // Handle key events
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!showSuggestionsDropdown || suggestions.length === 0) {
      if (e.key === 'Enter') {
        handleSearch();
      }
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setSelectedIndex(prev => 
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setSelectedIndex(prev => prev > 0 ? prev - 1 : -1);
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < suggestions.length) {
          selectSuggestion(suggestions[selectedIndex].query);
        } else {
          handleSearch();
        }
        break;
      case 'Escape':
        setShowSuggestionsDropdown(false);
        setSelectedIndex(-1);
        break;
    }
  };

  // Select a suggestion
  const selectSuggestion = (query: string) => {
    onChange(query);
    setShowSuggestionsDropdown(false);
    setSelectedIndex(-1);
    inputRef.current?.focus();
    handleSearch(query);
  };

  // Handle search
  const handleSearch = (queryOverride?: string) => {
    const query = queryOverride || value.trim();
    if (query) {
      addToHistory(query);
      onSearch(query);
    }
    setShowSuggestionsDropdown(false);
    setSelectedIndex(-1);
  };

  // Clear search history
  const clearHistory = (e: React.MouseEvent) => {
    e.stopPropagation();
    setSearchHistory([]);
    saveSearchHistory([]);
  };

  // Remove specific history item
  const removeHistoryItem = (e: React.MouseEvent, query: string) => {
    e.stopPropagation();
    setSearchHistory(prev => {
      const updated = prev.filter(item => item.query !== query);
      saveSearchHistory(updated);
      return updated;
    });
  };

  const dropdownTop = accentTheme
    ? trendingSuggestions.length > 0 ? '108px' : '72px'
    : trendingSuggestions.length > 0 ? '80px' : '48px';

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
        <div style={accentWrapperStyle}>
          <span style={{ fontSize: '18px', opacity: accentTheme ? 0.85 : 0.65 }}>🔍</span>
          <input
            ref={inputRef}
            type="text"
            className="aihp-input search"
            placeholder={placeholder}
            value={value}
            onChange={handleChange}
            onFocus={handleFocus}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
            disabled={disabled}
            style={inputStyle}
          />
          <style>{`
            input.search::placeholder {
              color: rgba(255, 255, 255, 0.6) !important;
              font-weight: 700 !important;
            }
          `}</style>
          {onSaveSearch && value.trim() && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSaveSearch(value.trim());
              }}
              style={{
                background: accentTheme ? 'rgba(0,0,0,0.25)' : 'transparent',
                border: 'none',
                color: '#ffffff',
                fontSize: '14px',
                padding: '4px 8px',
                cursor: 'pointer',
                borderRadius: '4px',
                fontWeight: '700'
              }}
              title="Save search to collection/project"
            >
              💾
            </button>
          )}
          {(value.trim() || searchHistory.length > 0) && (
            <button
              type="button"
              onClick={clearHistory}
              style={{
                background: accentTheme ? 'rgba(0,0,0,0.25)' : 'transparent',
                border: 'none',
                color: accentTheme ? '#ffffffcc' : 'var(--text-muted)',
                cursor: 'pointer',
                padding: '4px 6px',
                fontSize: '12px',
                borderRadius: '999px',
                display: 'flex',
                alignItems: 'center',
              }}
              title="Clear search history"
              onMouseEnter={(e) => {
                e.currentTarget.style.opacity = '1';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.opacity = '0.8';
              }}
            >
              🗑️
            </button>
          )}
        </div>

        {trendingSuggestions.length > 0 && (
          <div style={{ 
            display: 'flex', 
            flexWrap: 'wrap', 
            gap: '6px', 
            paddingLeft: accentTheme ? '4px' : '12px',
            paddingTop: '4px'
          }}>
            <span style={{ 
              fontSize: '10px', 
              color: accentTheme ? 'rgba(255,255,255,0.7)' : 'var(--text-muted)',
              fontWeight: 700,
              marginRight: '4px',
              alignSelf: 'center'
            }}>Recent:</span>
            {trendingSuggestions.map(item => (
              <button
                key={`trend-${item.query}`}
                type="button"
                onClick={() => selectSuggestion(item.query)}
                style={{
                  fontSize: '11px',
                  padding: '4px 8px',
                  borderRadius: '999px',
                  border: accentTheme ? 'none' : '1px solid var(--background-modifier-border)',
                  background: accentTheme ? 'rgba(0,0,0,0.25)' : 'var(--background-secondary)',
                  color: accentTheme ? '#ffffff' : '#ffffff',
                  fontWeight: 700,
                  cursor: 'pointer',
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: '4px',
                }}
                title={`Used ${item.count} time${item.count !== 1 ? 's' : ''}`}
              >
                <span>⭐</span>
                <span>{item.query}</span>
                {item.count > 1 && (
                  <span style={{ fontSize: '9px', opacity: 0.8 }}>({item.count})</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Suggestions Dropdown */}
      {showSuggestionsDropdown && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: dropdownTop,
            left: accentTheme ? '8px' : '12px',
            right: accentTheme ? '8px' : '12px',
            marginTop: '4px',
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '8px',
            boxShadow: '0 8px 24px rgba(0, 0, 0, 0.45)',
            maxHeight: '320px',
            overflowY: 'auto',
            zIndex: 1000,
            fontSize: '13px'
          }}
        >
          {suggestions.map((item, index) => (
            <div
              key={`${item.query}-${item.timestamp}`}
              onClick={() => selectSuggestion(item.query)}
              onMouseEnter={() => setSelectedIndex(index)}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                backgroundColor: selectedIndex === index
                  ? 'var(--background-modifier-hover)'
                  : 'transparent',
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                borderBottom: index < suggestions.length - 1
                  ? '1px solid var(--background-modifier-border)'
                  : 'none'
              }}
            >
              <span style={{
                flex: 1,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
                color: 'var(--text-normal)'
              }}>
                {item.query}
              </span>
              <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '8px',
                marginLeft: '12px',
                fontSize: '11px',
                color: 'var(--text-muted)'
              }}>
                {item.count > 1 && (
                  <span title={`Used ${item.count} times`}>
                    {item.count}×
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => removeHistoryItem(e, item.query)}
                  style={{
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--text-muted)',
                    cursor: 'pointer',
                    padding: '2px 4px',
                    fontSize: '12px',
                    opacity: 0.6
                  }}
                  title="Remove from history"
                  onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = '1';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = '0.6';
                  }}
                >
                  ×
                </button>
              </div>
            </div>
          ))}
          
          {suggestions.length > 0 && (
            <div style={{
              padding: '6px 12px',
              fontSize: '11px',
              color: 'var(--text-muted)',
              borderTop: '1px solid var(--background-modifier-border)',
              backgroundColor: 'var(--background-modifier-hover)'
            }}>
              Press Enter to search • Arrow keys to navigate • Esc to close
            </div>
          )}
        </div>
      )}
    </div>
  );
};

