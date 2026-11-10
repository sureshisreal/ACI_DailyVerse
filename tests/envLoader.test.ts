import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { loadEnvFileFromCwd } from '../envLoader';

test('loadEnvFileFromCwd reads quoted and commented env values', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'env-loader-'));
  const envPath = path.join(tempDir, '.env');
  fs.writeFileSync(envPath, 'HF_TOKEN="hf_test_token"\n# keep this comment\nOTHER=value\n', 'utf8');

  const originalToken = process.env.HF_TOKEN;
  const originalOther = process.env.OTHER;
  delete process.env.HF_TOKEN;
  delete process.env.OTHER;

  try {
    loadEnvFileFromCwd(tempDir);
    assert.equal(process.env.HF_TOKEN, 'hf_test_token');
    assert.equal(process.env.OTHER, 'value');
  } finally {
    if (originalToken === undefined) delete process.env.HF_TOKEN; else process.env.HF_TOKEN = originalToken;
    if (originalOther === undefined) delete process.env.OTHER; else process.env.OTHER = originalOther;
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
