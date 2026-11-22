// The class field `declare readonly status?` in the core's TransportError (packages/core/src/ports/transport.ts) has no
// runtime effect, as TypeScript emits nothing for it. babel-preset-expo 58 runs Flow's type stripping on every file
// with allowDeclareFields fixed to false, which refuses that field (T3-05 bundles the adapter that imports it). So this
// plugin, which runs before the preset's, removes `declare` fields from TypeScript classes first.
function stripDeclareFields() {
  return {
    name: "octave-strip-declare-fields",
    visitor: {
      Class(path) {
        if (!/\.tsx?$/.test(this.filename ?? "")) return;
        for (const member of path.get("body.body")) {
          if ((member.isClassProperty() || member.isClassPrivateProperty()) && member.node.declare) member.remove();
        }
      },
    },
  };
}

module.exports = function (api) {
  api.cache(true);
  return { presets: ["babel-preset-expo"], plugins: [stripDeclareFields] };
};
