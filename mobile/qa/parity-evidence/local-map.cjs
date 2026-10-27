// Local rendering fixtures only; mobile web maps use Google when a key is set.
// CI/harness runs without keys and should show the manual-address fallback without
// contacting map CDNs.
exports.installLocalMap = async function (_context) {
  /* no-op */
};
