/**
 * Search for MCP servers in a registry
 */

import { importCommand } from './import.js';

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Search for multiple queries and combine results
 */
async function searchMultiple(queries, registry, limit) {
  const allServers = [];
  const seenNames = new Set();

  for (const q of queries) {
    const trimmed = q.trim();
    if (!trimmed) continue;

    const url = `${registry}/v0/servers?search=${encodeURIComponent(trimmed)}`;
    const data = await fetchJson(url);
    const rawServers = data.servers || [];

    for (const item of rawServers) {
      const server = item.server ? item.server : item;
      // Dedupe by name+version
      const key = `${server.name}@${server.version}`;
      if (!seenNames.has(key)) {
        seenNames.add(key);
        allServers.push(server);
      }
    }
  }

  return allServers.slice(0, parseInt(limit));
}

/**
 * Search command handler
 */
export async function searchCommand(query, options) {
  const { registry, limit, json, importAll, output } = options;

  // Split query by | for multiple searches
  const queries = query.split('|');

  // JSON mode: output server names only (one per line)
  if (json) {
    try {
      const servers = await searchMultiple(queries, registry, limit);

      // Output unique server names, one per line
      const uniqueNames = [...new Set(servers.map(s => s.name))];
      uniqueNames.forEach(name => console.log(name));
      return;
    } catch (err) {
      console.error(err.message);
      process.exit(1);
    }
  }

  console.log(`🔍 Searching for "${query}" in ${registry}...\n`);

  try {
    const servers = await searchMultiple(queries, registry, limit);

    if (servers.length === 0) {
      console.log('No servers found matching your query.');
      console.log('\nTry a broader search term.');
      return;
    }

    console.log(`Found ${servers.length} server(s):\n`);

    // Get unique server names
    const uniqueNames = [...new Set(servers.map(s => s.name))];

    for (const server of servers) {
      console.log(`  📦 ${server.name}`);
      console.log(`     ${server.description || 'No description'}`);
      if (server.version) {
        console.log(`     Version: ${server.version}`);
      }
      console.log();
    }

    // Import all if requested
    if (importAll) {
      console.log(`\n📥 Importing ${uniqueNames.length} server(s)...\n`);

      for (const name of uniqueNames) {
        await importCommand(name, { registry, output });
        console.log();
      }

      console.log(`✅ Imported ${uniqueNames.length} server(s)`);
      return;
    }

    console.log('To import a server:');
    console.log(`  npm run cli import <server-name>`);
    console.log('\nExample:');
    if (servers.length > 0) {
      console.log(`  npm run cli import "${servers[0].name}"`);
    }
    console.log('\nTo import all results:');
    console.log(`  npm run cli search "${query}" --import-all`);

  } catch (err) {
    console.error(`❌ Search failed: ${err.message}`);
    process.exit(1);
  }
}
