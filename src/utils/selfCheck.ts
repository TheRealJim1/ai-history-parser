// Self-check panel - SQL probes to verify database state
import type { App } from "obsidian";
import { resolveVaultPath } from "../settings";

export interface SelfCheckResult {
  dbExists: { status: 'pass' | 'fail'; message: string };
  conversations: { status: 'pass' | 'fail'; count: number; message: string };
  messages: { status: 'pass' | 'fail'; count: number; message: string };
  outlierIds: { status: 'pass' | 'warn' | 'skip'; count: number; message: string };
  assetsLinked: { status: 'pass' | 'warn' | 'fail'; count: number; message: string };
  annotations: { status: 'pass' | 'warn' | 'skip'; count: number; message: string };
  freshRows: { status: 'pass' | 'warn'; count: number; message: string };
  treeStructure: { 
    status: 'pass' | 'warn' | 'skip'; 
    count: number; 
    message: string; 
    schema?: string;
    branchPoints?: number;
    rootNodes?: number;
    maxDepth?: number;
    avgDepth?: number;
    deepestConversation?: string;
    deepestDepth?: number;
    nodesWithMessages?: number;
    nodesWithoutMessages?: number;
  };
  importErrors: { status: 'pass' | 'warn' | 'skip'; count: number; recent: number; message: string };
  fullTextSearch: { status: 'pass' | 'warn' | 'skip'; count: number; enabled: boolean; message: string };
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
      messages: { status: 'fail', count: 0, message: 'N/A' },
      outlierIds: { status: 'skip', count: 0, message: 'N/A' },
      assetsLinked: { status: 'fail', count: 0, message: 'N/A' },
      annotations: { status: 'skip', count: 0, message: 'N/A' },
      freshRows: { status: 'warn', count: 0, message: 'N/A' },
      treeStructure: { status: 'skip', count: 0, message: 'N/A' },
      importErrors: { status: 'skip', count: 0, recent: 0, message: 'N/A' },
      fullTextSearch: { status: 'skip', count: 0, enabled: false, message: 'N/A' },
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

# Check for required v2 schema (conversations, messages tables)
cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='conversations'")
has_conversations = cur.fetchone() is not None

if not has_conversations:
    results["conversations"] = {"status": "fail", "count": 0, "error": "Database uses old v1 schema. Please migrate to v2 schema with 'conversations' and 'messages' tables."}
    results["messages"] = {"status": "fail", "count": 0, "error": "Old schema detected"}
    results["treeStructure"] = {"status": "skip", "count": 0, "schema": "v1 (deprecated)"}
    print(json.dumps(results))
    sys.exit(0)

# Check for tree structure
has_nodes = False
schema = 'v2'
try:
    cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name='conversation_nodes'")
    has_nodes = cur.fetchone() is not None
    if has_nodes:
        schema = 'v2_tree'
except:
    pass

conv_table = 'conversations'
msg_table = 'messages'

# 1. Conversations count
try:
    conv_count = cur.execute("SELECT COUNT(*) FROM conversations").fetchone()[0]
    results["conversations"] = {"status": "pass" if conv_count > 0 else "fail", "count": conv_count}
except Exception as e:
    results["conversations"] = {"status": "fail", "count": 0, "error": str(e)}

# 2. Messages count
try:
    msg_count = cur.execute("SELECT COUNT(*) FROM messages").fetchone()[0]
    results["messages"] = {"status": "pass" if msg_count > 0 else "fail", "count": msg_count}
except Exception as e:
    results["messages"] = {"status": "fail", "count": 0, "error": str(e)}

# 3. Outlier IDs (if table exists)
try:
    outlier_count = cur.execute("SELECT COUNT(*) FROM outlier_ids").fetchone()[0]
    results["outlierIds"] = {"status": "pass" if outlier_count > 0 else "warn", "count": outlier_count}
except sqlite3.OperationalError:
    results["outlierIds"] = {"status": "skip", "count": 0}

# 4. Assets linked (check both old and new attachment tables)
try:
    asset_count = 0
    try:
        asset_count = cur.execute("SELECT COUNT(*) FROM message_asset").fetchone()[0]
    except:
        pass
    try:
        attach_count = cur.execute("SELECT COUNT(*) FROM attachments").fetchone()[0]
        asset_count += attach_count
    except:
        pass
    try:
        attach_ext_count = cur.execute("SELECT COUNT(*) FROM attachments_ext").fetchone()[0]
        asset_count += attach_ext_count
    except:
        pass
    if asset_count > 0:
        results["assetsLinked"] = {"status": "pass", "count": asset_count}
    else:
        results["assetsLinked"] = {"status": "warn", "count": 0}
except Exception as e:
    results["assetsLinked"] = {"status": "fail", "count": 0, "error": str(e)}

# 5. Annotations
try:
    ann_count = cur.execute("SELECT COUNT(*) FROM conversation_annotation").fetchone()[0]
    if ann_count > 0:
        results["annotations"] = {"status": "pass", "count": ann_count}
    else:
        results["annotations"] = {"status": "warn", "count": 0}
except sqlite3.OperationalError:
    results["annotations"] = {"status": "skip", "count": 0}

# 6. Fresh rows (last 3 days)
try:
    three_days_ago = (datetime.now() - timedelta(days=3)).strftime("%Y-%m-%d %H:%M:%S")
    fresh_count = cur.execute("""
        SELECT COUNT(*) FROM conversations 
        WHERE created_at >= ? OR updated_at >= ?
    """, (three_days_ago, three_days_ago)).fetchone()[0]
    results["freshRows"] = {"status": "pass" if fresh_count > 0 else "warn", "count": fresh_count}
except Exception as e:
    results["freshRows"] = {"status": "warn", "count": 0, "error": str(e)}

# 7. Top providers
try:
    providers = cur.execute("""
        SELECT provider, COUNT(*) as cnt 
        FROM conversations 
        GROUP BY provider 
        ORDER BY cnt DESC 
        LIMIT 3
    """).fetchall()
    results["topProviders"] = [{"name": p[0] or "unknown", "count": p[1]} for p in providers]
except Exception as e:
    results["topProviders"] = []

# 8. Tree structure (if available)
try:
    if has_nodes:
        node_count = cur.execute("SELECT COUNT(*) FROM conversation_nodes").fetchone()[0]
        branch_count = cur.execute("SELECT COUNT(*) FROM conversation_nodes WHERE is_branch_point = 1").fetchone()[0]
        root_count = cur.execute("SELECT COUNT(*) FROM conversation_nodes WHERE is_root = 1").fetchone()[0]
        max_depth = cur.execute("SELECT MAX(depth) FROM conversation_nodes").fetchone()[0] or 0
        avg_depth = cur.execute("SELECT AVG(depth) FROM conversation_nodes").fetchone()[0] or 0
        
        # Find conversation with deepest tree
        deepest_conv = cur.execute("""
            SELECT conversation_id, MAX(depth) as max_d
            FROM conversation_nodes
            GROUP BY conversation_id
            ORDER BY max_d DESC
            LIMIT 1
        """).fetchone()
        deepest_conv_id = deepest_conv[0] if deepest_conv else None
        deepest_depth = deepest_conv[1] if deepest_conv else 0
        
        # Count nodes with messages vs without
        nodes_with_messages = cur.execute("SELECT COUNT(*) FROM conversation_nodes WHERE message_id IS NOT NULL").fetchone()[0]
        nodes_without_messages = node_count - nodes_with_messages
        
        results["treeStructure"] = {
            "status": "pass",
            "count": node_count,
            "schema": schema,
            "branchPoints": branch_count,
            "rootNodes": root_count,
            "maxDepth": max_depth,
            "avgDepth": round(avg_depth, 1),
            "deepestConversation": deepest_conv_id,
            "deepestDepth": deepest_depth,
            "nodesWithMessages": nodes_with_messages,
            "nodesWithoutMessages": nodes_without_messages
        }
    else:
        results["treeStructure"] = {"status": "skip", "count": 0, "schema": schema}
except Exception as e:
    results["treeStructure"] = {"status": "warn", "count": 0, "schema": schema, "error": str(e)}

# 9. Import errors (if table exists)
try:
    error_count = cur.execute("SELECT COUNT(*) FROM import_errors").fetchone()[0]
    if error_count > 0:
        recent_errors = cur.execute("""
            SELECT COUNT(*) FROM import_errors 
            WHERE timestamp >= datetime('now', '-7 days')
        """).fetchone()[0]
        results["importErrors"] = {
            "status": "warn" if recent_errors > 0 else "pass",
            "count": error_count,
            "recent": recent_errors
        }
    else:
        results["importErrors"] = {"status": "pass", "count": 0, "recent": 0}
except sqlite3.OperationalError:
    results["importErrors"] = {"status": "skip", "count": 0, "recent": 0}

# 10. FTS5 full-text search (if available)
try:
    fts_count = cur.execute("SELECT COUNT(*) FROM messages_fts").fetchone()[0]
    results["fullTextSearch"] = {
        "status": "pass" if fts_count > 0 else "warn",
        "count": fts_count,
        "enabled": True
    }
except sqlite3.OperationalError:
    results["fullTextSearch"] = {"status": "skip", "count": 0, "enabled": False}

# 11. Top entities (parse JSON client-side)
try:
    entity_rows = cur.execute("""
        SELECT entities FROM conversation_annotation 
        WHERE entities IS NOT NULL AND entities != '{{}}' AND entities != '[]'
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
      messages: { status: 'fail', count: 0, message: 'N/A' },
      outlierIds: { status: 'skip', count: 0, message: 'N/A' },
      assetsLinked: { status: 'fail', count: 0, message: 'N/A' },
      annotations: { status: 'skip', count: 0, message: 'N/A' },
      freshRows: { status: 'warn', count: 0, message: 'N/A' },
      treeStructure: { status: 'skip', count: 0, message: 'N/A' },
      importErrors: { status: 'skip', count: 0, recent: 0, message: 'N/A' },
      fullTextSearch: { status: 'skip', count: 0, enabled: false, message: 'N/A' },
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
            messages: {
              status: data.messages?.status as 'pass' | 'fail' || 'pass',
              count: data.messages?.count || 0,
              message: data.messages?.count 
                ? `${data.messages.count} messages`
                : 'No messages found',
            },
            outlierIds: {
              status: data.outlierIds?.status as 'pass' | 'warn' | 'skip' || 'skip',
              count: data.outlierIds?.count || 0,
              message: data.outlierIds?.status === 'pass'
                ? `${data.outlierIds.count} outlier IDs`
                : data.outlierIds?.status === 'warn'
                ? 'No outlier IDs found'
                : 'Outlier IDs table missing',
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
            treeStructure: {
              status: data.treeStructure?.status as 'pass' | 'warn' | 'skip' || 'skip',
              count: data.treeStructure?.count || 0,
              schema: data.treeStructure?.schema || 'v2',
              branchPoints: data.treeStructure?.branchPoints,
              rootNodes: data.treeStructure?.rootNodes,
              maxDepth: data.treeStructure?.maxDepth,
              avgDepth: data.treeStructure?.avgDepth,
              deepestConversation: data.treeStructure?.deepestConversation,
              deepestDepth: data.treeStructure?.deepestDepth,
              nodesWithMessages: data.treeStructure?.nodesWithMessages,
              nodesWithoutMessages: data.treeStructure?.nodesWithoutMessages,
              message: data.treeStructure?.status === 'pass'
                ? `${data.treeStructure.count} nodes (${data.treeStructure.schema}, ${data.treeStructure.branchPoints} branches, max depth: ${data.treeStructure.maxDepth})`
                : data.treeStructure?.status === 'warn'
                ? 'Tree check failed'
                : 'No tree structure (flat schema)',
            },
            importErrors: {
              status: data.importErrors?.status as 'pass' | 'warn' | 'skip' || 'skip',
              count: data.importErrors?.count || 0,
              recent: data.importErrors?.recent || 0,
              message: data.importErrors?.status === 'pass'
                ? `${data.importErrors.count} total (${data.importErrors.recent} recent)`
                : data.importErrors?.status === 'warn'
                ? `${data.importErrors.count} errors (${data.importErrors.recent} recent)`
                : 'No import errors table',
            },
            fullTextSearch: {
              status: data.fullTextSearch?.status as 'pass' | 'warn' | 'skip' || 'skip',
              count: data.fullTextSearch?.count || 0,
              enabled: data.fullTextSearch?.enabled || false,
              message: data.fullTextSearch?.status === 'pass'
                ? `Enabled (${data.fullTextSearch.count} indexed)`
                : data.fullTextSearch?.status === 'warn'
                ? 'FTS5 table empty'
                : 'FTS5 not available',
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

