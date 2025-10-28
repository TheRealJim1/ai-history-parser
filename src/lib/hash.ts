// FNV-1a 64-bit -> unsigned BigInt -> base36 slug
export function fnv1a64(input: string): string {
  let hash = 0xcbf29ce484222325n;            // offset basis
  const prime = 0x100000001b3n;               // FNV prime
  
  for (let i = 0; i < input.length; i++) {
    hash ^= BigInt(input.charCodeAt(i));
    hash = (hash * prime) & 0xffffffffffffffffn; // keep to 64-bit
  }
  
  // normalize to positive and encode
  if (hash < 0) hash = (hash & 0xffffffffffffffffn);
  return hash.toString(36); // compact slug
}

// Normalize text so hashes don't churn on whitespace/case
export function normText(s: string): string {
  return (s || "")
    .replace(/\r\n/g, "\n")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// JSON canonicalization for tool payloads / attachments
export function canon(obj: any): string {
  try {
    return JSON.stringify(obj, Object.keys(obj).sort(), 0);
  } catch {
    return String(obj ?? "");
  }
}

// Extract text from various message content formats
export function extractText(m: any): string {
  if (typeof m.content === "string") return m.content;
  
  if (Array.isArray(m.content)) {
    return m.content
      .map((c: any) => (c.text?.value || c.text || c.content || ""))
      .join("\n");
  }
  
  if (m.message?.content) return String(m.message.content);
  if (m.text) return String(m.text);
  
  return "";
}

// Convert various timestamp formats to epoch milliseconds
export function toEpoch(x: any): number | undefined {
  if (!x) return undefined;
  
  if (typeof x === "number") {
    // Handle both seconds and milliseconds
    return x * (x < 1e12 ? 1000 : 1);
  }
  
  const t = Date.parse(String(x));
  return Number.isFinite(t) ? t : undefined;
}

// Create a content fingerprint for conversation threading
export function createFingerprint(messages: any[], maxMessages: number = 5): string {
  const firstMessages = messages
    .slice(0, maxMessages)
    .map(m => normText(extractText(m)))
    .filter(text => text.length > 0);
  
  return fnv1a64(firstMessages.join("|"));
}

// Hash for tool payloads to detect common patterns
export function hashToolPayload(payload: any): string {
  if (!payload) return "";
  
  const canonical = canon(payload);
  return fnv1a64(canonical);
}

// Create a stable hash for attachments/files
export function hashAttachments(attachments: any[]): string {
  if (!attachments || !Array.isArray(attachments)) return "";
  
  const normalized = attachments
    .map(att => {
      if (typeof att === 'string') return att;
      if (att.name) return att.name;
      if (att.filename) return att.filename;
      return canon(att);
    })
    .sort()
    .join("|");
  
  return fnv1a64(normalized);
}

// Lightweight 32-bit FNV-1a for graph node IDs
export function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { 
    h ^= str.charCodeAt(i); 
    h += (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24); 
  }
  return ('00000000' + (h >>> 0).toString(16)).slice(-8);
}

export const slugify = (s: string) => s.toLowerCase()
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120);