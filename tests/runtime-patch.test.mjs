import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { prepareRuntime } from '../electron/runtime.mjs';

// 0.22.0 的教训：image-offload 原本写在 disabled 清单里，插一行同 id 的挂载不会生效，
// 界面上、发布说明里都写着「已挂载」，实际仍然是禁用。这条用例盯住补丁文件本身。
async function patchRows() {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'zx-patch-'));
  const file = await prepareRuntime(directory, {
    baseUrl: 'http://127.0.0.1:9/v1',
    model: 'demo',
    protocol: 'openai',
    contextWindow: 128000,
    maxTokens: 8192,
  });
  const rows = JSON.parse(await fs.readFile(file, 'utf8'));
  await fs.rm(directory, { recursive: true, force: true });
  return rows;
}

test('压缩配置写进补丁时用桌面版默认 headroom', async () => {
  const rows = await patchRows();
  const compaction = rows.find(row => row.id === 'compaction-basic');
  assert.deepEqual(compaction.config, { headroomTokens: 65536, maxTokens: 65536, thresholdRatio: 0.8, retainRatio: 0.16 });
});

test('image-offload 不在禁用清单里，且作为挂载项插入', async () => {
  const rows = await patchRows();
  assert.equal(rows.filter(row => row.id === 'image-offload' && row.disabled === true).length, 0);
  const insert = rows.find(row => Array.isArray(row.insert)).insert;
  const mounted = insert.filter(row => row.id === 'image-offload');
  assert.equal(mounted.length, 1);
  assert.match(mounted[0].name, /dsh-compaction-image-offload/);
});
