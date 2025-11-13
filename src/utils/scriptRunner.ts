// Python script execution utility
import { Notice } from "obsidian";
import { spawn, ChildProcess } from "child_process";
import * as path from "path";

export interface ScriptProgress {
  status: 'running' | 'completed' | 'error';
  message: string;
  progress?: number;
  total?: number;
}

export type ProgressCallback = (progress: ScriptProgress) => void;

export async function executePythonScript(
  cmd: string[],
  description: string,
  onProgress?: ProgressCallback
): Promise<void> {
  return new Promise((resolve, reject) => {
    const [executable, ...args] = cmd;
    
    onProgress?.({ status: 'running', message: description });
    
    let proc: ChildProcess;
    try {
      // In Obsidian, process.cwd() might not be available - use a safe default
      let cwd: string | undefined;
      try {
        // Check if process and process.cwd exist and are callable
        if (typeof process !== 'undefined' && process && typeof process.cwd === 'function') {
          cwd = process.cwd();
        }
      } catch {
        // If process.cwd() throws, use undefined (spawn will use default)
        cwd = undefined;
      }
      
      // When using args array, shell:false is safer (avoids quoting issues)
      // Only use shell:true if we have a single command string
      proc = spawn(executable, args, {
        shell: false,  // Args array doesn't need shell
        cwd: cwd,
      });
    } catch (error: any) {
      onProgress?.({ status: 'error', message: error.message });
      reject(new Error(`Failed to start process: ${error.message}`));
      return;
    }
    
    let stdout = '';
    let stderr = '';
    
    proc.stdout?.on('data', (data) => {
      const text = data.toString();
      stdout += text;
      console.log(`[Python stdout] ${text.trim()}`);
      
      // Parse progress if available (e.g., "INGEST OK: +conv=10 +msg=50")
      const progressMatch = stdout.match(/(\d+)\/(\d+)/);
      if (progressMatch) {
        const current = parseInt(progressMatch[1]);
        const total = parseInt(progressMatch[2]);
        onProgress?.({
          status: 'running',
          message: description,
          progress: current,
          total: total,
        });
      }
    });
    
    proc.stderr?.on('data', (data) => {
      const text = data.toString();
      stderr += text;
      console.error(`[Python stderr] ${text.trim()}`);
    });
    
    proc.on('close', (code) => {
      console.log(`[Python] Process exited with code ${code}`);
      if (stdout) {
        console.log(`[Python] Final stdout:\n${stdout}`);
      }
      if (stderr) {
        console.log(`[Python] Final stderr:\n${stderr}`);
      }
      
      if (code === 0) {
        onProgress?.({ status: 'completed', message: description + ' - Complete' });
        new Notice(description + " - Complete");
        resolve();
      } else {
        // Include both stdout and stderr in error for debugging
        const errorMsg = stderr || stdout || `Process exited with code ${code}`;
        onProgress?.({ status: 'error', message: errorMsg });
        new Notice(`Error: ${errorMsg.slice(0, 200)}`, 5000);
        console.error(`[Python] Error: ${errorMsg}`);
        reject(new Error(errorMsg));
      }
    });
    
    proc.on('error', (error) => {
      onProgress?.({ status: 'error', message: error.message });
      new Notice(`Error: ${error.message}`, 5000);
      reject(error);
    });
  });
}

export interface PythonRunResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

export async function runPythonScript(
  cmd: string[],
  options: { cwd?: string } = {}
): Promise<PythonRunResult> {
  return new Promise((resolve, reject) => {
    const [executable, ...args] = cmd;

    let cwd = options.cwd;
    if (!cwd) {
      try {
        if (typeof process !== 'undefined' && process && typeof process.cwd === 'function') {
          cwd = process.cwd();
        }
      } catch {
        cwd = undefined;
      }
    }

    const proc = spawn(executable, args, { shell: false, cwd });
    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });
    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      reject(error);
    });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, code });
    });
  });
}

export async function runPythonJson<T>(cmd: string[]): Promise<T> {
  const result = await runPythonScript(cmd);
  if (result.code !== 0) {
    throw new Error(result.stderr || result.stdout || `Process exited with code ${result.code}`);
  }
  const text = result.stdout.trim();
  if (!text) {
    throw new Error('No JSON output received');
  }
  try {
    return JSON.parse(text) as T;
  } catch (error) {
    console.error('Failed to parse JSON output:', text);
    throw error;
  }
}

export function buildSyncCommand(
  pythonExecutable: string,
  scriptsRoot: string,
  sourceFolders: string[],
  dbPath: string,
  mediaDir: string,
  testMode?: {
    maxFiles?: number;
    maxConversations?: number;
    sinceDays?: number;
  }
): string[] {
  const scriptPath = path.join(scriptsRoot, "ai_history_to_sqlite_images.py");
  
  // Python script supports multiple --root arguments
  // Process all source folders to ensure nothing is missed
  console.log(`[buildSyncCommand] Script: ${scriptPath}`);
  console.log(`[buildSyncCommand] Source folders: ${sourceFolders.length}`);
  sourceFolders.forEach((f, i) => console.log(`[buildSyncCommand]   ${i+1}. ${f}`));
  console.log(`[buildSyncCommand] DB: ${dbPath}`);
  console.log(`[buildSyncCommand] Media: ${mediaDir}`);
  
  const cmd = [
    pythonExecutable,
    scriptPath,
    "--db", dbPath,
    "--media-dir", mediaDir,
  ];
  
  // Add all source folders as --root arguments
  for (const folder of sourceFolders) {
    cmd.push("--root", folder);
  }
  
  // Add test mode limits if provided
  if (testMode) {
    if (testMode.maxFiles) {
      cmd.push("--max-files", testMode.maxFiles.toString());
    }
    if (testMode.maxConversations) {
      cmd.push("--max-conversations", testMode.maxConversations.toString());
    }
    if (testMode.sinceDays) {
      cmd.push("--since-days", testMode.sinceDays.toString());
    }
  }
  
  console.log(`[buildSyncCommand] Final command: ${cmd.join(' ')}`);
  
  return cmd;
}

export function buildAnnotateCommand(
  pythonExecutable: string,
  scriptsRoot: string,
  dbPath: string,
  backend: 'ollama' | 'openai',
  url: string,
  model: string,
  batchSize: number,
  maxChars: number,
  testLimit?: number
): string[] {
  const scriptPath = path.join(scriptsRoot, "ai_auto_tag.py");
  const limit = testLimit !== undefined ? testLimit : batchSize;
  return [
    pythonExecutable,
    scriptPath,
    "--backend", backend,
    "--url", url,
    "--model", model,
    "--db", dbPath,
    "--limit", limit.toString(),
    "--max_chars", maxChars.toString(),
  ];
}

export function buildExportCommand(
  pythonExecutable: string,
  scriptsRoot: string,
  dbPath: string,
  outputFolder: string,
  mediaSourceFolder: string,
  chunkSize: number,
  overlap: number,
  testMode?: boolean
): string[] {
  const scriptPath = path.join(scriptsRoot, "db_to_md_sync_images_annotated.py");
  const cmd = [
    pythonExecutable,
    scriptPath,
    "--db", dbPath,
    "--output", outputFolder,
    "--source-media", mediaSourceFolder,
    "--chunk-size", chunkSize.toString(),
    "--overlap", overlap.toString(),
  ];
  
  if (testMode) {
    cmd.push("--test-mode"); // Flag for test mode (if script supports it)
  }
  
  return cmd;
}

