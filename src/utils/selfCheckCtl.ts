// Self-check context controller (prevents TDZ)
export type SelfCheckContext = {
  setIsRunningSelfCheck: (isRunning: boolean) => void;
  setSelfCheckResult: (result: any) => void;
  app: any;
  pythonExecutable: string;
  dbPath: string;
};

// Safe stub that returns null (no-op context)
export let getSelfCheckContext = (): SelfCheckContext | null => null;

// Setter to assign real implementation after init
export const setSelfCheckContextProvider = (fn: () => SelfCheckContext | null) => {
  getSelfCheckContext = fn;
};



