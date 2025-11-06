import React, { useState, useEffect, useRef, useMemo } from 'react';

interface SearchWithHistoryProps {
  value: string;
  onChange: (value: string) => void;
  onSearch: (query: string) => void;
  placeholder?: string;
  disabled?: boolean;
  maxHistory?: number;
  showSuggestions?: boolean;
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
  showSuggestions = true
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

  return (
    <div style={{ position: 'relative', width: '100%' }}>
      <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
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
          style={{
            flex: 1,
            minWidth: '260px',
            maxWidth: '380px',
            fontSize: '13px',
            padding: '4px 10px',
            marginLeft: '8px',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '4px',
            background: 'var(--background-primary)',
            paddingRight: value.trim() || searchHistory.length > 0 ? '28px' : '10px'
          }}
        />
        {(value.trim() || searchHistory.length > 0) && (
          <button
            type="button"
            onClick={clearHistory}
            style={{
              position: 'absolute',
              right: '8px',
              top: '50%',
              transform: 'translateY(-50%)',
              background: 'transparent',
              border: 'none',
              color: 'var(--text-muted)',
              cursor: 'pointer',
              padding: '2px 4px',
              fontSize: '12px',
              opacity: 0.6,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center'
            }}
            title="Clear search history"
            onMouseEnter={(e) => {
              e.currentTarget.style.opacity = '1';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = '0.6';
            }}
          >
            🗑️
          </button>
        )}
      </div>

      {/* Suggestions Dropdown */}
      {showSuggestionsDropdown && suggestions.length > 0 && (
        <div
          ref={dropdownRef}
          style={{
            position: 'absolute',
            top: '100%',
            left: '12px',
            right: '12px',
            marginTop: '4px',
            backgroundColor: 'var(--background-primary)',
            border: '1px solid var(--background-modifier-border)',
            borderRadius: '4px',
            boxShadow: '0 4px 12px rgba(0, 0, 0, 0.3)',
            maxHeight: '300px',
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

