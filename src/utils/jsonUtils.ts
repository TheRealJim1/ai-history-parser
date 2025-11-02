// Safe JSON parsing utilities for handling annotation data from SQLite
export function safeJson<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== 'string') return fallback;
  if (!raw || raw.trim() === '') return fallback;
  try {
    const parsed = JSON.parse(raw);
    return parsed as T;
  } catch {
    return fallback;
  }
}

export interface AnnotationEntities {
  people?: string[];
  orgs?: string[];
  products?: string[];
  medical_terms?: string[];
  legal_terms?: string[];
}

export interface ConversationAnnotation {
  id: string;
  title: string;
  provider: string;
  ts: string;
  summary: string;
  tags: string[];
  topics: string[];
  entities: AnnotationEntities;
  risk_flags: string[];
  sentiment: string;
  hasAnnotation: boolean;
  annotationValid: boolean;
}

export function mapAnnotationRow(r: any): ConversationAnnotation {
  const tags = safeJson<string[]>(r.tags_json, []);
  const topics = safeJson<string[]>(r.topics_json, []);
  const entities = safeJson<AnnotationEntities>(r.entities_json, {});
  const risk_flags = safeJson<string[]>(r.risk_json, []);
  
  const hasAnnotation = !!r.summary || tags.length > 0 || topics.length > 0 || Object.keys(entities).length > 0 || risk_flags.length > 0;
  const annotationValid = hasAnnotation && (r.summary || tags.length > 0 || topics.length > 0);
  
  return {
    id: r.id || '',
    title: r.title || 'Untitled',
    provider: r.provider || 'unknown',
    ts: r.ts || '',
    summary: r.summary || '',
    tags,
    topics,
    entities,
    risk_flags,
    sentiment: r.sentiment || 'neutral',
    hasAnnotation,
    annotationValid,
  };
}

export function hasAnyAnnotations(ann: ConversationAnnotation): boolean {
  return ann.tags.length > 0 || 
         ann.topics.length > 0 || 
         Object.keys(ann.entities).length > 0 || 
         ann.risk_flags.length > 0 ||
         ann.summary.length > 0;
}

