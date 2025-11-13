// Background AI Tagging Service
// Runs AI enrichment in the background without blocking UI

import { Notice } from 'obsidian';

export interface BackgroundAITask {
  id: string;
  type: 'collection_enrich' | 'message_tag' | 'search_analyze';
  targetId: string;
  content: string;
  priority: 'low' | 'normal' | 'high';
  status: 'pending' | 'processing' | 'completed' | 'failed';
  createdAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: string;
  result?: any;
}

class BackgroundAIService {
  private queue: BackgroundAITask[] = [];
  private processing: boolean = false;
  private maxConcurrent: number = 1;
  private onComplete?: (task: BackgroundAITask) => void;
  private onError?: (task: BackgroundAITask, error: Error) => void;

  constructor() {
    // Load queue from localStorage on init
    this.loadQueue();
  }

  // Load queue from localStorage
  private loadQueue(): void {
    try {
      const stored = localStorage.getItem('aihp-background-ai-queue');
      if (stored) {
        this.queue = JSON.parse(stored);
      }
    } catch (e) {
      console.error('Failed to load background AI queue:', e);
      this.queue = [];
    }
  }

  // Save queue to localStorage
  private saveQueue(): void {
    try {
      localStorage.setItem('aihp-background-ai-queue', JSON.stringify(this.queue));
    } catch (e) {
      console.error('Failed to save background AI queue:', e);
    }
  }

  // Add task to queue
  addTask(task: Omit<BackgroundAITask, 'id' | 'status' | 'createdAt'>): string {
    const id = `task_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const newTask: BackgroundAITask = {
      ...task,
      id,
      status: 'pending',
      createdAt: Date.now(),
    };

    this.queue.push(newTask);
    this.saveQueue();
    this.processQueue();
    return id;
  }

  // Process queue
  private async processQueue(): Promise<void> {
    if (this.processing) return;

    const pendingTasks = this.queue.filter(t => t.status === 'pending');
    if (pendingTasks.length === 0) return;

    this.processing = true;

    // Sort by priority
    pendingTasks.sort((a, b) => {
      const priorityOrder = { high: 3, normal: 2, low: 1 };
      return priorityOrder[b.priority] - priorityOrder[a.priority];
    });

    // Process tasks
    for (const task of pendingTasks.slice(0, this.maxConcurrent)) {
      await this.processTask(task);
    }

    this.processing = false;

    // Continue processing if more tasks
    if (this.queue.some(t => t.status === 'pending')) {
      setTimeout(() => this.processQueue(), 1000);
    }
  }

  // Process individual task
  private async processTask(task: BackgroundAITask): Promise<void> {
    task.status = 'processing';
    task.startedAt = Date.now();
    this.saveQueue();

    try {
      // Call appropriate AI function based on task type
      let result: any;

      if (task.type === 'collection_enrich') {
        result = await this.enrichCollection(task.targetId, task.content);
      } else if (task.type === 'message_tag') {
        result = await this.tagMessage(task.targetId, task.content);
      } else if (task.type === 'search_analyze') {
        result = await this.analyzeSearch(task.targetId, task.content);
      }

      task.status = 'completed';
      task.completedAt = Date.now();
      task.result = result;
      this.saveQueue();

      if (this.onComplete) {
        this.onComplete(task);
      }
    } catch (error: any) {
      task.status = 'failed';
      task.completedAt = Date.now();
      task.error = error.message;
      this.saveQueue();

      if (this.onError) {
        this.onError(task, error);
      }
    }
  }

  // Enrich collection (calls Python script)
  private async enrichCollection(collectionId: string, content: string): Promise<any> {
    // This would call the collection_ai_enrich.py script
    // Implementation depends on your script runner
    return { tags: [], summary: '', toc: [] };
  }

  // Tag message
  private async tagMessage(messageId: string, content: string): Promise<any> {
    // Tag individual messages
    return { tags: [] };
  }

  // Analyze search
  private async analyzeSearch(searchId: string, query: string): Promise<any> {
    // Analyze search patterns
    return { insights: [] };
  }

  // Set callbacks
  onTaskComplete(callback: (task: BackgroundAITask) => void): void {
    this.onComplete = callback;
  }

  onTaskError(callback: (task: BackgroundAITask, error: Error) => void): void {
    this.onError = callback;
  }

  // Get queue status
  getStatus(): { pending: number; processing: number; completed: number; failed: number } {
    return {
      pending: this.queue.filter(t => t.status === 'pending').length,
      processing: this.queue.filter(t => t.status === 'processing').length,
      completed: this.queue.filter(t => t.status === 'completed').length,
      failed: this.queue.filter(t => t.status === 'failed').length,
    };
  }

  // Clear completed tasks
  clearCompleted(): void {
    this.queue = this.queue.filter(t => t.status !== 'completed');
    this.saveQueue();
  }
}

// Singleton instance
let backgroundAIService: BackgroundAIService | null = null;

export function getBackgroundAIService(): BackgroundAIService {
  if (!backgroundAIService) {
    backgroundAIService = new BackgroundAIService();
  }
  return backgroundAIService;
}

