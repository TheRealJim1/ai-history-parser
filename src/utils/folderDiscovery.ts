// Folder discovery utilities for parent folder handling
import type { App, TAbstractFile } from "obsidian";
import { TFolder, TFile } from "obsidian";

export interface DiscoveredSubfolder {
  path: string;
  name: string;
  hasContent: boolean;
  fileCount: number;
}

/**
 * Discover immediate subfolders only (depth=1) under a parent path
 * Use this to count only direct children, not nested subfolders
 */
export async function discoverSubfolders(
  app: App,
  parentPath: string,
  maxDepth: number = 1
): Promise<DiscoveredSubfolder[]> {
  const subfolders: DiscoveredSubfolder[] = [];
  
  try {
    // Normalize path - remove leading/trailing slashes, but preserve structure
    let normalizedPath = parentPath.trim().replace(/^\/+|\/+$/g, '');
    
    // Check if this is an external (filesystem) path vs vault path
    // External paths: Windows drive (C:\), UNC (\\) or absolute Windows path (drive letter in position 1)
    const isExternalPath = normalizedPath.includes(':') || 
                          normalizedPath.startsWith('\\\\') ||
                          (normalizedPath.length > 1 && normalizedPath[1] === ':');
    
    if (isExternalPath) {
      // External folder - use Node.js fs to discover subfolders
      console.log(`[discoverSubfolders] External folder detected: "${normalizedPath}"`);
      return await discoverExternalSubfolders(normalizedPath, maxDepth);
    }
    
    // Vault folder - use Obsidian API
    console.log(`[discoverSubfolders] Vault folder detected: "${normalizedPath}"`);
    
    // If path is empty, use root
    if (!normalizedPath) {
      normalizedPath = '';
    }
    
    // Try to find the folder by path
    // Empty path means root
    let parentFolder: TAbstractFile | null = null;
    
    if (!normalizedPath || normalizedPath === '') {
      parentFolder = app.vault.getRoot();
      console.log(`[discoverSubfolders] Using vault root`);
    } else {
      parentFolder = app.vault.getAbstractFileByPath(normalizedPath);
      if (!parentFolder || !(parentFolder instanceof TFolder)) {
        console.log(`[discoverSubfolders] Path not found directly: "${normalizedPath}", trying to find by walking...`);
        
        // Try to find folder by walking from root
        const parts = normalizedPath.split(/[/\\]/).filter(p => p);
        if (parts.length > 0) {
          let current: TAbstractFile | null = app.vault.getRoot();
          for (const part of parts) {
            if (current instanceof TFolder) {
              const found = current.children.find(child => 
                child instanceof TFolder && child.name === part
              );
              if (found instanceof TFolder) {
                current = found;
                console.log(`[discoverSubfolders] Found part "${part}" at "${current.path}"`);
              } else {
                console.log(`[discoverSubfolders] Part "${part}" not found in "${current.path}"`);
                console.log(`[discoverSubfolders] Available children:`, current.children.slice(0, 5).map(c => c.name));
                current = null;
                break;
              }
            } else {
              current = null;
              break;
            }
          }
          if (current instanceof TFolder) {
            parentFolder = current;
            console.log(`[discoverSubfolders] Found folder by walking: "${parentFolder.path}"`);
          }
        }
      } else {
        console.log(`[discoverSubfolders] Found folder directly: "${parentFolder.path}"`);
      }
    }
    
    if (!parentFolder || !(parentFolder instanceof TFolder)) {
      console.warn(`[discoverSubfolders] Could not find folder in vault: "${normalizedPath}"`);
      console.warn(`[discoverSubfolders] Available vault folders at root:`);
      const root = app.vault.getRoot();
      if (root instanceof TFolder) {
        root.children.slice(0, 10).forEach(child => {
          if (child instanceof TFolder) {
            console.warn(`  - ${child.path}`);
          }
        });
      }
      // Fallback: try external filesystem
      return await discoverExternalSubfolders(normalizedPath, maxDepth);
    }
    
    console.log(`[discoverSubfolders] Walking folder tree from: "${parentFolder.path}"`);
    
    // Recursively walk folder tree
    await walkFolder(app, parentFolder, parentFolder.path, 0, maxDepth, subfolders);
    
    // Sort by name
    subfolders.sort((a, b) => a.name.localeCompare(b.name));
    
    console.log(`[discoverSubfolders] Found ${subfolders.length} subfolders`);
    
    return subfolders;
  } catch (error) {
    console.warn("Failed to discover subfolders:", error);
    return [];
  }
}

/**
 * Discover subfolders in an external (filesystem) folder
 */
async function discoverExternalSubfolders(
  parentPath: string,
  maxDepth: number = 3
): Promise<DiscoveredSubfolder[]> {
  const subfolders: DiscoveredSubfolder[] = [];
  const fs = require("fs");
  const path = require("path");
  
  try {
    if (!fs.existsSync(parentPath)) {
      console.warn(`[discoverExternalSubfolders] Folder does not exist: "${parentPath}"`);
      return [];
    }
    
    const stats = fs.statSync(parentPath);
    if (!stats.isDirectory()) {
      console.warn(`[discoverExternalSubfolders] Path is not a directory: "${parentPath}"`);
      return [];
    }
    
    await walkExternalFolder(fs, path, parentPath, parentPath, 0, maxDepth, subfolders);
    
    subfolders.sort((a, b) => a.name.localeCompare(b.name));
    console.log(`[discoverExternalSubfolders] Found ${subfolders.length} subfolders in "${parentPath}"`);
    
    return subfolders;
  } catch (error) {
    console.error(`[discoverExternalSubfolders] Error walking "${parentPath}":`, error);
    return [];
  }
}

/**
 * Recursively walk external filesystem folder tree
 */
async function walkExternalFolder(
  fs: any,
  pathModule: any,
  folderPath: string,
  basePath: string,
  depth: number,
  maxDepth: number,
  results: DiscoveredSubfolder[]
): Promise<void> {
  if (depth > maxDepth) {
    return;
  }
  
  const backupExts = ['.zip', '.json', '.html'];
  let fileCount = 0;
  let hasBackupFiles = false;
  let hasSubfolders = false;
  
  try {
    const entries = fs.readdirSync(folderPath);
    
    for (const entry of entries) {
      const fullPath = pathModule.join(folderPath, entry);
      try {
        const stats = fs.statSync(fullPath);
        
        if (stats.isFile()) {
          fileCount++;
          const ext = pathModule.extname(entry).toLowerCase();
          if (backupExts.includes(ext)) {
            hasBackupFiles = true;
          }
        } else if (stats.isDirectory() && depth < maxDepth) {
          hasSubfolders = true;
          // Recursively check subfolders first
          await walkExternalFolder(fs, pathModule, fullPath, basePath, depth + 1, maxDepth, results);
        }
      } catch (err) {
        // Skip entries we can't access
        continue;
      }
    }
    
    // Add this folder if it's not the root parent folder
    const relativePath = folderPath.replace(basePath, '').replace(/^[/\\]+/, '');
    if (relativePath && (hasBackupFiles || fileCount > 0 || hasSubfolders)) {
      // Check if we already added a parent folder that contains this one
      const isSubfolderOfExisting = results.some(r => {
        const rPath = r.path.replace(/[/\\]+$/, '');
        const fPath = folderPath.replace(/[/\\]+$/, '');
        return fPath.startsWith(rPath + '\\') || fPath.startsWith(rPath + '/');
      });
      
      if (!isSubfolderOfExisting) {
        results.push({
          path: folderPath,
          name: pathModule.basename(folderPath),
          hasContent: hasBackupFiles || fileCount > 0,
          fileCount,
        });
      }
    }
  } catch (error) {
    console.warn(`[walkExternalFolder] Error reading "${folderPath}":`, error);
  }
}

/**
 * Recursively walk folder tree to find all subfolders (not just those with backup files)
 */
async function walkFolder(
  app: App,
  folder: TFolder,
  basePath: string,
  depth: number,
  maxDepth: number,
  results: DiscoveredSubfolder[]
): Promise<void> {
  if (depth > maxDepth) {
    return;
  }
  
  // Check if this folder has backup files or any files
  const backupExts = ['.zip', '.json', '.html'];
  let fileCount = 0;
  let hasBackupFiles = false;
  let hasSubfolders = false;
  
  for (const child of folder.children) {
    if (child instanceof TFile) {
      fileCount++;
      if (backupExts.some(ext => child.name.toLowerCase().endsWith(ext))) {
        hasBackupFiles = true;
      }
    } else if (child instanceof TFolder && depth < maxDepth) {
      hasSubfolders = true;
      // Recursively check subfolders first
      await walkFolder(app, child, basePath, depth + 1, maxDepth, results);
    }
  }
  
  // Only add immediate children (depth=1) - don't count nested subfolders
  // Only add if it's not the root parent folder
  const relativePath = folder.path.replace(basePath, '').replace(/^[/\\]+/, '');
  
  // For immediate children only (depth=1), add if they have any content
  if (depth === 1 && relativePath) {
    console.log(`[walkFolder] Evaluating immediate child: "${folder.path}" (relative: "${relativePath}")`);
    console.log(`[walkFolder]  - hasBackupFiles: ${hasBackupFiles}, fileCount: ${fileCount}, hasSubfolders: ${hasSubfolders}`);
    console.log(`[walkFolder]  - children count: ${folder.children.length}`);
    
    // Add immediate subfolder if it has any content (files, backup files, or subfolders)
    if (hasBackupFiles || fileCount > 0 || hasSubfolders) {
      console.log(`[walkFolder] Adding immediate subfolder: "${folder.path}" (name: "${folder.name}")`);
      results.push({
        path: folder.path,
        name: folder.name,
        hasContent: hasBackupFiles || fileCount > 0,
        fileCount,
      });
    } else {
      console.log(`[walkFolder] Skipping "${folder.path}" (no content)`);
    }
  }
  // For deeper levels, we still recurse but don't add them to results (only count depth=1)
}

/**
 * Get a human-readable label for a source path
 */
export function getSourceLabel(path: string): string {
  // If it's a vault-relative path, show the last component
  const parts = path.split(/[/\\]/).filter(p => p);
  return parts[parts.length - 1] || path;
}

/**
 * Format source paths for display
 */
export function formatSourcePath(path: string): string {
  // If it's a long path, show parent/child format
  const parts = path.split(/[/\\]/).filter(p => p);
  if (parts.length > 2) {
    return `${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
  }
  return path;
}

