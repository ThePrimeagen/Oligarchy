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

// The local name of `import * as jarl from "jarl"`, type-only or not.
const jarlName = (program) => {
  for (const statement of program.body) {
    if (statement.type !== "ImportDeclaration" || statement.source.value !== "jarl") {
      continue;
    }
    for (const specifier of statement.specifiers) {
      if (specifier.type === "ImportNamespaceSpecifier") {
        return specifier.local.name;
      }
    }
  }
  return undefined;
};

const variableOf = (context, identifier) => {
  for (let scope = context.sourceCode.getScope(identifier); scope; scope = scope.upper) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) {
      return variable;
    }
  }
  return undefined;
};

const isMember = (node, object, property) =>
  node.type === "MemberExpression" &&
  !node.computed &&
  node.object.type === "Identifier" &&
  node.object.name === object &&
  node.property.name === property;

// Which jarl check a call is: "is_ok", "is_err" or "error.is", or undefined.
const jarlCheck = (call, jarl) => {
  if (call.type !== "CallExpression" || jarl === undefined) {
    return undefined;
  }
  const { callee } = call;
  if (isMember(callee, jarl, "is_ok") || isMember(callee, jarl, "is_err")) {
    return callee.property.name;
  }
  if (
    callee.type === "MemberExpression" &&
    !callee.computed &&
    callee.property.name === "is" &&
    isMember(callee.object, jarl, "error")
  ) {
    return "error.is";
  }
  return undefined;
};

const JARL_TAKES_A_RESULT = new Set(["value", "unwrap", "is_ok", "is_err"]);
const JARL_MAKES_A_RESULT = new Set(["ok", "err", "parseJSON"]);

const annotatedResult = (annotation, jarl) => {
  const type = annotation?.typeAnnotation;
  return (
    type?.type === "TSTypeReference" &&
    type.typeName.type === "TSQualifiedName" &&
    type.typeName.left.type === "Identifier" &&
    type.typeName.left.name === jarl &&
    type.typeName.right.name === "Result"
  );
};

const callsJarl = (node, jarl, names) => {
  const call = node?.type === "AwaitExpression" ? node.argument : node;
  return (
    call?.type === "CallExpression" &&
    call.callee.type === "MemberExpression" &&
    !call.callee.computed &&
    call.callee.object.type === "Identifier" &&
    call.callee.object.name === jarl &&
    names.has(call.callee.property.name)
  );
};

// No types reach a JS plugin, so a binding is a result by how it is written: declared a
// jarl.Result or made by jarl, its `ok` read, handed to jarl, or its `error` handed to a jarl
// check.
const isResult = (variable, jarl) => {
  if (variable.defs.some((def) => def.type === "ImportBinding")) {
    return false;
  }
  if (jarl === undefined) {
    return variable.references.some(({ identifier }) =>
      isMember(identifier.parent, identifier.name, "ok"),
    );
  }
  for (const def of variable.defs) {
    if (annotatedResult(def.name.typeAnnotation, jarl)) {
      return true;
    }
    if (
      def.node.type === "VariableDeclarator" &&
      def.node.id === def.name &&
      callsJarl(def.node.init, jarl, JARL_MAKES_A_RESULT)
    ) {
      return true;
    }
  }
  return variable.references.some(({ identifier }) => {
    const { parent } = identifier;
    if (isMember(parent, identifier.name, "ok")) {
      return true;
    }
    if (isMember(parent, identifier.name, "error") && parent.parent.arguments?.[0] === parent) {
      return jarlCheck(parent.parent, jarl) !== undefined;
    }
    if (parent.type !== "CallExpression" || parent.arguments[0] !== identifier) {
      return false;
    }
    return jarlCheck(parent, jarl) !== undefined || callsJarl(parent, jarl, JARL_TAKES_A_RESULT);
  });
};

const checks = (context, jarl, test, variable) => {
  const check = jarlCheck(test, jarl);
  const argument = test.arguments?.[0];
  if (check === undefined || argument?.type !== "Identifier") {
    return undefined;
  }
  return variableOf(context, argument) === variable ? check : undefined;
};

// Whether test being true means variable holds an error.
const failedIfTrue = (context, jarl, test, variable) => {
  if (test.type === "UnaryExpression" && test.operator === "!") {
    return failedIfFalse(context, jarl, test.argument, variable);
  }
  if (test.type === "LogicalExpression" && test.operator === "&&") {
    return (
      failedIfTrue(context, jarl, test.left, variable) ||
      failedIfTrue(context, jarl, test.right, variable)
    );
  }
  const check = checks(context, jarl, test, variable);
  return check === "is_err" || check === "error.is";
};

// Whether test being false means variable holds an error.
const failedIfFalse = (context, jarl, test, variable) => {
  if (test.type === "UnaryExpression" && test.operator === "!") {
    return failedIfTrue(context, jarl, test.argument, variable);
  }
  if (test.type === "LogicalExpression" && test.operator === "||") {
    return (
      failedIfFalse(context, jarl, test.left, variable) ||
      failedIfFalse(context, jarl, test.right, variable)
    );
  }
  return checks(context, jarl, test, variable) === "is_ok";
};

const isProcessExit = (statement) =>
  statement.type === "ExpressionStatement" &&
  statement.expression.type === "CallExpression" &&
  isMember(statement.expression.callee, "process", "exit");

const leaves = (statement) => {
  if (statement.type === "BlockStatement") {
    const last = statement.body.at(-1);
    return last !== undefined && leaves(last);
  }
  return (
    statement.type === "ReturnStatement" ||
    statement.type === "ThrowStatement" ||
    statement.type === "ContinueStatement" ||
    statement.type === "BreakStatement" ||
    isProcessExit(statement)
  );
};

// Whether node only runs once a jarl check has said variable holds an error: inside the branch
// that check took, or after an earlier statement left on the branch that said otherwise.
const namedAnError = (context, jarl, node, variable) => {
  for (let child = node, parent = node.parent; parent; child = parent, parent = parent.parent) {
    if (parent.type === "IfStatement" || parent.type === "ConditionalExpression") {
      if (child === parent.consequent && failedIfTrue(context, jarl, parent.test, variable)) {
        return true;
      }
      if (child === parent.alternate && failedIfFalse(context, jarl, parent.test, variable)) {
        return true;
      }
    }
    if (parent.type === "LogicalExpression" && child === parent.right) {
      if (parent.operator === "&&" && failedIfTrue(context, jarl, parent.left, variable)) {
        return true;
      }
      if (parent.operator === "||" && failedIfFalse(context, jarl, parent.left, variable)) {
        return true;
      }
    }
    if (
      (parent.type === "WhileStatement" || parent.type === "ForStatement") &&
      child === parent.body &&
      parent.test !== null &&
      failedIfTrue(context, jarl, parent.test, variable)
    ) {
      return true;
    }
    const siblings =
      parent.type === "BlockStatement" || parent.type === "Program" ? parent.body : undefined;
    for (const statement of siblings?.slice(0, siblings.indexOf(child)) ?? []) {
      if (
        statement.type === "IfStatement" &&
        statement.alternate === null &&
        leaves(statement.consequent) &&
        failedIfFalse(context, jarl, statement.test, variable)
      ) {
        return true;
      }
    }
  }
  return false;
};

export default {
  meta: { name: "oligarchy" },
  rules: {
    "result-through-jarl": {
      meta: {
        type: "problem",
        docs: {
          description:
            "A jarl result is read through jarl: jarl.value or jarl.unwrap for its value, and its error only once jarl.error.is or jarl.is_err has named it",
        },
        messages: {
          value:
            "read {{ name }}.value with jarl.value({{ name }}) once every error is handled, or jarl.unwrap({{ name }}) to throw the rest",
          error:
            "name {{ name }}'s error with jarl.error.is({{ name }}, ...) or jarl.is_err({{ name }}) before reading {{ name }}.error",
        },
      },
      create(context) {
        let jarl;
        const results = new Map();
        const result = (identifier) => {
          const variable = variableOf(context, identifier);
          if (variable === undefined) {
            return undefined;
          }
          if (!results.has(variable)) {
            results.set(variable, isResult(variable, jarl));
          }
          return results.get(variable) ? variable : undefined;
        };
        const check = (node, identifier, field) => {
          if (field !== "value" && field !== "error") {
            return;
          }
          const variable = result(identifier);
          if (variable === undefined) {
            return;
          }
          if (field === "error" && namedAnError(context, jarl, node, variable)) {
            return;
          }
          context.report({ node, messageId: field, data: { name: identifier.name } });
        };
        return {
          Program(node) {
            jarl = jarlName(node);
          },
          MemberExpression(node) {
            if (!node.computed && node.object.type === "Identifier") {
              check(node, node.object, node.property.name);
            }
          },
          VariableDeclarator(node) {
            if (node.id.type !== "ObjectPattern" || node.init?.type !== "Identifier") {
              return;
            }
            for (const property of node.id.properties) {
              if (property.type === "Property" && !property.computed) {
                check(node, node.init, property.key.name);
              }
            }
          },
        };
      },
    },
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
