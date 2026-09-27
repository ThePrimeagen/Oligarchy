// Oligarchy's own lint rules. The root .oxlintrc.json loads this file for v2/**. Plain JavaScript:
// oxlint runs plugins under Node, and Node before 22.18 cannot strip TypeScript.
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const packageRoot = (file) => {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    if (existsSync(join(dir, "package.json"))) {
      return dir;
    }
  }
  return undefined;
};

// A package's name ("@oligarchy/app"), or a relative path to the declaring package's own
// src/main.ts. An augmentation through any other file lands on a separate declaration, and the
// list and the addition stop seeing each other.
const throughEntry = (specifier, file) => {
  if (!specifier.startsWith(".")) {
    return /^(@[^/]+\/)?[^/]+$/.test(specifier);
  }
  const root = packageRoot(file);
  return root !== undefined && resolve(dirname(file), specifier) === join(root, "src/main.ts");
};

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
            if (!throughEntry(node.id.value, context.filename)) {
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
