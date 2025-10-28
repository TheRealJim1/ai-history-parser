// Very light BM25-ish blend + recency. Fast and good enough.
export type SearchDoc = {
  id: string;
  title?: string;
  system?: string;
  toolJson?: string;  // canonicalized tool payloads
  body?: string;      // concatenated message text
  vendor: string;
  date?: number;      // epoch ms
  conversationId?: string;
  role?: string;
  sourceId?: string;
};

export function score(doc: SearchDoc, qTokens: string[], now = Date.now()): number {
  let s = 0;

  const H = (txt?: string, w = 1) => {
    if (!txt) return;

    const low = txt.toLowerCase();

    for (const t of qTokens) {
      if (!t) continue;

      const hits = (low.match(new RegExp("\\b" + escapeRe(t) + "\\b", "g")) || []).length;
      if (hits) s += hits * w;
    }
  };

  // Weighting: title > system/meta > tool payload > body
  H(doc.title, 3.0);
  H(doc.system, 2.0);
  H(doc.toolJson, 1.25);
  H(doc.body, 1.0);

  // Recency boost (last 180 days → up to +25%)
  if (doc.date) {
    const days = (now - doc.date) / 86400000;
    const boost = Math.max(0, 1 - (days / 180));
    s *= (1 + 0.25 * boost);
  }

  return s;
}

// Regex-based scoring for exact pattern matching
export function regexScore(doc: SearchDoc, pattern: string): number {
  try {
    const re = new RegExp(pattern, "i");
    let s = 0;

    if (re.test(doc.title || "")) s += 3;
    if (re.test(doc.system || "")) s += 2;
    if (re.test(doc.toolJson || "")) s += 1.25;
    if (re.test(doc.body || "")) s += 1;

    return s;
  } catch {
    return 0;
  }
}

// Convert conversation to search document
export function toSearchDoc(conv: any): SearchDoc {
  const messages = conv.messages || [];
  const systemMessages = messages.filter((m: any) => m.role === "system");
  const toolMessages = messages.filter((m: any) => m.role === "tool");
  
  return {
    id: conv.id,
    title: conv.title,
    system: systemMessages.map((m: any) => m.text || "").join("\n"),
    toolJson: toolMessages.map((m: any) => m.toolJson || "").join("\n"),
    body: messages.map((m: any) => m.text || "").join("\n"),
    vendor: conv.vendor,
    date: conv.date,
    conversationId: conv.conversationId,
    sourceId: conv.sourceId
  };
}

// Convert message to search document
export function messageToSearchDoc(msg: any): SearchDoc {
  return {
    id: msg.id,
    title: msg.title,
    system: msg.role === "system" ? msg.text : "",
    toolJson: msg.role === "tool" ? msg.toolJson : "",
    body: msg.text || "",
    vendor: msg.vendor,
    date: msg.createdAt,
    conversationId: msg.conversationId,
    role: msg.role,
    sourceId: msg.sourceId
  };
}

// Ranked search with scoring
export function rankedSearch(
  conversations: any[], 
  query: string, 
  useRegex: boolean,
  options: {
    vendor?: string;
    role?: string;
    from?: number;
    to?: number;
    sourceIds?: string[];
  } = {}
): any[] {
  const tokens = useRegex ? [query] : query.split(/\s+/).map(t => t.toLowerCase()).filter(Boolean);
  const now = Date.now();

  const scored = [];

  for (const conv of conversations) {
    // Apply filters first
    if (options.vendor && options.vendor !== 'all' && conv.vendor !== options.vendor) continue;
    if (options.role && options.role !== 'any' && conv.role !== options.role) continue;
    if (options.from && conv.date && conv.date < options.from) continue;
    if (options.to && conv.date && conv.date > options.to) continue;
    if (options.sourceIds && options.sourceIds.length > 0 && !options.sourceIds.includes(conv.sourceId)) continue;

    const doc = toSearchDoc(conv);
    const s = useRegex ? regexScore(doc, query) : score(doc, tokens, now);

    if (s > 0) scored.push({ conv, score: s });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map(x => x.conv);
}

// Ranked message search
export function rankedMessageSearch(
  messages: any[],
  query: string,
  useRegex: boolean,
  options: {
    vendor?: string;
    role?: string;
    from?: number;
    to?: number;
    sourceIds?: string[];
  } = {}
): any[] {
  const tokens = useRegex ? [query] : query.split(/\s+/).map(t => t.toLowerCase()).filter(Boolean);
  const now = Date.now();

  const scored = [];

  for (const msg of messages) {
    // Apply filters first
    if (options.vendor && options.vendor !== 'all' && msg.vendor !== options.vendor) continue;
    if (options.role && options.role !== 'any' && msg.role !== options.role) continue;
    if (options.from && msg.createdAt && msg.createdAt < options.from) continue;
    if (options.to && msg.createdAt && msg.createdAt > options.to) continue;
    if (options.sourceIds && options.sourceIds.length > 0 && !options.sourceIds.includes(msg.sourceId)) continue;

    const doc = messageToSearchDoc(msg);
    const s = useRegex ? regexScore(doc, query) : score(doc, tokens, now);

    if (s > 0) scored.push({ msg, score: s });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.map(x => x.msg);
}

// Utility function to escape regex special characters
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Get search suggestions based on common terms
export function getSearchSuggestions(
  conversations: any[],
  maxSuggestions: number = 10
): string[] {
  const termCounts: Record<string, number> = {};
  
  for (const conv of conversations) {
    const doc = toSearchDoc(conv);
    const text = `${doc.title || ""} ${doc.body || ""}`.toLowerCase();
    
    // Extract words (simple approach)
    const words = text.match(/\b\w{3,}\b/g) || [];
    
    for (const word of words) {
      if (word.length >= 3) {
        termCounts[word] = (termCounts[word] || 0) + 1;
      }
    }
  }
  
  return Object.entries(termCounts)
    .sort(([, a], [, b]) => b - a)
    .slice(0, maxSuggestions)
    .map(([term]) => term);
}

// Calculate search statistics
export function getSearchStats(
  conversations: any[],
  query: string,
  useRegex: boolean
): {
  totalConversations: number;
  matchingConversations: number;
  averageScore: number;
  topVendors: Record<string, number>;
  dateRange: { min: number; max: number };
} {
  const results = rankedSearch(conversations, query, useRegex);
  const scores = results.map(conv => {
    const doc = toSearchDoc(conv);
    const tokens = useRegex ? [query] : query.split(/\s+/).map(t => t.toLowerCase()).filter(Boolean);
    return useRegex ? regexScore(doc, query) : score(doc, tokens);
  });
  
  const vendorCounts: Record<string, number> = {};
  let minDate = Infinity;
  let maxDate = -Infinity;
  
  for (const conv of results) {
    vendorCounts[conv.vendor] = (vendorCounts[conv.vendor] || 0) + 1;
    if (conv.date) {
      minDate = Math.min(minDate, conv.date);
      maxDate = Math.max(maxDate, conv.date);
    }
  }
  
  return {
    totalConversations: conversations.length,
    matchingConversations: results.length,
    averageScore: scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0,
    topVendors: vendorCounts,
    dateRange: {
      min: minDate === Infinity ? 0 : minDate,
      max: maxDate === -Infinity ? 0 : maxDate
    }
  };
}
