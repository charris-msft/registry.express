/**
 * Tests for CLI commands
 */

import { test, describe, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import { mkdir, writeFile, rm, readFile, readdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { existsSync } from 'fs';
import { execSync, exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CLI = 'node src/cli/index.js';

describe('CLI Commands', () => {
  describe('list command', () => {
    test('should list servers in local registry', async () => {
      const { stdout } = await execAsync(`${CLI} list`, { cwd: ROOT });

      assert.ok(stdout.includes('Local Registry'), 'should show Local Registry header');
      assert.ok(stdout.includes('server(s)'), 'should show server count');
    });

    test('should show server names and descriptions', async () => {
      const { stdout } = await execAsync(`${CLI} list`, { cwd: ROOT });

      // Should show at least one of our test servers
      assert.ok(
        stdout.includes('io.github.anthropics/mcp-server-memory') ||
        stdout.includes('io.github.example/filesystem') ||
        stdout.includes('com.microsoft/azure'),
        'should list at least one known server'
      );
    });

    test('should show version info', async () => {
      const { stdout } = await execAsync(`${CLI} list`, { cwd: ROOT });

      assert.ok(stdout.includes('Latest:'), 'should show latest version');
      assert.ok(stdout.includes('version'), 'should show version count');
    });
  });

  describe('search command', () => {
    test('should search official registry', async () => {
      const { stdout } = await execAsync(`${CLI} search "azure"`, { cwd: ROOT });

      assert.ok(stdout.includes('Searching for'), 'should show search message');
      assert.ok(
        stdout.includes('com.microsoft/azure') || stdout.includes('No servers found'),
        'should show results or no results message'
      );
    });

    test('should support multiple keywords with pipe', async () => {
      const { stdout } = await execAsync(`${CLI} search "azure|microsoft"`, { cwd: ROOT });

      assert.ok(stdout.includes('Searching for'), 'should show search message');
    });

    test('should output JSON with --json flag', async () => {
      const { stdout } = await execAsync(`${CLI} search "azure" --json`, { cwd: ROOT });

      // JSON mode outputs just server names, one per line
      const lines = stdout.trim().split('\n').filter(l => l.length > 0);

      // Either we get server names or empty (no results)
      if (lines.length > 0) {
        // Server names should contain a slash
        assert.ok(lines[0].includes('/'), 'should output server names with namespace');
      }
    });

    test('should respect --limit option', async () => {
      const { stdout } = await execAsync(`${CLI} search "mcp" --limit 5 --json`, { cwd: ROOT });

      const lines = stdout.trim().split('\n').filter(l => l.length > 0);
      assert.ok(lines.length <= 5, 'should respect limit');
    });
  });

  describe('import command', () => {
    const TEST_OUTPUT_DIR = join(ROOT, 'tests', 'fixtures', 'import-test');

    beforeEach(async () => {
      // Clean up test directory
      if (existsSync(TEST_OUTPUT_DIR)) {
        await rm(TEST_OUTPUT_DIR, { recursive: true });
      }
      await mkdir(TEST_OUTPUT_DIR, { recursive: true });
    });

    afterEach(async () => {
      // Clean up
      if (existsSync(TEST_OUTPUT_DIR)) {
        await rm(TEST_OUTPUT_DIR, { recursive: true });
      }
    });

    test('should import server from official registry', async () => {
      const { stdout } = await execAsync(
        `${CLI} import "com.microsoft/azure" -o "${TEST_OUTPUT_DIR}"`,
        { cwd: ROOT }
      );

      assert.ok(stdout.includes('Imported com.microsoft/azure'), 'should show success message');

      // Check file was created
      const expectedFile = join(TEST_OUTPUT_DIR, 'com.microsoft', 'azure.json');
      assert.ok(existsSync(expectedFile), 'should create server file');

      // Validate content
      const data = JSON.parse(await readFile(expectedFile, 'utf-8'));
      assert.strictEqual(data.name, 'com.microsoft/azure');
      assert.ok(data.description, 'should have description');
      assert.ok(Array.isArray(data.versions), 'should have versions array');
      assert.ok(data.versions.length > 0, 'should have at least one version');
    });

    test('should import all versions with --all-versions', async () => {
      const { stdout } = await execAsync(
        `${CLI} import "com.microsoft/azure" --all-versions -o "${TEST_OUTPUT_DIR}"`,
        { cwd: ROOT }
      );

      assert.ok(stdout.includes('Imported'), 'should show success message');

      const expectedFile = join(TEST_OUTPUT_DIR, 'com.microsoft', 'azure.json');
      const data = JSON.parse(await readFile(expectedFile, 'utf-8'));

      // Azure has multiple versions
      assert.ok(data.versions.length >= 2, 'should have multiple versions');
    });

    test('should import to specific file with --file', async () => {
      const targetFile = join(TEST_OUTPUT_DIR, 'my-servers.json');

      const { stdout } = await execAsync(
        `${CLI} import "com.microsoft/azure" --file "${targetFile}"`,
        { cwd: ROOT }
      );

      assert.ok(existsSync(targetFile), 'should create specified file');

      const data = JSON.parse(await readFile(targetFile, 'utf-8'));
      // When using --file, should use multi-server format
      assert.ok(Array.isArray(data.servers), 'should use multi-server format');
      assert.strictEqual(data.servers[0].name, 'com.microsoft/azure');
    });

    test('should merge into existing multi-server file', async () => {
      const targetFile = join(TEST_OUTPUT_DIR, 'my-servers.json');

      // Create initial file with one server
      await writeFile(targetFile, JSON.stringify({
        $schema: 'https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json',
        servers: [{
          name: 'test/server-one',
          description: 'Test server',
          versions: [{ version: '1.0.0', isLatest: true, packages: [] }]
        }]
      }, null, 2));

      // Import another server to same file
      await execAsync(
        `${CLI} import "com.microsoft/azure" --file "${targetFile}"`,
        { cwd: ROOT }
      );

      const data = JSON.parse(await readFile(targetFile, 'utf-8'));
      assert.strictEqual(data.servers.length, 2, 'should have two servers');
      assert.ok(
        data.servers.some(s => s.name === 'test/server-one'),
        'should keep original server'
      );
      assert.ok(
        data.servers.some(s => s.name === 'com.microsoft/azure'),
        'should add new server'
      );
    });
  });

  describe('build command', () => {
    test('should build successfully', async () => {
      const { stdout } = await execAsync(`${CLI} build`, { cwd: ROOT });

      assert.ok(stdout.includes('Building MCP Registry'), 'should show build message');
      assert.ok(stdout.includes('Build complete'), 'should complete successfully');
    });

    test('should generate dist directory', async () => {
      await execAsync(`${CLI} build`, { cwd: ROOT });

      assert.ok(existsSync(join(ROOT, 'dist')), 'dist should exist');
      assert.ok(existsSync(join(ROOT, 'dist', 'api', 'v0.1', 'servers.json')), 'servers.json should exist');
    });
  });
});
