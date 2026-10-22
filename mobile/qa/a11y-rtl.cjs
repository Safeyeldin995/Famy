const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

const root = path.resolve(__dirname, "../src");
const touchables = new Set([
  "Pressable",
  "TouchableOpacity",
  "TouchableHighlight",
  "TouchableWithoutFeedback",
  "TouchableNativeFeedback",
]);
const files = [];
function visitDirectory(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) visitDirectory(file);
    else if (entry.name.endsWith(".tsx")) files.push(file);
  }
}
visitDirectory(root);

let controls = 0;
for (const file of files) {
  const relative = path.relative(root, file).replaceAll("\\", "/");
  if (relative === "app/login.tsx" || /app\/(?:auth|sign-up|signup|otp)\//.test(relative)) {
    continue;
  }
  const source = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node) {
    if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
      const tag = node.tagName.getText(ast);
      if (touchables.has(tag)) {
        controls++;
        const attributes = new Set(
          node.attributes.properties.map((item) => item.name?.getText(ast)),
        );
        const line = ast.getLineAndCharacterOfPosition(node.getStart(ast)).line + 1;
        for (const attribute of ["accessibilityRole", "accessibilityLabel"]) {
          assert(
            attributes.has(attribute),
            `${path.relative(root, file)}:${line}: missing ${attribute}`,
          );
        }
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(ast);
  assert(
    !/allowFontScaling\s*=\s*\{false\}/.test(source),
    `${path.relative(root, file)} disables font scaling`,
  );
  assert(
    !/\b(?:marginLeft|marginRight|paddingLeft|paddingRight|borderBottomLeftRadius|borderBottomRightRadius|borderTopLeftRadius|borderTopRightRadius|left|right)\s*:/.test(
      source,
    ),
    `${path.relative(root, file)} has a physical left/right style`,
  );
}

const theme = fs.readFileSync(path.join(root, "ui/theme.ts"), "utf8");
const color = (name) => {
  const match = theme.match(new RegExp(`\\b${name}: "(#[0-9A-Fa-f]{6})"`));
  assert(match, `missing ${name} color token`);
  return match[1];
};
const luminance = (hex) => {
  const [red, green, blue] = hex
    .slice(1)
    .match(/../g)
    .map((channel) => {
      const value = parseInt(channel, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};
const contrast = (foreground, background) => {
  const values = [luminance(color(foreground)), luminance(color(background))].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
};
assert.equal(color("brand"), "#F10E72", "approved brand color must remain unchanged");
for (const [foreground, background] of [
  ["brandText", "surface"],
  ["brandText", "brandTint"],
  ["muted", "surface"],
  ["muted", "background"],
]) {
  assert(contrast(foreground, background) >= 4.5, `${foreground} on ${background} fails AA`);
}
assert(contrast("brandForeground", "brand") >= 3, "large white text on brand fails AA");
const helper = fs.readFileSync(path.join(root, "ui/a11y.ts"), "utf8");
const compiled = ts.transpileModule(helper, {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText;
const moduleForTest = { exports: {} };
vm.runInNewContext(compiled, { module: moduleForTest, exports: moduleForTest.exports });
const textSource = fs.readFileSync(path.join(root, "ui/Text.tsx"), "utf8");
assert(
  /maxFontSizeMultiplier/.test(textSource),
  "Text.tsx must cap accessibility font scaling",
);
const {
  scaledTabBarHeight,
  maxFontSizeMultiplierForText,
  BODY_FONT_SCALE_CAP,
  COMPACT_FONT_SCALE_CAP,
} = moduleForTest.exports;
assert.equal(maxFontSizeMultiplierForText({ size: "md" }), BODY_FONT_SCALE_CAP);
assert.equal(maxFontSizeMultiplierForText({ size: "hero" }), COMPACT_FONT_SCALE_CAP);
assert.equal(maxFontSizeMultiplierForText({ size: "md", weight: "heavy" }), COMPACT_FONT_SCALE_CAP);
for (const scale of [1, 1.3, 2, 3]) {
  for (const lineHeight of [18, 22]) {
    const height = scaledTabBarHeight(scale, lineHeight, 12);
    const lines = scale > 1.3 ? 2 : 1;
    assert(height >= 44 + lines * lineHeight * scale + 12 + 12);
  }
}
console.log(
  `PASS: ${controls} touchables have roles and labels; RTL, AA, font-scale caps, and 1–3x tab-height checks passed.`,
);
