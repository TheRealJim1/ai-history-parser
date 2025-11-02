// Test Mode utilities for safe testing with limits and staging
import type { PythonPipelineSettings } from "../types";

export function isTestModeEnabled(settings: PythonPipelineSettings): boolean {
  return settings.testMode?.enabled ?? false;
}

export function getOutputFolder(settings: PythonPipelineSettings): string {
  if (isTestModeEnabled(settings)) {
    return settings.testMode!.stagingFolder || "AI-Staging";
  }
  return settings.outputFolder;
}

export function getIngestLimits(settings: PythonPipelineSettings): {
  maxSources: number;
  maxFiles: number;
  maxConversations: number;
  sinceDays?: number;
} {
  if (isTestModeEnabled(settings)) {
    return settings.testMode!.ingestLimits;
  }
  // No limits in production mode
  return {
    maxSources: Infinity,
    maxFiles: Infinity,
    maxConversations: Infinity,
  };
}

export function getAnnotationLimit(settings: PythonPipelineSettings): number {
  if (isTestModeEnabled(settings)) {
    return settings.testMode!.annotationLimit;
  }
  return settings.aiAnnotation.batchSize;
}

export function validateModelForBackend(
  backend: 'ollama' | 'openai',
  model: string,
  url: string
): { valid: boolean; warning?: string } {
  // Check for vision model over /api/chat
  const isVisionModel = model.toLowerCase().includes('vision');
  const isChatRoute = url.includes('/api/chat') || !url.includes('/api/');
  
  if (backend === 'ollama' && isVisionModel && isChatRoute) {
    return {
      valid: false,
      warning: 'Vision models may not work with /api/chat. Use an instruct model instead (e.g., llama3.2:3b-instruct)',
    };
  }
  
  return { valid: true };
}

export function getDbUri(dbPath: string, readOnly: boolean = true): string {
  if (readOnly) {
    // Use immutable read-only mode to avoid locks
    return `file:${dbPath}?mode=ro&immutable=1`;
  }
  return dbPath;
}

