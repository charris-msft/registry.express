import { spawn } from 'child_process';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const BUILD_SCRIPT = join(__dirname, '..', '..', '..', 'scripts', 'build.js');

/**
 * Build command handler - delegates to the build script
 */
export async function buildCommand(options) {
  const args = [BUILD_SCRIPT];
  if (options.watch) {
    args.push('--watch');
  }

  const child = spawn('node', args, {
    stdio: 'inherit',
    cwd: join(__dirname, '..', '..', '..')
  });

  child.on('error', (err) => {
    console.error(`❌ Build failed: ${err.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
}
