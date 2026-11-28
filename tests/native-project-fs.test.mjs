import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';

// harness/native-project-fs.mjs 是模型写文件的唯一原生入口，围栏写错一行就是
// 「模型能写到工作区外」。这个文件直接压六个入口：resolve、checkReadTarget、
// readBytes、writeText、editText、patchText，每个场景都断言工作区外（或私密位置）
// 没有副作用。
const packed = process.env.ZHIXING_TEST_PACKED_APP;
const load = (name) =>
  import(
    packed
      ? pathToFileURL(path.join(packed, name)).href
      : new URL(`../${name}`, import.meta.url).href
  );
const nativeRequire = createRequire(
  packed ? path.join(packed, 'package.json') : new URL('../package.json', import.meta.url),
);
const native = (name) => import(pathToFileURL(nativeRequire.resolve(name)).href);

const { Context } = await native('@deepseek-ai/cordis');
const { parsePatch } = await native('@deepseek-ai/dsh-fs-patch');
const { installNativeProjectFilePolicy } = await load('harness/native-project-fs.mjs');
const NativeProjectFileSystem = (await load('harness/native-project-fs.mjs')).default;

const MAX_WRITE_BYTES = 1024 * 1024;

const FILES = {
  'a.txt': '第一行\n第二行\n',
  'notes/readme.md': '# 项目说明\n',
  '.env': 'SECRET=1\n',
  '.env.local': 'SECRET=2\n',
  'secret.pem': 'PEM\n',
  'private.key': 'KEY\n',
  'workspace.bin': 'bin\n',
  'vaults/record.txt': 'vault\n',
  '.git/config': '[core]\n',
  'node_modules/pkg/index.js': 'module\n',
};

const OUTSIDE_BODY = '工作区外的内容\n';

async function fixture(t, options = {}) {
  const parent = await fs.realpath(os.tmpdir());
  const base = await fs.mkdtemp(path.join(parent, 'zhixing-fence-'));
  const root = path.join(base, 'project');
  const outside = path.join(base, 'outside');
  await fs.mkdir(root);
  await fs.mkdir(outside);
  for (const [name, body] of Object.entries({ ...FILES, ...options.files })) {
    await fs.mkdir(path.dirname(path.join(root, name)), { recursive: true });
    await fs.writeFile(path.join(root, name), body);
  }
  await fs.writeFile(path.join(outside, 'secret.txt'), OUTSIDE_BODY);

  const calls = { permit: [], restored: [], protected: [] };
  const handlers = new Map();
  installNativeProjectFilePolicy(
    { on: (name, handler) => handlers.set(name, handler) },
    {
      root,
      restoreValue: async (value) => {
        calls.restored.push(value);
        return options.restore ? options.restore(value) : value;
      },
      permit: async (exec, target, operation) => {
        calls.permit.push({ target, operation });
        return options.permit?.({ exec, target, operation });
      },
      protectedValue: async (value) => {
        calls.protected.push(value);
        return value;
      },
    },
  );
  const context = new Context();
  const fileSystem = new NativeProjectFileSystem(context, {
    cwd: root,
    diffBasisMaxBytes: MAX_WRITE_BYTES,
  });
  const controller = new AbortController();
  t.after(async () => {
    controller.abort();
    await context.fiber.dispose();
    await fs.rm(base, { recursive: true, force: true, maxRetries: 6, retryDelay: 100 });
  });

  // tools/execute 是在承上启下的那一跳里把 root、restoreValue、permit 放进
  // AsyncLocalStorage 的；所有入口都必须在那个回调里调用才带得到围栏。
  const inScope = (name, work) =>
    handlers.get('tools/execute')({ name, signal: controller.signal }, work);
  const at = (directory, relative) => path.join(directory, relative);
  const real = async (absolute) => ({
    displayPath: absolute,
    targetKey: await fs.realpath(absolute),
  });
  return {
    base,
    root,
    outside,
    calls,
    handlers,
    fileSystem,
    inScope,
    at,
    real,
    inside: (relative) => real(at(root, relative)),
  };
}

function patch(...lines) {
  return ['*** Begin Patch', ...lines, '*** End Patch', ''].join('\n');
}

async function exists(file) {
  return fs.access(file).then(
    () => true,
    () => false,
  );
}

test('resolve：项目内的相对路径解析成工作区里的真实路径', async (t) => {
  const f = await fixture(t);
  await f.inScope('read', async () => {
    const target = await f.fileSystem.resolve('a.txt');
    assert.equal(target.displayPath, f.at(f.root, 'a.txt'));
    assert.equal(target.targetKey, await fs.realpath(f.at(f.root, 'a.txt')));

    const nested = await f.fileSystem.resolve('notes/readme.md');
    assert.equal(nested.targetKey, await fs.realpath(f.at(f.root, 'notes/readme.md')));

    const missing = await f.fileSystem.resolve('待创建.txt');
    assert.equal(missing.targetKey, f.at(f.root, '待创建.txt'));
  });
});

// resolve 只放行普通文件：projectTarget 对目录直接拒绝。当前内核没有哪个工具用
// resolve 列目录（glob/grep 走 prepareNativeSearch 的 workspaceTarget），所以这不是
// 活路径，但换成 list 类工具时会撞上这句「请选择项目内的普通文件」。
test('resolve：目录不是它的目标', async (t) => {
  const f = await fixture(t);
  await f.inScope('read', async () => {
    await assert.rejects(f.fileSystem.resolve('notes'), /请选择项目内的普通文件/);
  });
});

test('resolve：.. 越界被拒绝', async (t) => {
  const f = await fixture(t);
  await f.inScope('write', async () => {
    await assert.rejects(f.fileSystem.resolve('../escape.txt'), /不在可浏览的项目范围内/);
    await assert.rejects(
      f.fileSystem.resolve('notes/../../outside/secret.txt'),
      /不在可浏览的项目范围内/,
    );
  });
});

test('resolve：工作区外的绝对路径被拒绝', async (t) => {
  const f = await fixture(t);
  await f.inScope('write', async () => {
    await assert.rejects(
      f.fileSystem.resolve(f.at(f.outside, 'secret.txt')),
      /不在可浏览的项目范围内/,
    );
    await assert.rejects(f.fileSystem.resolve('C:\\Windows\\win.ini'), /不在可浏览的项目范围内/);
    assert.equal(await exists(f.at(f.outside, 'secret.txt')), true);
  });
});

test('resolve：切换到别的盘符被拒绝', async (t) => {
  const f = await fixture(t);
  const home = f.root.slice(0, 2).toUpperCase();
  const other = home === 'C:' ? 'D:' : 'C:';
  if (!(await exists(`${other}\\`))) return t.skip(`${other}\\ 不存在，本机造不出盘符切换`);
  await f.inScope('write', async () => {
    await assert.rejects(
      f.fileSystem.resolve(`${other}\\zhixing-escape.txt`),
      /不在可浏览的项目范围内/,
    );
  });
});

test('resolve：工作区内的 junction 指向外面前被看穿', async (t) => {
  const f = await fixture(t);
  const link = f.at(f.root, 'link');
  try {
    await fs.symlink(f.outside, link, 'junction');
  } catch (error) {
    return t.skip(`本机不能创建 junction/junction：${error.code}`);
  }
  await f.inScope('write', async () => {
    // 目录 junction 先被 projectTarget 的「普通文件」判定挡下，文件 symlink 也一样；
    // 两种拒绝都说明外面的东西拿不进来。
    await assert.rejects(f.fileSystem.resolve('link'), /请选择项目内的普通文件/);
    await assert.rejects(f.fileSystem.resolve('link/secret.txt'), /不在可浏览的项目范围内/);

    // 文件级 symlink 要开发者模式或管理员权限，本机（和 CI 运行器一样）默认没有，
    // junction 只能指向目录，所以这一条在造不出来时明确跳过，不假装验过。
    try {
      await fs.symlink(f.at(f.outside, 'secret.txt'), f.at(f.root, '文件链接.txt'));
    } catch (error) {
      t.diagnostic(`跳过文件 symlink 用例：${error.code}`);
    }
    if (await exists(f.at(f.root, '文件链接.txt'))) {
      await assert.rejects(f.fileSystem.resolve('文件链接.txt'), /请选择项目内的普通文件/);
    }
    assert.equal(await fs.readFile(f.at(f.outside, 'secret.txt'), 'utf8'), OUTSIDE_BODY);
  });
});

test('resolve：私密清单里的文件与目录不能解析', async (t) => {
  const f = await fixture(t);
  const private_ = [
    '.env',
    '.env.local',
    'secret.pem',
    'private.key',
    'workspace.bin',
    'vaults/record.txt',
    '.git/config',
    'node_modules/pkg/index.js',
  ];
  await f.inScope('write', async () => {
    for (const name of private_) {
      await assert.rejects(
        f.fileSystem.resolve(name),
        /不在可(?:浏览|写入)的项目范围内/,
        `${name} 应当被私密清单拦住`,
      );
    }
    assert.equal(await exists(f.at(f.root, 'a.txt')), true);
  });
});

test('resolve：Windows 保留名与 ADS 被拒绝', async (t) => {
  const f = await fixture(t);
  await f.inScope('write', async () => {
    for (const name of [
      'CON',
      'con.txt',
      'NUL',
      'aux',
      'LPT1',
      'COM3.log',
      'a.txt:stream',
      'a.txt::$DATA',
    ]) {
      await assert.rejects(f.fileSystem.resolve(name), /保存文件名无效/, `${name} 应当被拒绝`);
    }
  });
});

test('resolve：末尾空格或点、以及通配字符被拒绝', async (t) => {
  const f = await fixture(t);
  await f.inScope('write', async () => {
    for (const name of [
      '报告.',
      '报告 ',
      'bad?.txt',
      'bad*.txt',
      'bad|name.txt',
      'bad<name>.txt',
    ]) {
      await assert.rejects(f.fileSystem.resolve(name), /保存文件名无效/, `${name} 应当被拒绝`);
    }
    assert.equal(await exists(f.at(f.root, '报告')), false);
  });
});

test('resolve：大小写不同的拼写指向同一个文件', async (t) => {
  const f = await fixture(t);
  await f.inScope('write', async () => {
    const lower = await f.fileSystem.resolve('a.txt');
    const upper = await f.fileSystem.resolve('A.TXT');
    assert.equal(upper.targetKey.toLowerCase(), lower.targetKey.toLowerCase());
    const mixed = await f.fileSystem.resolve(f.at(f.root, 'NOTES/README.MD'));
    const notes = await fs.realpath(f.at(f.root, 'notes/readme.md'));
    assert.equal(mixed.targetKey.toLowerCase(), notes.toLowerCase());
  });
});

// 切换工作目录时 resolve 走另一条分支：只对「已经在项目里」的请求做前后一致性校验，
// 项目外的路径照常解析（内核要用它校验自己的指令与技能文件）。真正的围栏在
// prepareNativeDirectory 里再用 workspaceTarget 判一次，这里只钉住分支口径。
test('resolve：切换工作目录的分支只校验项目内已存在的路径', async (t) => {
  const f = await fixture(t);
  const enterDirectory = (work) => f.handlers.get('working-directory/access')({}, work);
  await enterDirectory(async () => {
    const inside = await f.fileSystem.resolve('notes/readme.md');
    assert.equal(inside.targetKey, await fs.realpath(f.at(f.root, 'notes/readme.md')));

    const outside = await f.fileSystem.resolve('../escape.txt');
    assert.equal(outside.displayPath, path.resolve(f.root, '..', 'escape.txt'));
  });
});

test('checkReadTarget：工作区外的目标读不出来', async (t) => {
  const f = await fixture(t);
  await f.inScope('read', async () => {
    const target = await f.real(f.at(f.outside, 'secret.txt'));
    await assert.rejects(f.fileSystem.readText(target), /不在可浏览的项目范围内/);
    await assert.rejects(f.fileSystem.streamText(target), /不在可浏览的项目范围内/);
  });
});

test('checkReadTarget：私密文件即使在项目内也不能读', async (t) => {
  const f = await fixture(t);
  await f.inScope('read', async () => {
    for (const name of ['.env', 'secret.pem', 'private.key', 'vaults/record.txt']) {
      // 文件的私密清单命中「不在可写入」，私密目录命中的是「不在可浏览」。
      await assert.rejects(
        f.fileSystem.readText(await f.inside(name)),
        /不在可(?:浏览|写入)的项目范围内/,
        `${name} 应当拒绝读取`,
      );
    }
    assert.equal(await fs.readFile(f.at(f.root, '.env'), 'utf8'), FILES['.env']);
  });
});

test('checkReadTarget：缺失或在原地被换成链接时拒绝', async (t) => {
  const f = await fixture(t);
  await f.inScope('read', async () => {
    await assert.rejects(
      f.fileSystem.readText({
        displayPath: f.at(f.root, '缺失.txt'),
        targetKey: f.at(f.root, '缺失.txt'),
      }),
      /项目文件位置已变化/,
    );

    // 先当普通文件解析，再把同一个路径换成指向工作区外的链接。本机没有文件 symlink
    // 权限，所以换成目录 junction（lstat 同样报 symlink）。
    const target = await f.inside('a.txt');
    await fs.rm(f.at(f.root, 'a.txt'));
    await fs.symlink(f.outside, f.at(f.root, 'a.txt'), 'junction');
    await assert.rejects(f.fileSystem.readText(target), /请选择项目内的普通文件/);
    assert.equal(await fs.readFile(f.at(f.outside, 'secret.txt'), 'utf8'), OUTSIDE_BODY);
  });
});

// 目标身份里只有路径，没有 inode，所以「同一路径被换成另一个普通文件」读得到新内容。
// 危险的那种替换（换成链接）由上面的用例挡住，这条只把边界记清楚。
test('checkReadTarget：同一路径换成另一个普通文件时读到新内容', async (t) => {
  const f = await fixture(t);
  await f.inScope('read', async () => {
    const target = await f.inside('a.txt');
    await fs.rename(f.at(f.root, 'a.txt'), f.at(f.root, 'a.bak'));
    await fs.writeFile(f.at(f.root, 'a.txt'), '换过来的\n');
    assert.equal(await f.fileSystem.readText(target), '换过来的\n');
  });
});

test('checkReadTarget：大小写不同的拼写仍能读到同一个文件', async (t) => {
  const f = await fixture(t);
  await f.inScope('read', async () => {
    const target = await f.inside('a.txt');
    const spelled = { ...target, displayPath: f.at(f.root, 'A.TXT') };
    assert.equal(await f.fileSystem.readText(spelled), '第一行\n第二行\n');
  });
});

test('streamText：成功读到内容时也复检路径', async (t) => {
  const f = await fixture(t);
  await f.inScope('read', async () => {
    const chunks = [];
    for await (const chunk of await f.fileSystem.streamText(await f.inside('a.txt')))
      chunks.push(chunk);
    assert.equal(chunks.join(''), FILES['a.txt']);
  });
});

test('checkReadTarget：没有项目交办作用域时直接放行', async (t) => {
  const f = await fixture(t);
  const target = await f.real(f.at(f.outside, 'secret.txt'));
  assert.equal(await f.fileSystem.readText(target), OUTSIDE_BODY);
});

// read_image 之外的 readBytes 调用方原先直接落到父类读字节，不过读取围栏。
// 这里把「任何形态的 readBytes 都先过 checkReadTarget」钉死：非图片形态读工作区外
// 的普通文件必须被拒，工作区内的字节必须原样读回，read_image 形态同样被拒。
test('readBytes：非图片入口读工作区外被拒绝', async (t) => {
  const f = await fixture(t);
  await f.inScope('read', async () => {
    const target = await f.real(f.at(f.outside, 'secret.txt'));
    await assert.rejects(f.fileSystem.readBytes(target, undefined, 1024), /不在可浏览的项目范围内/);
  });
});

test('readBytes：非图片入口读工作区内的字节一致，私密文件仍被拒绝', async (t) => {
  const f = await fixture(t);
  await f.inScope('read', async () => {
    const bytes = await f.fileSystem.readBytes(await f.inside('a.txt'), undefined, 1024);
    assert.equal(Buffer.from(bytes).toString('utf8'), FILES['a.txt']);
    await assert.rejects(
      f.fileSystem.readBytes(await f.inside('.env'), undefined, 1024),
      /不在可(?:浏览|写入)的项目范围内/,
    );
  });
});

test('readBytes：read_image 形态读工作区外也被拒绝', async (t) => {
  const f = await fixture(t);
  await f.inScope('read_image', async () => {
    const target = await f.real(f.at(f.outside, 'secret.txt'));
    await assert.rejects(f.fileSystem.readBytes(target, undefined, 1024), /不在可浏览的项目范围内/);
  });
});

// 围栏挪到分岔之前，工作区内的 read_image 仍然先到视觉分支：缺服务时的文案不变。
test('readBytes：read_image 形态在工作区内缺服务时仍报同一句', async (t) => {
  const f = await fixture(t);
  const saved = [process.env.ZHIXING_OFFICE_VISION_URL, process.env.ZHIXING_OFFICE_VISION_TOKEN];
  delete process.env.ZHIXING_OFFICE_VISION_URL;
  delete process.env.ZHIXING_OFFICE_VISION_TOKEN;
  try {
    await f.inScope('read_image', async () => {
      await assert.rejects(
        f.fileSystem.readBytes(await f.inside('a.txt'), undefined, 1024),
        /当前会话缺少本机视觉处理服务。/,
      );
    });
  } finally {
    if (saved[0] !== undefined) process.env.ZHIXING_OFFICE_VISION_URL = saved[0];
    if (saved[1] !== undefined) process.env.ZHIXING_OFFICE_VISION_TOKEN = saved[1];
  }
});

test('writeText：新建文件逐字节一致', async (t) => {
  const f = await fixture(t);
  await f.inScope('write', async () => {
    const body = '中文正文\r\n第二行\n末尾没有换行';
    const target = { displayPath: f.at(f.root, '新建.txt'), targetKey: f.at(f.root, '新建.txt') };
    await f.fileSystem.writeText(target, body);
    assert.equal(await fs.readFile(f.at(f.root, '新建.txt'), 'utf8'), body);
    assert.deepEqual(await fs.readFile(f.at(f.root, '新建.txt')), Buffer.from(body, 'utf8'));
    assert.equal(f.calls.permit.length, 1);
    assert.equal(f.calls.permit[0].operation, '写入项目文本文件');
  });
});

test('writeText：覆盖已有文件后逐字节一致', async (t) => {
  const f = await fixture(t);
  await f.inScope('write', async () => {
    const target = await f.inside('a.txt');
    await f.fileSystem.writeText(target, '换掉了\n');
    assert.deepEqual(await fs.readFile(f.at(f.root, 'a.txt')), Buffer.from('换掉了\n', 'utf8'));
  });
});

test('writeText：工作区外的目标不能写', async (t) => {
  const f = await fixture(t);
  await f.inScope('write', async () => {
    await assert.rejects(
      f.fileSystem.writeText(
        { displayPath: f.at(f.outside, '新建.txt'), targetKey: f.at(f.outside, '新建.txt') },
        '越界\n',
      ),
      /不在可浏览的项目范围内/,
    );
    await assert.rejects(
      f.fileSystem.writeText(
        { displayPath: f.at(f.outside, 'secret.txt'), targetKey: f.at(f.outside, 'secret.txt') },
        '改掉外面的内容\n',
      ),
      /不在可浏览的项目范围内/,
    );
    assert.equal(await exists(f.at(f.outside, '新建.txt')), false);
    assert.equal(await fs.readFile(f.at(f.outside, 'secret.txt'), 'utf8'), OUTSIDE_BODY);
  });
});

test('writeText：私密路径不能写，原文件不动', async (t) => {
  const f = await fixture(t);
  await f.inScope('write', async () => {
    for (const name of ['.env', '.env.local', 'secret.pem', 'private.key']) {
      const target = await f.inside(name);
      await assert.rejects(
        f.fileSystem.writeText(target, 'PWNED\n'),
        /不在可写入的项目范围内/,
        `${name} 应当拒绝写入`,
      );
      assert.equal(await fs.readFile(f.at(f.root, name), 'utf8'), FILES[name]);
    }
  });
});

test('writeText：1 MiB 是硬上限', async (t) => {
  const f = await fixture(t);
  await f.inScope('write', async () => {
    const big = 'x'.repeat(MAX_WRITE_BYTES);
    await assert.rejects(
      f.fileSystem.writeText(
        { displayPath: f.at(f.root, 'big.txt'), targetKey: f.at(f.root, 'big.txt') },
        big,
      ),
      /1 MiB/,
    );
    assert.equal(await exists(f.at(f.root, 'big.txt')), false);

    const ok = 'z'.repeat(MAX_WRITE_BYTES - 1);
    await f.fileSystem.writeText(
      { displayPath: f.at(f.root, 'big.txt'), targetKey: f.at(f.root, 'big.txt') },
      ok,
    );
    assert.equal((await fs.stat(f.at(f.root, 'big.txt'))).size, MAX_WRITE_BYTES - 1);
  });
});

test('writeText：拒绝授权时不写盘', async (t) => {
  const f = await fixture(t, {
    permit: async () => {
      throw new Error('本次文件操作未获批准。');
    },
  });
  await f.inScope('write', async () => {
    await assert.rejects(
      f.fileSystem.writeText(
        { displayPath: f.at(f.root, '未批准.txt'), targetKey: f.at(f.root, '未批准.txt') },
        'x',
      ),
      /未获批准/,
    );
    assert.equal(await exists(f.at(f.root, '未批准.txt')), false);
  });
});

test('writeText：授权期间文件被换掉时拒绝写入', async (t) => {
  const f = await fixture(t, {
    permit: async ({ target }) => {
      // TOCTOU：授权期间把 a.txt 换成另一个普通文件，inode 变了。
      await fs.rm(target.target);
      await fs.writeFile(target.target, '被替换的内容\n');
    },
  });
  await f.inScope('write', async () => {
    const target = await f.inside('a.txt');
    await assert.rejects(f.fileSystem.writeText(target, '覆盖\n'), /项目文件位置已变化/);
    assert.equal(await fs.readFile(f.at(f.root, 'a.txt'), 'utf8'), '被替换的内容\n');
  });
});

test('writeText：写的是占位符还原后的正文', async (t) => {
  const f = await fixture(t, {
    restore: (value) =>
      typeof value === 'string' ? value.replaceAll('⟦ZX-1⟧', '13800000000') : value,
  });
  await f.inScope('write', async () => {
    await f.fileSystem.writeText(
      { displayPath: f.at(f.root, '联系.txt'), targetKey: f.at(f.root, '联系.txt') },
      '电话：⟦ZX-1⟧\n',
    );
    assert.equal(await fs.readFile(f.at(f.root, '联系.txt'), 'utf8'), '电话：13800000000\n');
    assert.ok(f.calls.protected.some((value) => String(value).includes('13800000000')));
  });
});

test('editText：替换后逐字节一致', async (t) => {
  const f = await fixture(t);
  await f.inScope('edit', async () => {
    const target = await f.inside('a.txt');
    await f.fileSystem.editText(target, { oldString: '第二行', newString: '第二行（改）' });
    assert.equal(await fs.readFile(f.at(f.root, 'a.txt'), 'utf8'), '第一行\n第二行（改）\n');
  });
});

test('editText：找不到原文与多处匹配都报结构化错误', async (t) => {
  const f = await fixture(t, { files: { 'twice.txt': '重复\n重复\n' } });
  await f.inScope('edit', async () => {
    const target = await f.inside('a.txt');
    await assert.rejects(f.fileSystem.editText(target, { oldString: '没有这行', newString: 'x' }), {
      code: 'FS_EDIT_NOT_FOUND',
    });

    const twice = await f.inside('twice.txt');
    await assert.rejects(f.fileSystem.editText(twice, { oldString: '重复', newString: '改过' }), {
      code: 'FS_AMBIGUOUS_EDIT',
    });
    await f.fileSystem.editText(twice, { oldString: '重复', newString: '改过', replaceAll: true });
    assert.equal(await fs.readFile(f.at(f.root, 'twice.txt'), 'utf8'), '改过\n改过\n');
  });
});

test('editText：编辑后涨到 1 MiB 以上被拒绝，文件不动', async (t) => {
  const body = 'a'.repeat(600 * 1024);
  const f = await fixture(t, { files: { 'big.txt': body } });
  await f.inScope('edit', async () => {
    const target = await f.inside('big.txt');
    await assert.rejects(
      f.fileSystem.editText(target, { oldString: 'a', newString: 'aa', replaceAll: true }),
      /编辑后的文本将超过 1 MiB/,
    );
    assert.equal((await fs.stat(f.at(f.root, 'big.txt'))).size, body.length);
  });
});

test('editText：越界与私密目标不能编辑', async (t) => {
  const f = await fixture(t);
  await f.inScope('edit', async () => {
    await assert.rejects(
      f.fileSystem.editText(
        { displayPath: f.at(f.outside, 'secret.txt'), targetKey: f.at(f.outside, 'secret.txt') },
        { oldString: '工作区外', newString: '改掉' },
      ),
      /不在可浏览的项目范围内/,
    );
    assert.equal(await fs.readFile(f.at(f.outside, 'secret.txt'), 'utf8'), OUTSIDE_BODY);

    const pem = await f.inside('secret.pem');
    await assert.rejects(
      f.fileSystem.editText(pem, { oldString: 'PEM', newString: 'PWNED' }),
      /不在可写入的项目范围内/,
    );
    assert.equal(await fs.readFile(f.at(f.root, 'secret.pem'), 'utf8'), 'PEM\n');
  });
});

test('editText：占位符还原之后再做字面匹配', async (t) => {
  const f = await fixture(t, {
    files: { '号.txt': '电话：13800000000\n' },
    restore: (value) =>
      typeof value === 'string' ? value.replaceAll('⟦ZX-1⟧', '13800000000') : value,
  });
  await f.inScope('edit', async () => {
    const target = await f.inside('号.txt');
    await f.fileSystem.editText(target, { oldString: '⟦ZX-1⟧', newString: '13900000000' });
    assert.equal(await fs.readFile(f.at(f.root, '号.txt'), 'utf8'), '电话：13900000000\n');
  });
});

test('patchText：批准之后按补丁写入', async (t) => {
  const f = await fixture(t);
  await f.inScope('apply_patch', async () => {
    const input = patch('*** Update File: a.txt', '@@', ' 第一行', '-第二行', '+第二行（改）');
    const restored = await (await load('harness/native-project-fs.mjs')).prepareNativePatch(input);
    const hunks = parsePatch(restored)[0].hunks;
    const target = await f.inside('a.txt');
    await f.fileSystem.patchText(target, hunks);
    assert.equal(await fs.readFile(f.at(f.root, 'a.txt'), 'utf8'), '第一行\n第二行（改）\n');
    assert.equal(f.calls.permit.length, 1);
  });
});

test('patchText：*** Add File 走 writeText 也要对得上批准的目标', async (t) => {
  const f = await fixture(t);
  await f.inScope('apply_patch', async () => {
    const module = await load('harness/native-project-fs.mjs');
    const input = patch('*** Add File: 月报.txt', '+一、本周进展', '+二、下周计划');
    await module.prepareNativePatch(input);
    const target = await f.fileSystem.resolve('月报.txt');
    await f.fileSystem.writeText(target, '一、本周进展\n二、下周计划\n');
    assert.equal(
      await fs.readFile(f.at(f.root, '月报.txt'), 'utf8'),
      '一、本周进展\n二、下周计划\n',
    );

    const unapproved = await f.fileSystem.resolve('没批准.txt');
    await assert.rejects(
      f.fileSystem.writeText(unapproved, 'x\n'),
      expectFsError('FS_STALE_VERSION'),
      '同一次补丁里没出现的目标不能顺手写进去',
    );
    assert.equal(await exists(f.at(f.root, '没批准.txt')), false);
  });
});

test('patchText：同一补丁里大小写不同的同一个文件被拒绝', async (t) => {
  const f = await fixture(t);
  await f.inScope('apply_patch', async () => {
    const module = await load('harness/native-project-fs.mjs');
    const input = patch(
      '*** Update File: a.txt',
      '@@',
      '-第二行',
      '+第二行（改）',
      '*** Update File: A.TXT',
      '@@',
      '-第一行',
      '+第一行（改）',
    );
    await assert.rejects(module.prepareNativePatch(input), /同一次补丁不能对同一文件执行两次操作/);
    assert.equal(await fs.readFile(f.at(f.root, 'a.txt'), 'utf8'), FILES['a.txt']);
  });
});

test('patchText：批准后目标消失时报 FS_STALE_VERSION', async (t) => {
  const f = await fixture(t);
  await f.inScope('apply_patch', async () => {
    const module = await load('harness/native-project-fs.mjs');
    const input = patch('*** Update File: a.txt', '@@', '-第二行', '+第二行（改）');
    const restored = await module.prepareNativePatch(input);
    const hunks = parsePatch(restored)[0].hunks;
    const target = await f.inside('a.txt');
    await fs.rm(f.at(f.root, 'a.txt'));
    await assert.rejects(f.fileSystem.patchText(target, hunks), expectFsError('FS_STALE_VERSION'));
    assert.equal(await exists(f.at(f.root, 'a.txt')), false);
  });
});

test('patchText：私密文件进不了补丁', async (t) => {
  const f = await fixture(t);
  await f.inScope('apply_patch', async () => {
    const module = await load('harness/native-project-fs.mjs');
    for (const input of [
      patch('*** Add File: .env', '+SECRET=2'),
      patch('*** Update File: secret.pem', '@@', '-PEM', '+PWNED'),
      patch('*** Delete File: vaults/record.txt'),
    ]) {
      await assert.rejects(
        module.prepareNativePatch(input),
        /不在可(?:浏览|写入)的项目范围内/,
        input,
      );
    }
    assert.equal(await fs.readFile(f.at(f.root, '.env'), 'utf8'), FILES['.env']);
    assert.equal(await fs.readFile(f.at(f.root, 'secret.pem'), 'utf8'), FILES['secret.pem']);
    assert.equal(await exists(f.at(f.root, 'vaults/record.txt')), true);
  });
});

test('patchText：补丁结果涨到 1 MiB 以上被拒绝', async (t) => {
  // 补丁文本本身有 128 KiB 上限，所以先把正文顶到离 1 MiB 差几 KB，再补一小段。
  const lines = [];
  let size = 0;
  while (size < MAX_WRITE_BYTES - 8000) {
    const text = `第${String(lines.length).padStart(4, '0')}行${'x'.repeat(1000)}`;
    lines.push(text);
    size += Buffer.byteLength(text) + 1;
  }
  const body = `${lines.join('\n')}\n`;
  const f = await fixture(t, { files: { 'big.txt': body } });
  await f.inScope('apply_patch', async () => {
    const module = await load('harness/native-project-fs.mjs');
    const added = Array.from({ length: 40 }, () => `+${'y'.repeat(300)}`);
    const input = patch('*** Update File: big.txt', '@@', ` ${lines.at(-1)}`, ...added);
    const restored = await module.prepareNativePatch(input);
    const hunks = parsePatch(restored)[0].hunks;
    const target = await f.inside('big.txt');
    await assert.rejects(f.fileSystem.patchText(target, hunks), expectFsError('FS_TOO_LARGE'));
    assert.equal((await fs.stat(f.at(f.root, 'big.txt'))).size, Buffer.byteLength(body));
  });
});

function expectFsError(code) {
  return (error) => {
    assert.equal(error.code, code);
    return true;
  };
}
