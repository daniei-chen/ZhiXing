const RELEASES_URL = 'https://api.github.com/repos/daniei-chen/ZhiXing/releases?per_page=100';
const RELEASE_PAGE = 'https://github.com/daniei-chen/ZhiXing/releases/tag/';
const VERSION_PATTERN = /^(?:v)?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

function parseVersion(value) {
  if (typeof value !== 'string' || value.length > 80) return null;
  const match = VERSION_PATTERN.exec(value);
  if (!match) return null;

  const prerelease = match[4]?.split('.') || [];
  if (prerelease.some(part => !part || (/^\d+$/.test(part) && part.length > 1 && part.startsWith('0')))) return null;
  return {major: BigInt(match[1]), minor: BigInt(match[2]), patch: BigInt(match[3]), prerelease};
}

export function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  if (!a || !b) throw new Error('版本号格式无效。');

  for (const field of ['major', 'minor', 'patch']) {
    if (a[field] !== b[field]) return a[field] > b[field] ? 1 : -1;
  }

  if (!a.prerelease.length || !b.prerelease.length) {
    if (a.prerelease.length === b.prerelease.length) return 0;
    return a.prerelease.length ? -1 : 1;
  }

  for (let index = 0; index < Math.max(a.prerelease.length, b.prerelease.length); index++) {
    const leftPart = a.prerelease[index];
    const rightPart = b.prerelease[index];
    if (leftPart === undefined) return -1;
    if (rightPart === undefined) return 1;
    if (leftPart === rightPart) continue;

    const leftNumeric = /^\d+$/.test(leftPart);
    const rightNumeric = /^\d+$/.test(rightPart);
    if (leftNumeric && rightNumeric) return BigInt(leftPart) > BigInt(rightPart) ? 1 : -1;
    if (leftNumeric !== rightNumeric) return leftNumeric ? -1 : 1;
    return leftPart > rightPart ? 1 : -1;
  }
  return 0;
}

function normaliseRelease(release) {
  if (!release || release.draft || typeof release.tag_name !== 'string') return null;
  const version = release.tag_name.replace(/^v/, '');
  if (!parseVersion(release.tag_name)) return null;

  return {
    tag: release.tag_name,
    version,
    name: typeof release.name === 'string' && release.name.trim() ? release.name.trim().slice(0, 160) : release.tag_name,
    publishedAt: typeof release.published_at === 'string' && Number.isFinite(Date.parse(release.published_at)) ? release.published_at : null,
    prerelease: Boolean(release.prerelease),
    hasWindowsInstaller: Array.isArray(release.assets) && release.assets.some(asset => asset?.name === `知行-${version}-x64.exe`),
  };
}

export async function checkDesktopRelease(currentVersion, fetchImpl = fetch) {
  if (!parseVersion(currentVersion)) throw new Error('本机应用版本号无效。');

  const response = await fetchImpl(RELEASES_URL, {
    signal: AbortSignal.timeout(15000),
    headers: {accept: 'application/vnd.github+json', 'user-agent': 'ZhiXing-Desktop-Update-Check'},
  });
  if (!response.ok) throw new Error('暂时无法读取 GitHub 发行信息。');

  const releases = await response.json();
  if (!Array.isArray(releases)) throw new Error('GitHub 发行信息格式无效。');
  const latest = releases.map(normaliseRelease).filter(Boolean).reduce((best, release) => {
    if (!best || compareVersions(release.version, best.version) > 0) return release;
    return best;
  }, null);

  return {
    currentVersion,
    latest,
    updateAvailable: Boolean(latest && compareVersions(latest.version, currentVersion) > 0),
    checkedAt: new Date().toISOString(),
  };
}

export function officialReleaseUrl(tag) {
  if (!parseVersion(tag)) throw new Error('发行版本号无效。');
  return `${RELEASE_PAGE}${encodeURIComponent(tag)}`;
}
