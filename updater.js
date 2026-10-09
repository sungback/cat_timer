// updater.js — KFF updater.py의 Electron판. "확인만" 담당한다.
// 다운로드·설치는 하지 않는다. 새 버전이면 main.js가 팝업/배너로 알리고,
// 사용자 승인 후에만 selfupdate.js로 넘긴다.
const REPO = 'sungback/cat_timer';
const MAC_ZIP = 'CatTimer-macOS.zip';
const WIN_EXE = 'CatTimer-Windows-Portable.exe';

const LATEST_API = `https://api.github.com/repos/${REPO}/releases/latest`;
const CHECK_TIMEOUT_MS = 10000;

function parseVersion(tag) {
  const cleaned = String(tag || '').trim().replace(/^[vV]/, '');
  if (!cleaned) return [];
  const parts = [];
  for (const p of cleaned.split('.')) {
    if (!/^\d+$/.test(p)) return [];
    parts.push(Number(p));
  }
  return parts;
}

function isNewer(latest, current) {
  const a = parseVersion(latest), b = parseVersion(current);
  if (!a.length || !b.length) return false;
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) {
    if ((a[i] || 0) !== (b[i] || 0)) return (a[i] || 0) > (b[i] || 0);
  }
  return false;
}

// 특정 태그의 에셋 URL. 파일명은 버전 없이 고정, 태그가 버전을 구분한다.
// (KFF release_asset_url과 동일 규칙)
function assetUrl(tag, asset) {
  return `https://github.com/${REPO}/releases/download/${tag}/${asset}`;
}

async function fetchLatest(timeoutMs = CHECK_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(LATEST_API, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': 'CatTimer-updater' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!data || !data.tag_name) return null;
    return { tag: data.tag_name, html_url: data.html_url || '', assets: data.assets || [] };
  } catch {
    return null; // 오프라인·rate limit·파싱 오류 모두 조용히 스킵
  } finally {
    clearTimeout(t);
  }
}

function findAssetDownloadUrl(release, name) {
  const hit = (release.assets || []).find((a) => a.name === name);
  return hit ? hit.browser_download_url : null;
}

async function fetchText(url, timeoutMs = CHECK_TIMEOUT_MS) {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      if (!res.ok) return null;
      return await res.text();
    } finally {
      clearTimeout(t);
    }
  } catch {
    return null;
  }
}

module.exports = {
  REPO, MAC_ZIP, WIN_EXE,
  parseVersion, isNewer, assetUrl,
  fetchLatest, findAssetDownloadUrl, fetchText,
};
