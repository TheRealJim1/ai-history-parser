// Self-check panel - SQL probes to verify database state
import type { App } from "obsidian";
import { resolveVaultPath } from "../settings";

export interface SelfCheckResult {
  dbExists: { status: 'pass' | 'fail'; message: string };
  conversations: { status: 'pass' | 'fail'; count: number; message: string };
  assetsLinked: { status: 'pass' | 'warn' | 'fail'; count: number; message: string };
  annotations: { status: 'pass' | 'warn' | 'skip'; count: number; message: string };
  freshRows: { status: 'pass' | 'warn'; count: number; message: string };
  topProviders: Array<{ name: string; count: number }>;
  topEntities: Array<{ name: string; count: number; category: string }>;
}

// SelfCheckContext is now exported from selfCheckCtl.ts
export type { SelfCheckContext } from "./selfCheckCtl";

// Hoisted function for running self-check after actions
export async function runSelfCheckAfterAction(
  context: SelfCheckContext,
  opts?: { reason?: string }
): Promise<void> {
  const { setIsRunningSelfCheck, setSelfCheckResult, app, pythonExecutable, dbPath } = context;
  
  setIsRunningSelfCheck(true);
  try {
    if (!dbPath) {
      console.warn("Self-check skipped: no DB path");
      return;
    }
    
    const result = await runSelfCheck(app, pythonExecutable, dbPath);
    setSelfCheckResult(result);
    
    if (opts?.reason) {
      console.log(`✅ Self-check complete (${opts.reason})`);
    }
  } catch (error: any) {
    console.warn("Self-check failed:", error);
    // Don't set error state - just log it
  } finally {
    setIsRunningSelfCheck(false);
  }
}

export async function runSelfCheck(
  app: App,
  pythonExecutable: string,
  dbPath: string
): Promise<SelfCheckResult> {
  const vaultBasePath = (app.vault.adapter as any).basePath || '';
  const resolvedPath = resolveVaultPath(dbPath, vaultBasePath);
  
  const fs = require("fs");
  const dbExists = fs.existsSync(resolvedPath);
  
  if (!dbExists) {
    return {
      dbExists: { status: 'fail', message: 'Database not found' },
      conversations: { status: 'fail', count: 0, message: 'N/A' },
      assetsLinked: { status: 'fail', count: 0, message: 'N/A' },
      annotations: { status: 'skip', count: 0, message: 'N/A' },
      freshRows: { status: 'warn', count: 0, message: 'N/A' },
      topProviders: [],
      topEntities: [],
    };
  }
  
  // Run SQL probes
  const queryScript = `import sqlite3, json, sys
from datetime import datetime, timedelta

db_path = r"${resolvedPath.replace(/\\/g, '\\\\')}"
con = sqlite3.connect(db_path)
cur = con.cursor()

results = {}

# 1. Conversations count
try:
    conv_count = cur.execute("SELECT COUNT(*) FROM conversation").fetchone()[0]
    results["conversations"] = {"status": "pass" if conv_count > 0 else "fail", "count": conv_count}
except Exception as e:
    results["conversations"] = {"status": "fail", "count": 0, "error": str(e)}

# 2. Assets linked
try:
    asset_count = cur.execute("SELECT COUNT(*) FROM message_asset").fetchone()[0]
    if asset_count > 0:
        results["assetsLinked"] = {"status": "pass", "count": asset_count}
    else:
        results["assetsLinked"] = {"status": "warn", "count": 0}
except Exception as e:
    results["assetsLinked"] = {"status": "fail", "count": 0, "error": str(e)}

# 3. Annotations
try:
    ann_count = cur.execute("SELECT COUNT(*) FROM conversation_annotation").fetchone()[0]
    if ann_count > 0:
        results["annotations"] = {"status": "pass", "count": ann_count}
    else:
        results["annotations"] = {"status": "warn", "count": 0}
except sqlite3.OperationalError:
    results["annotations"] = {"status": "skip", "count": 0}

# 4. Fresh rows (last 3 days)
try:
    three_days_ago = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d %H:%M:%S")
    fresh_count = cur.execute("""
        SELECT COUNT(*) FROM conversation 
        WHERE created_at >= ? OR updated_at >= ?
    """, (three_days_ago, three_days_ago)).fetchone()[0]
    results["freshRows"] = {"status": "pass" if fresh_count > 0 else "warn", "count": fresh_count}
except Exception as e:
    results["freshRows"] = {"status": "warn", "count": 0, "error": str(e)}

# 5. Top providers
try:
    providers = cur.execute("""
        SELECT provider, COUNT(*) as cnt 
        FROM conversation 
        GROUP BY provider 
        ORDER BY cnt DESC 
        LIMIT 3
    """).fetchall()
    results["topProviders"] = [{"name": p[0] or "unknown", "count": p[1]} for p in providers]
except Exception as e:
    results["topProviders"] = []

# 6. Top entities (parse JSON client-side)
try:
    entity_rows = cur.execute("""
        SELECT entities FROM conversation_annotation 
        WHERE entities IS NOT NULL AND entities != '{}' AND entities != '[]'
        LIMIT 50
    """).fetchall()
    
    entity_counts = {}
    for row in entity_rows:
        try:
            import json
            entities = json.loads(row[0]) if isinstance(row[0], str) else row[0]
            if isinstance(entities, dict):
                for category, names in entities.items():
                    if isinstance(names, list):
                        for name in names:
                            if isinstance(name, str):
                                key = f"{category}:{name}"
                                entity_counts[key] = entity_counts.get(key, 0) + 1
        except:
            pass
    
    top_entities = sorted(entity_counts.items(), key=lambda x: x[1], reverse=True)[:5]
    results["topEntities"] = [
        {"category": k.split(":")[0], "name": k.split(":")[1], "count": v} 
        for k, v in top_entities
    ]
except Exception as e:
    results["topEntities"] = []

print(json.dumps(results))
con.close()
`;

  // Write script to temp file (more reliable on Windows with multiline scripts)
  const path = require("path");
  // Get temp directory - use simple approach that works in Node.js runtime
  const tmpdir = (globalThis as any).require?.("os")?.tmpdir?.() || 
                 (typeof process !== 'undefined' && process.env?.TEMP) ||
                 (typeof process !== 'undefined' && process.env?.TMP) ||
                 '/tmp';
  const scriptPath = path.join(tmpdir, `aihp_selfcheck_${Date.now()}.py`);
  
  try {
    fs.writeFileSync(scriptPath, queryScript, 'utf8');
  } catch (writeError: any) {
    return Promise.resolve({
      dbExists: { status: 'fail', message: 'Script write failed' },
      conversations: { status: 'fail', count: 0, message: 'N/A' },
      assetsLinked: { status: 'fail', count: 0, message: 'N/A' },
      annotations: { status: 'skip', count: 0, message: 'N/A' },
      freshRows: { status: 'warn', count: 0, message: 'N/A' },
      topProviders: [],
      topEntities: [],
    });
  }
  
  const { spawn } = require("child_process");
  const proc = spawn(pythonExecutable, [scriptPath], { shell: false });
  
  let stdout = '';
  let stderr = '';
  
  proc.stdout.on('data', (data: Buffer) => {
    stdout += data.toString();
  });
  
  proc.stderr.on('data', (data: Buffer) => {
    stderr += data.toString();
  });
  
  return new Promise((resolve, reject) => {
    proc.on('close', (code: number) => {
      // Clean up temp file
      try {
        if (fs.existsSync(scriptPath)) {
          fs.unlinkSync(scriptPath);
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      
      if (code === 0) {
        try {
          const data = JSON.parse(stdout);
          resolve({
            dbExists: { status: 'pass', message: 'Database found' },
            conversations: {
              status: data.conversations.status as 'pass' | 'fail',
              count: data.conversations.count || 0,
              message: data.conversations.status === 'pass' 
                ? `${data.conversations.count} conversations`
                : 'No conversations found',
            },
            assetsLinked: {
              status: data.assetsLinked.status as 'pass' | 'warn' | 'fail',
              count: data.assetsLinked.count || 0,
              message: data.assetsLinked.status === 'pass'
                ? `${data.assetsLinked.count} assets linked`
                : data.assetsLinked.status === 'warn'
                ? 'No assets linked (URL-only OK)'
                : 'Asset check failed',
            },
            annotations: {
              status: data.annotations.status as 'pass' | 'warn' | 'skip',
              count: data.annotations.count || 0,
              message: data.annotations.status === 'pass'
                ? `${data.annotations.count} annotated`
                : data.annotations.status === 'warn'
                ? 'No annotations (run annotate)'
                : 'Annotation table missing',
            },
            freshRows: {
              status: data.freshRows.status as 'pass' | 'warn',
              count: data.freshRows.count || 0,
              message: data.freshRows.status === 'pass'
                ? `${data.freshRows.count} recent conversations`
                : 'No recent conversations',
            },
            topProviders: data.topProviders || [],
            topEntities: data.topEntities || [],
          });
        } catch (e: any) {
          reject(new Error(`Failed to parse self-check results: ${e.message}`));
        }
      } else {
        reject(new Error(`Self-check script exited with code ${code}: ${stderr}`));
      }
    });
    
    proc.on('error', (error: any) => {
      // Clean up temp file on error
      try {
        if (fs.existsSync(scriptPath)) {
          fs.unlinkSync(scriptPath);
        }
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      reject(new Error(`Failed to execute self-check: ${error.message}`));
    });
  });
}

