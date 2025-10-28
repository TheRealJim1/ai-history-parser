import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { DatabaseService } from '../services/database';
import type { FlatMessage, Source } from '../types';
import type { App } from 'obsidian';

// Hook for getting messages with automatic caching and background updates
export function useMessages(
  app: App,
  sourceIds: string[],
  options?: {
    enabled?: boolean;
    staleTime?: number;
  }
) {
  const queryClient = useQueryClient();
  const dbService = DatabaseService.getDatabaseService(app, queryClient);

  return useQuery({
    queryKey: DatabaseService.queryKeys.messagesBySource(sourceIds),
    queryFn: () => dbService.getMessages(sourceIds),
    enabled: options?.enabled ?? sourceIds.length > 0,
    staleTime: options?.staleTime ?? 5 * 60 * 1000, // 5 minutes
    cacheTime: 30 * 60 * 1000, // 30 minutes
  });
}

// Hook for database statistics
export function useDatabaseStats(app: App) {
  const queryClient = useQueryClient();
  const dbService = DatabaseService.getDatabaseService(app, queryClient);

  return useQuery({
    queryKey: DatabaseService.queryKeys.stats(),
    queryFn: () => dbService.getStats(),
    staleTime: 60 * 1000, // 1 minute
    refetchInterval: 2 * 60 * 1000, // Refetch every 2 minutes
  });
}

// Hook for searching messages
export function useSearchMessages(
  app: App,
  query: string,
  filters: {
    sourceIds?: string[];
    vendor?: string;
    role?: string;
    dateFrom?: number;
    dateTo?: number;
  },
  options?: {
    enabled?: boolean;
  }
) {
  const queryClient = useQueryClient();
  const dbService = DatabaseService.getDatabaseService(app, queryClient);

  return useQuery({
    queryKey: ['search', query, filters],
    queryFn: () => dbService.searchMessages(query, filters),
    enabled: options?.enabled ?? query.length > 0,
    staleTime: 30 * 1000, // 30 seconds
  });
}

// Mutation for inserting messages (with optimistic updates)
export function useInsertMessages(app: App) {
  const queryClient = useQueryClient();
  const dbService = DatabaseService.getDatabaseService(app, queryClient);

  return useMutation({
    mutationFn: (messages: FlatMessage[]) => dbService.insertMessages(messages),
    onMutate: async (newMessages) => {
      // Cancel outgoing refetches
      await queryClient.cancelQueries({ queryKey: DatabaseService.queryKeys.messages() });

      // Snapshot previous value
      const previousMessages = queryClient.getQueryData(DatabaseService.queryKeys.messages());

      // Optimistically update cache
      queryClient.setQueryData(
        DatabaseService.queryKeys.messages(),
        (old: FlatMessage[] = []) => [...old, ...newMessages]
      );

      return { previousMessages };
    },
    onError: (err, newMessages, context) => {
      // Rollback on error
      if (context?.previousMessages) {
        queryClient.setQueryData(DatabaseService.queryKeys.messages(), context.previousMessages);
      }
    },
    onSettled: () => {
      // Always refetch after error or success
      queryClient.invalidateQueries({ queryKey: DatabaseService.queryKeys.messages() });
      queryClient.invalidateQueries({ queryKey: DatabaseService.queryKeys.stats() });
    },
  });
}

// Mutation for parsing and importing sources
export function useImportSources(app: App) {
  const queryClient = useQueryClient();
  const dbService = DatabaseService.getDatabaseService(app, queryClient);

  return useMutation({
    mutationFn: async (sources: Source[]) => {
      // Parse sources and insert into database
      const { parseMultipleSources } = await import('../parser');
      const result = await parseMultipleSources(app, sources);
      
      if (result.messages.length > 0) {
        await dbService.insertMessages(result.messages);
      }
      
      return result;
    },
    onSuccess: (result) => {
      // Invalidate all related queries
      queryClient.invalidateQueries({ queryKey: DatabaseService.queryKeys.all });
      
      // Show success notification
      console.log(`✅ Imported ${result.messages.length} messages, ${result.errors.length} errors`);
    },
    onError: (error) => {
      console.error('❌ Import failed:', error);
    },
  });
}

// Mutation for clearing database
export function useClearDatabase(app: App) {
  const queryClient = useQueryClient();
  const dbService = DatabaseService.getDatabaseService(app, queryClient);

  return useMutation({
    mutationFn: () => dbService.clearDatabase(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DatabaseService.queryKeys.all });
      console.log('🗑️ Database cleared');
    },
  });
}

// Hook for database initialization
export function useDatabaseInit(app: App) {
  const queryClient = useQueryClient();
  const dbService = DatabaseService.getDatabaseService(app, queryClient);

  return useMutation({
    mutationFn: () => dbService.initialize(),
    onSuccess: () => {
      console.log('🗄️ Database ready');
    },
  });
}
