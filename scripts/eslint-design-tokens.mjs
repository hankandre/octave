// The `octave/design-tokens` ESLint rule (T3-06 item 2): app code takes every colour, size, radius, duration and font
// from apps/tv/src/design/, so it reports a hard-coded one. Each message ends with the token group to use.
// Allowed: 0, keys that are not sizes (flex, opacity, zIndex, aspectRatio), percentage strings, and literals as
// operands of `*` or `/` (`posterW * 1.5`), and the size keys of an image request object (one with `imageType`).
// `px(0)` is allowed because "0 is allowed" wins over "any literal in px()".

const COLOUR_FUNCTION = /^\s*(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\(|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch)\(/i;
const HEX_COLOUR = /^\s*#(?:[0-9a-f]{8}|[0-9a-f]{6}|[0-9a-f]{3,4})\s*$/i;
const COLOUR_KEY = /color$/i;
const SIZE_KEY = /^(?:width|height|top|right|bottom|left|start|end|gap|rowGap|columnGap|outlineWidth|outlineOffset|fontSize|lineHeight|letterSpacing|shadowRadius|elevation|translateX|translateY)$|^(?:min|max)[A-Z]|^inset|^margin|^padding|^border\w*Width$|Radius$/;
const SCALE_KEY = /^scale[XY]?$/;
const DURATION_KEY = /^(?:duration|delay)$/;

const messages = {
  colour: "Hard-coded colour. Use a token from `colors` or `artDefaults` in apps/tv/src/design/tokens.ts.",
  size: "Hard-coded size. Use a token from `space`, `sizes`, `radii` or `focus` through `px()`, or a type token through `textStyle()`.",
  scale: "Hard-coded scale. Use `motion.lift` or `motion.pressScale`.",
  duration: "Hard-coded duration. Use a token from `motion` (`durInstant`, `durQuick`, `durBase`, `durSlow`, `skeletonDelayMs` and the rest).",
  font: "Do not import `expo-font`. The fonts are bundled at build time; use `textStyle()` and the `faces` tokens.",
};

const keyName = (property) => {
  if (property.computed) return undefined;
  if (property.key.type === "Identifier") return property.key.name;
  if (property.key.type === "Literal" && typeof property.key.value === "string") return property.key.value;
  return undefined;
};

/** The expressions a value can take a literal through: itself, a ternary's branches, a `+` or `-` operand. */
function* operands(node) {
  switch (node.type) {
    case "ConditionalExpression":
      yield* operands(node.consequent);
      yield* operands(node.alternate);
      break;
    case "LogicalExpression":
      yield* operands(node.left);
      yield* operands(node.right);
      break;
    case "BinaryExpression":
      if (node.operator === "+" || node.operator === "-") {
        yield* operands(node.left);
        yield* operands(node.right);
      }
      break;
    case "UnaryExpression":
      if (node.operator === "-" || node.operator === "+") {
        if (node.argument.type === "Literal") yield node;
        else yield* operands(node.argument);
      }
      break;
    case "TSAsExpression":
    case "TSNonNullExpression":
    case "TSSatisfiesExpression":
      yield* operands(node.expression);
      break;
    default:
      yield node;
  }
}

const numberOf = (node) => {
  if (node.type === "Literal" && typeof node.value === "number") return node.value;
  if (node.type === "UnaryExpression" && node.argument.type === "Literal" && typeof node.argument.value === "number") {
    return node.operator === "-" ? -node.argument.value : node.argument.value;
  }
  return undefined;
};

/** An image request (`imageType` beside item, tag and size) holds request pixels, which are not layout (T3-04's sample). */
const isImageRequest = (object) => object.properties.some((property) => property.type === "Property" && keyName(property) === "imageType");

export const rule = {
  meta: { type: "problem", schema: [], messages },
  create(context) {
    const reported = new Set();
    const report = (node, messageId) => {
      if (reported.has(node)) return;
      reported.add(node);
      context.report({ node, messageId });
    };

    const checkNumbers = (valueNode, messageId, allowed = [0]) => {
      for (const operand of operands(valueNode)) {
        const value = numberOf(operand);
        if (value !== undefined && !allowed.includes(value)) report(operand, messageId);
      }
    };

    const checkColourString = (valueNode) => {
      for (const operand of operands(valueNode)) {
        if (operand.type === "Literal" && typeof operand.value === "string") report(operand, "colour");
        if (operand.type === "TemplateLiteral") report(operand, "colour");
      }
    };

    const colourText = (text) => HEX_COLOUR.test(text) || COLOUR_FUNCTION.test(text);

    const isFont = (source) => source === "expo-font" || source.startsWith("expo-font/");

    return {
      Literal(node) {
        if (typeof node.value === "string" && colourText(node.value)) report(node, "colour");
      },
      TemplateElement(node) {
        const text = node.value.cooked ?? node.value.raw;
        if (colourText(text)) report(node, "colour");
      },
      Property(node) {
        if (node.parent.type !== "ObjectExpression") return;
        const name = keyName(node);
        if (name === undefined) return;
        const value = node.value;
        if (COLOUR_KEY.test(name)) checkColourString(value);
        if (SIZE_KEY.test(name)) {
          if (!isImageRequest(node.parent)) checkNumbers(value, "size");
        }
        else if (SCALE_KEY.test(name)) checkNumbers(value, "scale", [0, 1]);
        else if (DURATION_KEY.test(name)) checkNumbers(value, "duration");
      },
      JSXAttribute(node) {
        if (node.name.type !== "JSXIdentifier" || !node.value) return;
        const name = node.name.name;
        const value = node.value.type === "JSXExpressionContainer" ? node.value.expression : node.value;
        if (value.type === "JSXEmptyExpression") return;
        if (COLOUR_KEY.test(name)) checkColourString(value);
        if (name.startsWith("delay")) checkNumbers(value, "duration");
      },
      CallExpression(node) {
        const callee = node.callee;
        if (callee.type === "Identifier") {
          if (callee.name === "px" && node.arguments[0]) checkNumbers(node.arguments[0], "size");
          if ((callee.name === "setTimeout" || callee.name === "setInterval") && node.arguments[1]) checkNumbers(node.arguments[1], "duration");
          if (callee.name === "require" && node.arguments[0]?.type === "Literal" && typeof node.arguments[0].value === "string" && isFont(node.arguments[0].value)) {
            report(node, "font");
          }
        }
      },
      ImportDeclaration(node) {
        if (isFont(String(node.source.value))) report(node, "font");
      },
      ImportExpression(node) {
        if (node.source.type === "Literal" && isFont(String(node.source.value))) report(node, "font");
      },
    };
  },
};

export default { rules: { "design-tokens": rule } };
