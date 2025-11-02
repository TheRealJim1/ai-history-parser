const STOP = new Set(['the','and','for','with','from','into','your','that','this','have','been','will','are','was','were','to','of','in','on','by']);

export function extractTopics(text: string, max = 8): string[] {
  const hits = new Map<string, number>();

  // #hashtags
  for (const m of text.matchAll(/#([a-z0-9\-_.]+)/gi)) {
    hits.set(m[1].toLowerCase(), (hits.get(m[1]) || 0) + 3);
  }

  // "quoted phrases"
  for (const m of text.matchAll(/"([^"]{4,80})"/g)) {
    const k = m[1].toLowerCase(); 
    hits.set(k, (hits.get(k) || 0) + 2);
  }

  // Title Case multi-words (quick named-entity-ish)
  for (const m of text.matchAll(/\b([A-Z][a-z]+(?:\s+[A-Z][a-z0-9\-]+){0,3})\b/g)) {
    const k = m[1].trim(); 
    if (k.length > 3) hits.set(k, (hits.get(k) || 0) + 2);
  }

  // frequent meaningful unigrams/bigrams
  const words = text.toLowerCase().match(/[a-z0-9][a-z0-9\-]{2,}/g) || [];
  for (let i = 0; i < words.length; i++) {
    const w = words[i]; 
    if (!STOP.has(w)) hits.set(w, (hits.get(w) || 0) + 1);
    
    if (i + 1 < words.length) {
      const bg = `${words[i]} ${words[i + 1]}`;
      if (!bg.split(' ').some(x => STOP.has(x))) {
        hits.set(bg, (hits.get(bg) || 0) + 1);
      }
    }
  }

  return [...hits.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, max)
    .map(([k]) => k);
}







