#!/usr/bin/env node

import { Command } from 'commander';
import { importCommand } from './commands/import.js';
import { listCommand } from './commands/list.js';
import { searchCommand } from './commands/search.js';
import { buildCommand } from './commands/build.js';

const program = new Command();

program
  .name('mcp-registry')
  .description('CLI for managing a simplified MCP Registry')
  .version('1.0.0');

program
  .command('import <serverName>')
  .description('Import an MCP server from the official registry')
  .option('-r, --registry <url>', 'Source registry URL', 'https://registry.modelcontextprotocol.io')
  .option('-v, --version <version>', 'Specific version to import (default: latest)')
  .option('--all-versions', 'Import all available versions')
  .option('-o, --output <dir>', 'Output directory', './servers')
  .option('-f, --file <path>', 'Target file (enables multi-server format)')
  .action(importCommand);

program
  .command('search <query>')
  .description('Search for MCP servers in the official registry')
  .option('-r, --registry <url>', 'Source registry URL', 'https://registry.modelcontextprotocol.io')
  .option('-l, --limit <n>', 'Maximum results to show', '20')
  .option('-j, --json', 'Output server names only (one per line)')
  .option('-i, --import-all', 'Import all search results')
  .option('-o, --output <dir>', 'Output directory for imports', './servers')
  .action(searchCommand);

program
  .command('list')
  .description('List all servers in the local registry')
  .option('-d, --dir <dir>', 'Servers directory', './servers')
  .action(listCommand);

program
  .command('build')
  .description('Build the static API files')
  .option('-w, --watch', 'Watch for changes')
  .action(buildCommand);

program.parse();
