/**
 * Tests for schema validation
 */

import { test, describe } from 'node:test';
import assert from 'node:assert';
import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// Simple JSON Schema validator for testing
function validateServer(server, errors = []) {
  if (!server.name) {
    errors.push('Missing required field: name');
  } else if (!/^[a-z][a-z0-9-]*(\.[a-z][a-z0-9-]*)*\/[a-z][a-z0-9-]*$/.test(server.name)) {
    errors.push(`Invalid name format: ${server.name}`);
  }

  if (!server.description) {
    errors.push('Missing required field: description');
  }

  if (!server.versions || !Array.isArray(server.versions)) {
    errors.push('Missing or invalid field: versions (must be array)');
  } else {
    server.versions.forEach((v, i) => {
      if (!v.version) {
        errors.push(`Version ${i}: missing version field`);
      }
      if (!v.packages || !Array.isArray(v.packages)) {
        errors.push(`Version ${i}: missing or invalid packages array`);
      } else {
        v.packages.forEach((pkg, j) => {
          if (!pkg.registryType) {
            errors.push(`Version ${i}, Package ${j}: missing registryType`);
          }
          if (!pkg.identifier) {
            errors.push(`Version ${i}, Package ${j}: missing identifier`);
          }
          if (!pkg.transport || !pkg.transport.type) {
            errors.push(`Version ${i}, Package ${j}: missing transport.type`);
          }
        });
      }
    });
  }

  return errors;
}

function validateFile(data) {
  const errors = [];

  // Check if multi-server format
  if (data.servers && Array.isArray(data.servers)) {
    data.servers.forEach((server, i) => {
      const serverErrors = validateServer(server);
      serverErrors.forEach(e => errors.push(`Server ${i}: ${e}`));
    });
  } else {
    // Single server format
    validateServer(data, errors);
  }

  return errors;
}

describe('Schema Validation', () => {
  describe('Single Server Format', () => {
    test('should validate single server file', async () => {
      const filePath = join(ROOT, 'servers', 'io.github.anthropics', 'mcp-server-memory.json');
      const data = JSON.parse(await readFile(filePath, 'utf-8'));

      const errors = validateFile(data);
      assert.deepStrictEqual(errors, [], `Validation errors: ${errors.join(', ')}`);
    });

    test('should validate azure server file', async () => {
      const filePath = join(ROOT, 'servers', 'com.microsoft', 'azure.json');
      const data = JSON.parse(await readFile(filePath, 'utf-8'));

      const errors = validateFile(data);
      assert.deepStrictEqual(errors, [], `Validation errors: ${errors.join(', ')}`);
    });
  });

  describe('Multi-Server Format', () => {
    test('should validate multi-server file', async () => {
      const filePath = join(ROOT, 'servers', 'examples', 'my-servers.json');
      const data = JSON.parse(await readFile(filePath, 'utf-8'));

      const errors = validateFile(data);
      assert.deepStrictEqual(errors, [], `Validation errors: ${errors.join(', ')}`);
    });
  });

  describe('Name Validation', () => {
    test('should accept valid names', () => {
      const validNames = [
        'io.github.user/server',
        'com.microsoft/azure',
        'io.github.anthropics/mcp-server-memory',
        'ai.example/my-server',
        'com.company.subdomain/server-name'
      ];

      validNames.forEach(name => {
        const server = {
          name,
          description: 'Test',
          versions: [{ version: '1.0.0', packages: [{ registryType: 'npm', identifier: 'test', transport: { type: 'stdio' } }] }]
        };
        const errors = validateServer(server);
        assert.deepStrictEqual(errors, [], `Name "${name}" should be valid`);
      });
    });

    test('should reject invalid names', () => {
      const invalidNames = [
        'invalid', // no slash
        'Invalid/server', // uppercase
        'io.github/user/server', // too many slashes
        '123.github/server', // starts with number
        'io.github./server', // empty segment
      ];

      invalidNames.forEach(name => {
        const server = {
          name,
          description: 'Test',
          versions: [{ version: '1.0.0', packages: [{ registryType: 'npm', identifier: 'test', transport: { type: 'stdio' } }] }]
        };
        const errors = validateServer(server);
        assert.ok(errors.length > 0, `Name "${name}" should be invalid`);
      });
    });
  });

  describe('Version Validation', () => {
    test('should require version field', () => {
      const server = {
        name: 'io.github.test/server',
        description: 'Test',
        versions: [{ packages: [{ registryType: 'npm', identifier: 'test', transport: { type: 'stdio' } }] }]
      };

      const errors = validateServer(server);
      assert.ok(errors.some(e => e.includes('missing version')), 'should report missing version');
    });

    test('should require packages array', () => {
      const server = {
        name: 'io.github.test/server',
        description: 'Test',
        versions: [{ version: '1.0.0' }]
      };

      const errors = validateServer(server);
      assert.ok(errors.some(e => e.includes('packages')), 'should report missing packages');
    });
  });

  describe('Package Validation', () => {
    test('should require registryType', () => {
      const server = {
        name: 'io.github.test/server',
        description: 'Test',
        versions: [{
          version: '1.0.0',
          packages: [{ identifier: 'test', transport: { type: 'stdio' } }]
        }]
      };

      const errors = validateServer(server);
      assert.ok(errors.some(e => e.includes('registryType')), 'should report missing registryType');
    });

    test('should require transport.type', () => {
      const server = {
        name: 'io.github.test/server',
        description: 'Test',
        versions: [{
          version: '1.0.0',
          packages: [{ registryType: 'npm', identifier: 'test', transport: {} }]
        }]
      };

      const errors = validateServer(server);
      assert.ok(errors.some(e => e.includes('transport.type')), 'should report missing transport.type');
    });
  });
});

describe('Generated API Validation', () => {
  test('should generate valid servers.json', async () => {
    const filePath = join(ROOT, 'dist', 'api', 'v0.1', 'servers.json');
    const data = JSON.parse(await readFile(filePath, 'utf-8'));

    assert.ok(Array.isArray(data.servers), 'servers should be array');
    assert.ok(typeof data.total === 'number', 'total should be number');
    assert.ok(data.generated, 'should have generated timestamp');

    // Validate each server summary
    data.servers.forEach((server, i) => {
      assert.ok(server.name, `Server ${i} should have name`);
      assert.ok(server.description, `Server ${i} should have description`);
      assert.ok(server.version, `Server ${i} should have version`);
    });
  });
});
