/**
 * Tests for the build script functionality
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdir, writeFile, rm, readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const TEST_SERVERS_DIR = join(ROOT, 'tests', 'fixtures', 'servers');
const TEST_DIST_DIR = join(ROOT, 'tests', 'fixtures', 'dist');

// Helper to create test server files
async function createTestServer(path, data) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(data, null, 2));
}

// Helper to run build script with custom dirs
async function runBuild() {
  // Import and run the build logic directly would be better,
  // but for now we'll test via the actual files
  execSync('npm run build', { cwd: ROOT, stdio: 'pipe' });
}

describe('Build Script', () => {
  describe('Single Server Format', () => {
    test('should load single server file correctly', async () => {
      // The existing servers directory has test files
      await runBuild();

      const serversJson = join(ROOT, 'dist', 'api', 'v0.1', 'servers.json');
      assert.ok(existsSync(serversJson), 'servers.json should exist');

      const data = JSON.parse(await readFile(serversJson, 'utf-8'));
      assert.ok(Array.isArray(data.servers), 'servers should be an array');
      assert.ok(data.servers.length > 0, 'should have at least one server');
    });

    test('should generate version files for each server', async () => {
      await runBuild();

      const apiDir = join(ROOT, 'dist', 'api', 'v0.1', 'servers');
      const encodedName = encodeURIComponent('io.github.anthropics/mcp-server-memory');
      const versionsFile = join(apiDir, encodedName, 'versions.json');

      assert.ok(existsSync(versionsFile), 'versions.json should exist for server');

      const data = JSON.parse(await readFile(versionsFile, 'utf-8'));
      assert.strictEqual(data.name, 'io.github.anthropics/mcp-server-memory');
      assert.ok(Array.isArray(data.versions), 'versions should be an array');
    });

    test('should generate latest.json for each server', async () => {
      await runBuild();

      const apiDir = join(ROOT, 'dist', 'api', 'v0.1', 'servers');
      const encodedName = encodeURIComponent('io.github.anthropics/mcp-server-memory');
      const latestFile = join(apiDir, encodedName, 'versions', 'latest.json');

      assert.ok(existsSync(latestFile), 'latest.json should exist');

      const data = JSON.parse(await readFile(latestFile, 'utf-8'));
      assert.ok(data.version, 'should have version field');
      assert.ok(data.packages, 'should have packages field');
    });
  });

  describe('Multi-Server Format', () => {
    test('should load multi-server file correctly', async () => {
      await runBuild();

      const serversJson = join(ROOT, 'dist', 'api', 'v0.1', 'servers.json');
      const data = JSON.parse(await readFile(serversJson, 'utf-8'));

      // Check for servers from the multi-server example file
      const filesystem = data.servers.find(s => s.name === 'io.github.example/filesystem');
      const database = data.servers.find(s => s.name === 'io.github.example/database');

      assert.ok(filesystem, 'should include filesystem server from multi-server file');
      assert.ok(database, 'should include database server from multi-server file');
    });

    test('should handle multiple versions in multi-server file', async () => {
      await runBuild();

      const apiDir = join(ROOT, 'dist', 'api', 'v0.1', 'servers');
      const encodedName = encodeURIComponent('io.github.example/filesystem');
      const versionsFile = join(apiDir, encodedName, 'versions.json');

      const data = JSON.parse(await readFile(versionsFile, 'utf-8'));
      assert.ok(data.versions.length >= 2, 'filesystem should have multiple versions');
    });
  });

  describe('API Output Format', () => {
    test('servers.json should have correct structure', async () => {
      await runBuild();

      const serversJson = join(ROOT, 'dist', 'api', 'v0.1', 'servers.json');
      const data = JSON.parse(await readFile(serversJson, 'utf-8'));

      assert.ok(data.servers, 'should have servers array');
      assert.ok(typeof data.total === 'number', 'should have total count');
      assert.ok(data.generated, 'should have generated timestamp');

      // Check server summary format
      const server = data.servers[0];
      assert.ok(server.name, 'server should have name');
      assert.ok(server.description, 'server should have description');
      assert.ok(server.version, 'server should have version (latest)');
    });

    test('version detail should include packages', async () => {
      await runBuild();

      const apiDir = join(ROOT, 'dist', 'api', 'v0.1', 'servers');
      const encodedName = encodeURIComponent('com.microsoft/azure');
      const latestFile = join(apiDir, encodedName, 'versions', 'latest.json');

      const data = JSON.parse(await readFile(latestFile, 'utf-8'));
      assert.ok(Array.isArray(data.packages), 'should have packages array');
      assert.ok(data.packages.length > 0, 'should have at least one package');

      const pkg = data.packages[0];
      assert.ok(pkg.registryType, 'package should have registryType');
      assert.ok(pkg.identifier, 'package should have identifier');
      assert.ok(pkg.transport, 'package should have transport');
    });
  });

  describe('Web Assets', () => {
    test('should copy web assets to dist', async () => {
      await runBuild();

      assert.ok(existsSync(join(ROOT, 'dist', 'index.html')), 'index.html should exist');
      assert.ok(existsSync(join(ROOT, 'dist', 'app.js')), 'app.js should exist');
      assert.ok(existsSync(join(ROOT, 'dist', 'styles.css')), 'styles.css should exist');
    });

    test('should copy schemas to dist', async () => {
      await runBuild();

      assert.ok(
        existsSync(join(ROOT, 'dist', 'schemas', 'server.schema.json')),
        'server.schema.json should be copied'
      );
    });
  });
});
