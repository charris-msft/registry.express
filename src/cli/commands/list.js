import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { existsSync } from 'fs';

/**
 * Recursively find all JSON files
 */
async function findJsonFiles(dir, files = []) {
  if (!existsSync(dir)) return files;

  const entries = await readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await findJsonFiles(fullPath, files);
    } else if (entry.name.endsWith('.json')) {
      files.push(fullPath);
    }
  }
  return files;
}

/**
 * List command handler
 */
export async function listCommand(options) {
  const { dir } = options;

  if (!existsSync(dir)) {
    console.log('No servers directory found. Import some servers first:');
    console.log('  mcp-registry search <query>');
    console.log('  mcp-registry import <server-name>');
    return;
  }

  const files = await findJsonFiles(dir);

  if (files.length === 0) {
    console.log('No servers found in local registry.');
    console.log('\nImport servers from the official registry:');
    console.log('  mcp-registry search <query>');
    console.log('  mcp-registry import <server-name>');
    return;
  }

  // Collect all servers from all files
  const allServers = [];

  for (const file of files) {
    try {
      const content = await readFile(file, 'utf-8');
      const data = JSON.parse(content);

      // Handle both single-server and multi-server formats
      const servers = data.servers ? data.servers : [data];

      for (const server of servers) {
        allServers.push({ ...server, _file: file });
      }
    } catch (err) {
      console.log(`  ⚠️  ${file} (invalid JSON)`);
    }
  }

  if (allServers.length === 0) {
    console.log('No servers found in local registry.');
    return;
  }

  console.log(`📦 Local Registry (${allServers.length} server(s) in ${files.length} file(s)):\n`);

  for (const server of allServers) {
    const latestVersion = server.versions?.find(v => v.isLatest) || server.versions?.[0];
    const versionCount = server.versions?.length || 0;

    console.log(`  ${server.name}`);
    console.log(`     ${server.description}`);
    console.log(`     Latest: ${latestVersion?.version || 'unknown'} (${versionCount} version${versionCount !== 1 ? 's' : ''})`);
    console.log();
  }
}
