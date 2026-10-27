// Local rendering fixtures only; use real Leaflet code, never contact tile/CDN servers.
const fs = require("node:fs");
const path = require("node:path");
exports.installLocalMap = async function (context) {
  const dist = path.resolve(__dirname, "../../../node_modules/leaflet/dist");
  await context.route("https://unpkg.com/leaflet@1.9.4/dist/*", (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop();
    if (!["leaflet.js", "leaflet.css"].includes(file)) return route.abort();
    return route.fulfill({
      contentType: file.endsWith("js") ? "text/javascript" : "text/css",
      headers: { "access-control-allow-origin": "*" },
      body: fs.readFileSync(path.join(dist, file)),
    });
  });
  await context.route("https://*.tile.openstreetmap.org/**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=",
        "base64",
      ),
    }),
  );
};
