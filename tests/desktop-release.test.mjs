import test from 'node:test';
import assert from 'node:assert/strict';
import {checkDesktopRelease, compareVersions, officialReleaseUrl} from '../electron/desktop-release.mjs';

test('知行桌面版本按 SemVer 顺序比较', () => {
  assert.equal(compareVersions('0.11.0-preview.2', '0.11.0-preview.10'), -1);
  assert.equal(compareVersions('0.11.0-preview.10', '0.11.0'), -1);
  assert.equal(compareVersions('0.12.0-rc.1', '0.11.9'), 1);
  assert.equal(compareVersions('v0.11.0', '0.11.0+build.5'), 0);
  assert.throws(() => compareVersions('0.11', '0.11.0'), /版本号格式无效/);
});

test('发行检查选择最新兼容标签并准确识别 Windows 安装包', async () => {
  let requestedUrl;
  const releases = [
    {tag_name: 'v0.12.0-rc.2', name: '知行测试版', prerelease: true, published_at: '2026-11-21T00:00:00Z', assets: [{name: '知行-0.12.0-rc.2-x64.exe'}]},
    {tag_name: 'v0.12.0-rc.1', name: '旧测试版', assets: [{name: '知行-0.12.0-rc.1-x64.exe'}]},
    {tag_name: 'release-notes', name: '无效标签', assets: [{name: '知行-0.99.0-x64.exe'}]},
    {tag_name: 'v99.0.0', name: '草稿', draft: true, assets: [{name: '知行-99.0.0-x64.exe'}]},
  ];
  const result = await checkDesktopRelease('0.11.0', async (url, options) => {
    requestedUrl = url;
    assert.equal(options.headers['user-agent'], 'ZhiXing-Desktop-Update-Check');
    return {ok: true, json: async () => releases};
  });

  assert.equal(requestedUrl, 'https://api.github.com/repos/daniei-chen/ZhiXing/releases?per_page=100');
  assert.equal(result.latest.tag, 'v0.12.0-rc.2');
  assert.equal(result.latest.hasWindowsInstaller, true);
  assert.equal(result.updateAvailable, true);
  assert.equal(result.currentVersion, '0.11.0');
  assert.ok(Number.isFinite(Date.parse(result.checkedAt)));
});

test('没有比本机更新的发行版时不误报更新', async () => {
  const result = await checkDesktopRelease('0.11.0', async () => ({
    ok: true,
    json: async () => [{tag_name: 'v0.11.0-preview.1', name: '预览版', assets: []}],
  }));

  assert.equal(result.updateAvailable, false);
  assert.equal(result.latest.hasWindowsInstaller, false);
});

test('发行页始终指向知行仓库且拒绝不合法标签', () => {
  assert.equal(officialReleaseUrl('v0.12.0-rc.2'), 'https://github.com/daniei-chen/ZhiXing/releases/tag/v0.12.0-rc.2');
  assert.throws(() => officialReleaseUrl('https://example.com'), /发行版本号无效/);
});

test('GitHub 不可用或返回无效数据时明确失败', async () => {
  await assert.rejects(checkDesktopRelease('0.11.0', async () => ({ok: false})), /暂时无法读取 GitHub/);
  await assert.rejects(checkDesktopRelease('0.11.0', async () => ({ok: true, json: async () => ({tag_name: 'v1.0.0'})})), /发行信息格式无效/);
});
