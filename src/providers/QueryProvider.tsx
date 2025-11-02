import React, { createContext, useContext, ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { App } from 'obsidian';

// Create QueryClient with optimized defaults for this app
const createQueryClient = () => new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      cacheTime: 30 * 60 * 1000, // 30 minutes
      retry: (failureCount, error) => {
        // Don't retry on 4xx errors
        if (error instanceof Error && error.message.includes('4')) {
          return false;
        }
        return failureCount < 3;
      },
      retryDelay: (attemptIndex) => Math.min(1000 * 2 ** attemptIndex, 30000),
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
    },
    mutations: {
      retry: 1,
    },
  },
});

// App context for sharing the App instance
const AppContext = createContext<App | null>(null);

export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return app;
}

interface QueryProviderProps {
  children: ReactNode;
  app: App;
  queryClient?: QueryClient;
}

export function QueryProvider({ children, app, queryClient }: QueryProviderProps) {
  const client = queryClient || createQueryClient();

  return (
    <AppContext.Provider value={app}>
      <QueryClientProvider client={client}>
        {children}
      </QueryClientProvider>
    </AppContext.Provider>
  );
}

// Hook to get the QueryClient instance
export function useQueryClient() {
  const { useQueryClient: useQC } = require('@tanstack/react-query');
  return useQC();
}







