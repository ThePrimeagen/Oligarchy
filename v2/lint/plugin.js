// Oligarchy's own lint rules. The root .oxlintrc.json loads this file for v2/**. Plain JavaScript:
// oxlint runs plugins under Node, and Node before 22.18 cannot strip TypeScript.

// A package's name ("@oligarchy/app"), or its src/main.ts from inside it. An augmentation through
// any other file lands on a separate declaration, and the list and the addition stop seeing each
// other.
const throughEntry = (specifier) =>
  specifier.startsWith(".")
    ? specifier.endsWith("/src/main.ts")
    : /^(@[^/]+\/)?[^/]+$/.test(specifier);

export default {
  meta: { name: "oligarchy" },
  rules: {
    "augment-through-entry": {
      meta: {
        type: "problem",
        docs: { description: "A module augmentation names the package's entry" },
        messages: {
          entry:
            "augment {{ specifier }} through its package's entry: the package name, or src/main.ts inside the package",
        },
      },
      create(context) {
        return {
          TSModuleDeclaration(node) {
            if (node.id.type !== "Literal" || typeof node.id.value !== "string") {
              return;
            }
            if (!throughEntry(node.id.value)) {
              context.report({
                node: node.id,
                messageId: "entry",
                data: { specifier: node.id.value },
              });
            }
          },
        };
      },
    },
  },
};
