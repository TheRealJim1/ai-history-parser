# AI History Parser - Obsidian Plugin

A powerful Obsidian plugin for parsing and indexing AI conversation exports from various platforms (ChatGPT, Claude, etc.).

## Features

- **Multi-Source Support**: Parse conversations from multiple AI platforms
- **Advanced Search**: Full-text search with faceted filtering (vendor, role, date)
- **Graph Generation**: Create knowledge graphs from conversations
- **SQLite Integration**: Export data to SQLite database
- **Progress Tracking**: Real-time progress bars and status updates
- **Pop-out Window**: Dedicated window for better workflow

## Current Status

**FIXED**: The main parsing issue has been resolved. The `TFile` import error that was causing "ReferenceError: TFile is not defined" has been fixed.

## Installation

1. Copy the plugin files to your Obsidian vault's `.obsidian/plugins/ai-history-parser/` directory
2. Enable the plugin in Obsidian's Community Plugins settings
3. Use the "Add Source" button to add your AI conversation export folders

## Usage

1. **Add Sources**: Click "Add Source" to select folders containing AI conversation exports
2. **Load & Index**: Click "Load & Index" to parse and index the conversations
3. **Search**: Use the search bar to find specific conversations or messages
4. **Filter**: Use the facet filters to narrow down results by vendor, role, or date
5. **Export**: Use "Import → SQLite" to export data to a database

## Development

### Building

```bash
npm install
npm run build
```

### Debugging

The plugin includes comprehensive logging. Open the browser console (F12) to see detailed debug information during parsing and indexing.

## File Structure

- `src/main.ts` - Main plugin entry point
- `src/view.tsx` - React UI components
- `src/parser.ts` - Conversation parsing logic
- `src/lib/` - Utility functions (hashing, scoring, etc.)
- `src/types/` - TypeScript type definitions
- `src/components/` - Reusable UI components

## Recent Fixes

- Fixed `TFile` import error that was causing parsing failures
- Added comprehensive logging throughout the system
- Enhanced error handling and debugging capabilities
- Improved progress tracking and status updates

## Issues

If you encounter any issues:

1. Check the browser console for error messages
2. Ensure your AI export files are in the correct format
3. Verify that the source folders contain `conversations.json` or `shared_conversations.json` files
4. Use the debug buttons in the UI to test individual components

## Contributing

This plugin is actively maintained. Please report issues and feature requests through the appropriate channels.