// Stable ID generation for vendor-proof deduplication
// Uses FNV-1a 64-bit hash for deterministic, collision-resistant IDs

// Tiny FNV-1a 64-ish hash (JS-friendly)
export function fnv64(s: string): string {
  let h1 = 0x811c9dc5 ^ 0;
  let h2 = 0x811c9dc5 ^ 0;
  
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x1000193);
    h2 ^= c << 1;
    h2 = Math.imul(h2, 0x1000193);
  }
  
  return (BigInt(h1 >>> 0) << 32n | BigInt(h2 >>> 0)).toString(16);
}

export function makeStableId(
  vendor: string, 
  convId: string, 
  msgId: string | undefined, 
  t: number, 
  text: string, 
  role: string
): string {
  // Create a stable base string from key message properties
  const base = `${vendor}::${convId || 'NA'}::${msgId || 'NA'}::${t || 0}::${role}::${text.slice(0, 256)}`;
  
  // Generate hash and prefix with vendor for easy identification
  return `${vendor}:${fnv64(base)}`;
}

// Generate a stable conversation ID
export function makeConversationId(vendor: string, convId: string, title: string): string {
  const base = `${vendor}::${convId}::${title}`;
  return `${vendor}:conv:${fnv64(base)}`;
}

// Generate a stable source ID
export function makeSourceId(vendor: string, rootPath: string): string {
  const base = `${vendor}::${rootPath}`;
  return `${vendor}:src:${fnv64(base)}`;
}

// Extract vendor from stable ID
export function getVendorFromId(uid: string): string {
  return uid.split(':')[0];
}

// Check if two messages are likely duplicates
export function isLikelyDuplicate(msg1: any, msg2: any): boolean {
  if (msg1.role !== msg2.role) return false;
  if (Math.abs((msg1.createdAt || 0) - (msg2.createdAt || 0)) > 60000) return false; // 1 minute tolerance
  
  const text1 = msg1.text?.slice(0, 100) || '';
  const text2 = msg2.text?.slice(0, 100) || '';
  
  // Simple similarity check
  const similarity = calculateSimilarity(text1, text2);
  return similarity > 0.8;
}

// Simple text similarity calculation
function calculateSimilarity(str1: string, str2: string): number {
  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;
  
  if (longer.length === 0) return 1.0;
  
  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

// Levenshtein distance calculation
function levenshteinDistance(str1: string, str2: string): number {
  const matrix = [];
  
  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }
  
  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }
  
  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }
  
  return matrix[str2.length][str1.length];
}
