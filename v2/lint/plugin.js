// Oligarchy's own lint rules. The root .oxlintrc.json loads this file for v2/**. Plain JavaScript:
// oxlint runs plugins under Node, and Node before 22.18 cannot strip TypeScript.
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
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

const FUNCTIONS = new Set(["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"]);

const handedToJarlFn = (node, jarl) =>
  node.parent?.type === "CallExpression" &&
  node.parent.arguments[0] === node &&
  (isMember(node.parent.callee, jarl, "fn") || isMember(node.parent.callee, jarl, "exec"));

// Whether fn is what a jarl.fn wraps or a jarl.exec runs: written as its first argument, or named
// there.
const wrappedByJarlFn = (context, jarl, fn) => {
  if (handedToJarlFn(fn, jarl)) {
    return true;
  }
  let name;
  if (fn.type === "FunctionDeclaration") {
    name = fn.id;
  } else if (fn.parent?.type === "VariableDeclarator" && fn.parent.init === fn) {
    name = fn.parent.id;
  }
  if (name?.type !== "Identifier") {
    return false;
  }
  const variable = variableOf(context, name);
  return variable?.references.some(({ identifier }) => handedToJarlFn(identifier, jarl)) === true;
};

const nameOf = (key) => (key.type === "Identifier" ? key.name : String(key.value));

// Every service a file adds to interface Services: its name, its type's text, and the member.
const registrations = (context, program) => {
  const found = [];
  for (const statement of program.body) {
    if (statement.type !== "TSModuleDeclaration" || statement.id.type !== "Literal") {
      continue;
    }
    for (const inner of statement.body?.body ?? []) {
      if (inner.type !== "TSInterfaceDeclaration" || inner.id.name !== "Services") {
        continue;
      }
      for (const member of inner.body.body) {
        if (member.type !== "TSPropertySignature" || member.typeAnnotation === undefined) {
          continue;
        }
        const annotation = member.typeAnnotation.typeAnnotation;
        const registered =
          annotation.type === "TSTypeReference" &&
          /(^|\.)Register$/.test(context.sourceCode.getText(annotation.typeName))
            ? annotation.typeArguments?.params[1]
            : undefined;
        found.push({
          node: member,
          name: nameOf(member.key),
          type: context.sourceCode.getText(registered ?? annotation),
        });
      }
    }
  }
  return found;
};

const isCreateService = (call) =>
  call?.type === "CallExpression" &&
  ((call.callee.type === "Identifier" && call.callee.name === "createService") ||
    (call.callee.type === "MemberExpression" &&
      !call.callee.computed &&
      call.callee.property.name === "createService"));

// The file's exported create: { node, call } with call the createService call it is, if it is one.
const exportedCreate = (program) => {
  for (const statement of program.body) {
    if (statement.type !== "ExportNamedDeclaration" || statement.declaration === null) {
      continue;
    }
    const { declaration } = statement;
    if (declaration.type === "FunctionDeclaration" && declaration.id?.name === "create") {
      return { node: declaration, call: undefined };
    }
    if (declaration.type !== "VariableDeclaration") {
      continue;
    }
    for (const declarator of declaration.declarations) {
      if (declarator.id.type === "Identifier" && declarator.id.name === "create") {
        return {
          node: declarator,
          call: isCreateService(declarator.init) ? declarator.init : undefined,
        };
      }
    }
  }
  return undefined;
};

const squash = (text) => text.replace(/\s+/g, "");

// The text of a type-argument list split at its top-level separator: "," between the arguments,
// "|" between a union's members. The ">" of an arrow is not a closing bracket.
const splitTop = (text, separator) => {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if ("<([{".includes(char)) {
      depth += 1;
    } else if (")]}".includes(char) || (char === ">" && text[i - 1] !== "=")) {
      depth -= 1;
    } else if (char === separator && depth === 0) {
      parts.push(text.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(text.slice(start));
  return parts.map((part) => part.trim()).filter((part) => part !== "");
};

// The text between createService's "<" and its matching ">", or undefined.
const typeArgumentsText = (text) => {
  const open = text.search(/createService\s*</);
  if (open < 0) {
    return undefined;
  }
  const start = text.indexOf("<", open) + 1;
  let depth = 1;
  for (let i = start; i < text.length; i += 1) {
    if ("<([{".includes(text[i])) {
      depth += 1;
    } else if (")]}".includes(text[i]) || (text[i] === ">" && text[i - 1] !== "=")) {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, i);
      }
    }
  }
  return undefined;
};

// A type named by its last identifier: Types.Sentry and Sentry.Sentry are both Sentry.
const typeKey = (type) => /([\w$]+)\s*$/.exec(type.replace(/<[\s\S]*$/, ""))?.[1];

const wantedKeys = (wants) =>
  wants === undefined
    ? []
    : splitTop(wants, "|")
        .filter((one) => one !== "never")
        .map(typeKey)
        .filter((key) => key !== undefined);

const REGISTERS = /([\w$]+)\s*:\s*(?:[\w$]+\.)?Register<\s*"([\w$]+)"\s*,\s*([^>]+?)\s*>/g;

// A file's services and what each wants, read from its text: no types reach a JS plugin, and
// the other files are not being linted.
const servicesIn = (text) => {
  const wants = wantedKeys(splitTop(typeArgumentsText(text) ?? "", ",")[0]);
  return [...text.matchAll(REGISTERS)].map(([, , name, type]) => ({
    name,
    key: typeKey(type),
    wants,
  }));
};

// The directory holding packages/, from file up.
const workspaceRoot = (file) => {
  for (let dir = dirname(file); dir !== dirname(dir); dir = dirname(dir)) {
    const packages = join(dir, "packages");
    if (existsSync(packages) && statSync(packages).isDirectory()) {
      return dir;
    }
  }
  return undefined;
};

const sourcesUnder = (dir) => {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules") {
      files.push(...sourcesUnder(path));
    } else if (entry.isFile() && entry.name.endsWith(".ts")) {
      files.push(path);
    }
  }
  return files;
};

// Every service under root's packages/*/src, and the file being linted as it is now.
const serviceGraph = (root, file, text) => {
  const services = [...servicesIn(text)];
  if (root !== undefined) {
    const packages = join(root, "packages");
    for (const name of readdirSync(packages)) {
      const src = join(packages, name, "src");
      if (!existsSync(src) || !statSync(src).isDirectory()) {
        continue;
      }
      for (const path of sourcesUnder(src)) {
        if (resolve(path) !== resolve(file)) {
          services.push(...servicesIn(readFileSync(path, "utf8")));
        }
      }
    }
  }
  const byKey = new Map(services.map((service) => [service.key, service.name]));
  const edges = new Map();
  for (const service of services) {
    const wanted = service.wants.map((key) => byKey.get(key)).filter((name) => name !== undefined);
    edges.set(service.name, [...(edges.get(service.name) ?? []), ...wanted]);
  }
  return edges;
};

// The shortest way from name back to itself through what each service wants, or undefined.
const cycleFrom = (edges, name) => {
  const cameFrom = new Map();
  const queue = [name];
  while (queue.length > 0) {
    const at = queue.shift();
    for (const next of edges.get(at) ?? []) {
      if (next === name) {
        const path = [name];
        for (let step = at; step !== name; step = cameFrom.get(step)) {
          path.splice(1, 0, step);
        }
        return [...path, name];
      }
      if (!cameFrom.has(next)) {
        cameFrom.set(next, at);
        queue.push(next);
      }
    }
  }
  return undefined;
};

export default {
  meta: { name: "oligarchy" },
  rules: {
    "service-create": {
      meta: {
        type: "problem",
        docs: {
          description:
            "A file that registers a service exports its create, built by createService for that service",
        },
        messages: {
          missing:
            "export create from the file that registers {{ name }}: export const create = App.createService<Wants, Options, {{ type }}>(...)",
          notBuilt:
            "build create with App.createService<Wants, Options, {{ type }}>(...), which types the services {{ name }} wants and brands what it builds",
          wrongType: "create builds {{ built }}, but this file registers {{ name }} as {{ type }}",
          many: "register one service per file, each with its own create: this file registers {{ names }}",
        },
      },
      create(context) {
        return {
          Program(program) {
            const registered = registrations(context, program);
            if (registered.length === 0) {
              return;
            }
            if (registered.length > 1) {
              context.report({
                node: registered[1].node,
                messageId: "many",
                data: { names: registered.map(({ name }) => name).join(", ") },
              });
              return;
            }
            const [{ node, name, type }] = registered;
            const create = exportedCreate(program);
            if (create === undefined) {
              context.report({ node, messageId: "missing", data: { name, type } });
              return;
            }
            const built = create.call?.typeArguments?.params;
            if (built?.length !== 3) {
              context.report({ node: create.node, messageId: "notBuilt", data: { name, type } });
              return;
            }
            const builtType = context.sourceCode.getText(built[2]);
            if (squash(builtType) !== squash(type)) {
              context.report({
                node: built[2],
                messageId: "wrongType",
                data: { name, type, built: builtType },
              });
            }
          },
        };
      },
    },
    "service-cycle": {
      meta: {
        type: "problem",
        docs: {
          description:
            "No service wants itself, directly or through the services it wants, across every package",
        },
        messages: {
          cycle:
            "break the service cycle {{ path }}: a service cannot want itself, directly or through the services it wants",
        },
      },
      create(context) {
        return {
          Program(program) {
            const create = exportedCreate(program);
            const [own] = registrations(context, program);
            if (create?.call === undefined || own === undefined) {
              return;
            }
            const edges = serviceGraph(
              workspaceRoot(context.filename),
              context.filename,
              context.sourceCode.text,
            );
            const path = cycleFrom(edges, own.name);
            if (path !== undefined) {
              context.report({
                node: create.call,
                messageId: "cycle",
                data: { path: path.join(" -> ") },
              });
            }
          },
        };
      },
    },
    "unwrap-inside-jarl-fn": {
      meta: {
        type: "problem",
        docs: {
          description:
            "jarl.unwrap throws, so it is called only in the function a jarl.fn wraps or a jarl.exec runs, whose mapError catches it",
        },
        messages: {
          outside:
            "call jarl.unwrap only in the function handed to jarl.fn or jarl.exec, whose mapError catches what it throws; handle the error here instead",
        },
      },
      create(context) {
        let jarl;
        return {
          Program(node) {
            jarl = jarlName(node);
          },
          MemberExpression(node) {
            if (jarl === undefined || !isMember(node, jarl, "unwrap")) {
              return;
            }
            let fn = node.parent;
            while (fn && !FUNCTIONS.has(fn.type)) {
              fn = fn.parent;
            }
            if (fn === null || fn === undefined || !wrappedByJarlFn(context, jarl, fn)) {
              context.report({ node, messageId: "outside" });
            }
          },
        };
      },
    },
    "result-through-jarl": {
      meta: {
        type: "problem",
        docs: {
          description:
            "A jarl result is read through jarl: jarl.value or jarl.unwrap for its value, and its error only once jarl.error.is or jarl.is_err has named it",
        },
        messages: {
          value:
            "read {{ name }}.value with jarl.value({{ name }}) once every error is handled, or jarl.unwrap({{ name }}) inside a jarl.fn or jarl.exec to throw the rest",
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
