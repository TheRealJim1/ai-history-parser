/**
 * Export search results to a clean file for AI analysis
 */

import { TFile, TFolder } from "obsidian";
import { executePythonScript } from "./scriptRunner";
import * as Path from "path";

export interface ExportOptions {
  format?: "markdown" | "json";
  includeContext?: boolean;
  outputFolder?: string;
}

export async function exportSearchResults(
  app: any,
  dbPath: string,
  searchTerm: string,
  options: ExportOptions = {}
): Promise<string> {
  const {
    format = "markdown",
    includeContext = true,
    outputFolder = "AI Exports"
  } = options;

  // Get vault path
  const vault = app.vault;
  const vaultPath = vault.adapter.basePath;

  // Create output folder if it doesn't exist
  let outputDir: TFolder;
  try {
    outputDir = vault.getAbstractFileByPath(outputFolder) as TFolder;
    if (!outputDir) {
      outputDir = await vault.createFolder(outputFolder);
    }
  } catch {
    outputDir = await vault.createFolder(outputFolder);
  }

  // Generate output file name
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const safeTerm = searchTerm
    .replace(/[^a-zA-Z0-9\s-_]/g, "")
    .trim()
    .slice(0, 30)
    .replace(/\s+/g, "_");
  const extension = format === "json" ? "json" : "md";
  const fileName = `search_export_${safeTerm}_${timestamp}.${extension}`;
  const outputPath = `${outputFolder}/${fileName}`;

  // Build Python command - executePythonScript expects [executable, ...args]
  const scriptPath = Path.join(vaultPath, "export_search_results.py");
  const fullOutputPath = Path.join(vaultPath, outputPath);
  
  const cmd = [
    "python",
    scriptPath,
    dbPath,
    searchTerm,
    fullOutputPath,
    format,
    includeContext ? "true" : "false"
  ];

  // Execute export script
  return new Promise<string>((resolve, reject) => {
    executePythonScript(cmd, "Exporting search results...", (progress) => {
      // Progress callback - can be used for UI updates
      if (progress.status === 'error') {
        reject(new Error(progress.message));
      }
    })
    .then(() => {
      // Script completed successfully
      resolve(outputPath);
    })
    .catch((error: any) => {
      reject(new Error(`Export failed: ${error.message}`));
    });
  });
}

