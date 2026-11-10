import path from 'path';
import fs from 'fs';

function parseEnvValue(rawValue: string): string {
  let value = rawValue.trim();

  if (!value) return '';

  const firstHashIndex = value.search(/(^|[^\\])\s#/);
  if (firstHashIndex !== -1 && !value.startsWith('"') && !value.startsWith("'")) {
    value = value.slice(0, firstHashIndex + 1).trim();
  }

  if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
    return value.slice(1, -1);
  }

  return value;
}

export function loadEnvFileFromCwd(cwd = process.cwd()): void {
  const envPath = path.join(cwd, '.env');
  if (!fs.existsSync(envPath)) return;

  const envConfig = fs.readFileSync(envPath, 'utf-8');
  envConfig.split(/\r?\n/).forEach(line => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) return;

    const normalizedLine = trimmed.replace(/^export\s+/, '');
    const firstEquals = normalizedLine.indexOf('=');
    if (firstEquals === -1) return;

    const key = normalizedLine.substring(0, firstEquals).trim();
    const rawValue = normalizedLine.substring(firstEquals + 1);
    const value = parseEnvValue(rawValue);

    if (key && !(key in process.env)) {
      process.env[key] = value;
    }
  });
}

// Manual .env parser (not the `dotenv` package, to avoid a new dependency) so this works across
// all Node versions/deployment environments. Imported purely for its side effect - must be the
// first import in any entrypoint that reads process.env.* at module-load time (e.g.
// image/config.ts's DEFAULT_CONFIG), since ES module imports are evaluated before the importing
// module's own subsequent top-level code runs.
try {
  loadEnvFileFromCwd();
} catch (e) {
  console.error('Error loading .env file:', e);
}
