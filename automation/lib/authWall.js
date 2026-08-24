function isAuthWall({ url, hasSelector }, platformConfig) {
  const { authWallUrlContains = [], authWallSelectors = [] } = platformConfig;
  if (authWallUrlContains.length === 0 && authWallSelectors.length === 0) return false;

  const urlMatch = authWallUrlContains.some((fragment) => url.includes(fragment));
  if (urlMatch) return true;

  return authWallSelectors.some((selector) => hasSelector(selector));
}

module.exports = { isAuthWall };
