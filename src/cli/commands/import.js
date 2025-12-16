import { writeFile, mkdir, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { existsSync } from 'fs';

const OFFICIAL_REGISTRY = 'https://registry.modelcontextprotocol.io';

/**
 * Fetch JSON from a URL
 */
async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }
  return response.json();
}

/**
 * Get server details from registry
 */
async function getServerFromRegistry(registryUrl, serverName, version = 'latest') {
  const encodedName = encodeURIComponent(serverName);
  const url = `${registryUrl}/v0/servers/${encodedName}/versions/${version}`;
  const data = await fetchJson(url);
  // Handle official registry format (nested {server, _meta})
  return data.server ? data.server : data;
}

/**
 * Get all versions of a server
 */
async function getServerVersions(registryUrl, serverName) {
  const encodedName = encodeURIComponent(serverName);
  const url = `${registryUrl}/v0/servers/${encodedName}/versions`;
  return fetchJson(url);
}

/**
 * Build a server object in our internal format
 */
function buildServerObject(serverData, versions) {
  return {
    name: serverData.name,
    description: serverData.description,
    repository: serverData.repository,
    websiteUrl: serverData.websiteUrl,
    versions: versions.map((v, i) => ({
      version: v.version,
      releaseDate: v.releaseDate,
      isLatest: i === 0,
      packages: v.packages || []
    }))
  };
}

// Official MCP schema URL
const OFFICIAL_SCHEMA = 'https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json';

/**
 * Determine default output file path from server name
 * e.g., "io.github.user/my-server" -> "servers/io.github.user/my-server.json"
 */
function getDefaultOutputPath(outputDir, serverName) {
  const [namespace, name] = serverName.split('/');
  return join(outputDir, namespace, `${name}.json`);
}

/**
 * Load existing file (handles both single-server and multi-server formats)
 */
async function loadExistingFile(filePath) {
  if (!existsSync(filePath)) {
    return null;
  }

  const content = await readFile(filePath, 'utf-8');
  const data = JSON.parse(content);

  // Detect format
  if (data.servers && Array.isArray(data.servers)) {
    return { format: 'multi', data };
  }
  return { format: 'single', data };
}

/**
 * Import command handler
 */
export async function importCommand(serverName, options) {
  const { registry, version, allVersions, output, file } = options;

  console.log(`🔍 Fetching ${serverName} from ${registry}...`);

  try {
    let versionsData = [];

    if (allVersions) {
      // Fetch all versions - the endpoint returns {servers: [{server, _meta}, ...]}
      console.log('   Fetching all versions...');
      const serverInfo = await getServerVersions(registry, serverName);
      const rawServers = serverInfo.servers || [];

      // Extract server objects from the response
      for (const item of rawServers) {
        const server = item.server ? item.server : item;
        console.log(`   Found version ${server.version}`);
        versionsData.push(server);
      }
    } else {
      // Fetch single version
      const targetVersion = version || 'latest';
      console.log(`   Fetching version: ${targetVersion}`);
      const versionData = await getServerFromRegistry(registry, serverName, targetVersion);
      versionsData.push(versionData);
    }

    if (versionsData.length === 0) {
      console.error('❌ No versions found');
      process.exit(1);
    }

    // Determine output path
    const outputPath = file || getDefaultOutputPath(output, serverName);
    const existing = await loadExistingFile(outputPath);

    // Build the new server entry
    const mergedVersions = mergeVersions([], versionsData);
    const serverData = versionsData[0];
    const newServer = buildServerObject(serverData, mergedVersions);

    let outputData;
    let serverCount;

    if (existing) {
      if (existing.format === 'multi') {
        // Multi-server file: add or update the server in the array
        const servers = existing.data.servers;
        const existingIndex = servers.findIndex(s => s.name === serverName);

        if (existingIndex >= 0) {
          // Update existing server, merge versions
          const existingServer = servers[existingIndex];
          const allVersions = mergeVersions(existingServer.versions || [], versionsData);
          servers[existingIndex] = buildServerObject(serverData, allVersions);
          console.log('   Updated existing server in multi-server file');
        } else {
          // Add new server
          servers.push(newServer);
          console.log('   Added to existing multi-server file');
        }

        outputData = {
          $schema: OFFICIAL_SCHEMA,
          servers
        };
        serverCount = servers.length;
      } else {
        // Single-server file
        if (existing.data.name === serverName) {
          // Same server, merge versions
          const allVersions = mergeVersions(existing.data.versions || [], versionsData);
          outputData = {
            $schema: OFFICIAL_SCHEMA,
            ...buildServerObject(serverData, allVersions)
          };
          serverCount = 1;
          console.log('   Merged with existing server file');
        } else {
          // Different server - convert to multi-server format
          outputData = {
            $schema: OFFICIAL_SCHEMA,
            servers: [existing.data, newServer]
          };
          serverCount = 2;
          console.log('   Converted to multi-server file');
        }
      }
    } else {
      // New file - use single server format by default, multi-server if --file specified
      if (file) {
        // User specified a file, use multi-server format for future flexibility
        outputData = {
          $schema: OFFICIAL_SCHEMA,
          servers: [newServer]
        };
        serverCount = 1;
      } else {
        // Default: single server format
        outputData = {
          $schema: OFFICIAL_SCHEMA,
          ...newServer
        };
        serverCount = 1;
      }
    }

    // Write file
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, JSON.stringify(outputData, null, 2));

    console.log(`\n✅ Imported ${serverName}`);
    console.log(`   📁 ${outputPath}`);
    console.log(`   📦 ${mergedVersions.length} version(s): ${mergedVersions.map(v => v.version).join(', ')}`);
    if (serverCount > 1) {
      console.log(`   📋 File contains ${serverCount} server(s)`);
    }

  } catch (err) {
    if (err.message.includes('404')) {
      console.error(`❌ Server not found: ${serverName}`);
      console.error('   Use "mcp-registry search <query>" to find available servers');
    } else {
      console.error(`❌ Import failed: ${err.message}`);
    }
    process.exit(1);
  }
}

/**
 * Merge existing versions with new versions
 */
function mergeVersions(existingVersions, newVersionsData) {
  const versionMap = new Map();

  // Add existing versions
  for (const v of existingVersions) {
    versionMap.set(v.version, v);
  }

  // Add/update with new versions
  for (const v of newVersionsData) {
    versionMap.set(v.version, {
      version: v.version,
      releaseDate: v.releaseDate,
      packages: v.packages || []
    });
  }

  // Sort versions (newest first)
  const merged = Array.from(versionMap.values()).sort((a, b) => {
    return b.version.localeCompare(a.version, undefined, { numeric: true });
  });

  // Mark latest
  merged.forEach((v, i) => {
    v.isLatest = i === 0;
  });

  return merged;
}
