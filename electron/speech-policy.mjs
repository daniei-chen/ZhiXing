const APP_PAGE = 'zhixing://app/index.html';

export function permitsSpeechCapture({ permission, isMainWindow, armed, details = {} }) {
  if (permission !== 'media' || !isMainWindow || !armed || details.isMainFrame !== true || details.requestingUrl !== APP_PAGE) return false;
  if (Array.isArray(details.mediaTypes)) return details.mediaTypes.length === 1 && details.mediaTypes[0] === 'audio';
  return details.mediaType === 'audio';
}
