export function matchesQuery(title:string, body:string, q:string, regex:boolean): boolean {
  const query = (q ?? '').trim();
  if (!query) return true;
  
  const searchText = (title + ' ' + body);
  const searchTextLower = searchText.toLowerCase();
  const queryLower = query.toLowerCase();
  
  if (regex) {
    try {
      const re = new RegExp(query, 'i');
      return re.test(title) || re.test(body);
    } catch {
      // If regex is invalid, fall back to literal search
      return searchTextLower.includes(queryLower);
    }
  }
  
  // For non-regex searches, use smarter matching
  // Check if query appears in the text
  if (!searchTextLower.includes(queryLower)) {
    return false;
  }
  
  // For alphanumeric codes (like "APDHBC"), require exact match with word boundaries
  // This prevents matching "APDHBC" inside "testAPDHBC123" or "APDHBCtest"
  if (/^[A-Z0-9]+$/i.test(query) && query.length >= 4) {
    // Escape special regex chars
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    
    // Try word boundary match first (most precise)
    const wordBoundaryPattern = new RegExp(`\\b${escaped}\\b`, 'i');
    if (wordBoundaryPattern.test(searchText)) {
      return true;
    }
    
    // Also check for exact match with non-alphanumeric boundaries
    const exactPattern = new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`, 'i');
    if (exactPattern.test(searchText)) {
      return true;
    }
    
    // For alphanumeric codes, don't allow partial matches
    return false;
  }
  
  // For regular text queries, allow substring matches
  // But prefer word boundary matches when possible
  if (query.length >= 4) {
    const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wordBoundaryPattern = new RegExp(`\\b${escaped}\\b`, 'i');
    if (wordBoundaryPattern.test(searchText)) {
      return true;
    }
  }
  
  // Allow substring match for shorter queries or when word boundary doesn't match
  return true;
}







