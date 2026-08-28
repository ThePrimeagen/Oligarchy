#!/usr/bin/env python3
"""Generate typed QMP command bindings from query-qmp-schema output."""

from __future__ import annotations

import json
import re
import sys
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SCHEMA_PATH = ROOT / "pkg" / "qmp" / "schema.json"
OUT_DIR = ROOT / "pkg" / "qmp"

RESERVED = {
    "break",
    "case",
    "chan",
    "const",
    "continue",
    "default",
    "defer",
    "else",
    "fallthrough",
    "for",
    "func",
    "go",
    "goto",
    "if",
    "import",
    "interface",
    "map",
    "package",
    "range",
    "return",
    "select",
    "struct",
    "switch",
    "type",
    "var",
}

BUILTIN_GO = {
    "str": "string",
    "bool": "bool",
    "int": "int64",
    "number": "float64",
    "any": "any",
    "null": "any",
}


def exported(name: str) -> str:
    parts = re.split(r"[^0-9A-Za-z]+", name)
    out = "".join(p[:1].upper() + p[1:] for p in parts if p)
    if not out:
        out = "X"
    if out[0].isdigit():
        out = "N" + out
    if out.lower() in RESERVED:
        out += "_"
    return out


def enum_const(typ: str, value: str) -> str:
    ident = exported(value)
    if ident[0].isdigit() or value[0].isdigit():
        ident = typ + ident
    else:
        ident = typ + ident
    return ident


def load_schema() -> dict[str, dict]:
    items = json.loads(SCHEMA_PATH.read_text())
    return {item["name"]: item for item in items}


def fingerprint_names(by: dict[str, dict]) -> dict[str, str]:
    names: dict[str, str] = {}
    names["0"] = "Empty"
    for item in by.values():
        if item.get("meta-type") != "enum":
            continue
        values = item.get("values") or [m["name"] for m in item.get("members", [])]
        value_set = set(values)
        if value_set == {"ppm", "png"}:
            names[item["name"]] = "ImageFormat"
        elif value_set == {"number", "qcode"}:
            names[item["name"]] = "KeyValueKind"
        elif value_set == {"oob"}:
            names[item["name"]] = "QMPCapability"
        elif {"ret", "spc", "shift", "ctrl", "f24"} <= value_set:
            names[item["name"]] = "QKeyCode"
    for item in by.values():
        if item.get("meta-type") != "object":
            continue
        members = {m["name"] for m in item.get("members", [])}
        if members == {"qemu", "package"}:
            names[item["name"]] = "VersionInfo"
        elif members == {"major", "minor", "micro"}:
            names[item["name"]] = "VersionTriple"
        tag = item.get("tag")
        variants = {v["case"] for v in item.get("variants") or []}
        if tag == "type" and variants == {"number", "qcode"}:
            names[item["name"]] = "KeyValue"
    return names


def assign_names(by: dict[str, dict], names: dict[str, str]) -> dict[str, str]:
    commands = [i for i in by.values() if i.get("meta-type") == "command"]
    events = [i for i in by.values() if i.get("meta-type") == "event"]

    used = set(names.values())

    def claim(schema_name: str, candidate: str) -> str:
        if schema_name in names:
            return names[schema_name]
        ident = candidate
        n = 2
        while ident in used:
            ident = f"{candidate}{n}"
            n += 1
        names[schema_name] = ident
        used.add(ident)
        return ident

    for cmd in commands:
        go = exported(cmd["name"])
        arg = by[cmd["arg-type"]]
        ret = by[cmd["ret-type"]]
        if arg["name"] not in names:
            if arg.get("meta-type") == "object" and not arg.get("members") and not arg.get("variants"):
                names[arg["name"]] = "Empty"
                used.add("Empty")
            else:
                claim(arg["name"], go + "Args")
        if ret["name"] not in names:
            if ret.get("meta-type") == "object" and not ret.get("members") and not ret.get("variants"):
                names[ret["name"]] = "Empty"
                used.add("Empty")
            elif ret.get("meta-type") == "array":
                pass
            else:
                claim(ret["name"], go + "Result")

    for ev in events:
        go = exported(ev["name"])
        arg = by.get(ev.get("arg-type", ""), {})
        if arg and arg["name"] not in names:
            if arg.get("meta-type") == "object" and not arg.get("members") and not arg.get("variants"):
                names[arg["name"]] = "Empty"
                used.add("Empty")
            else:
                claim(arg["name"], go + "Event")

    # Name remaining objects/enums/alternates from first inbound edge.
    inbound: dict[str, list[tuple[str, str]]] = defaultdict(list)
    for item in by.values():
        mt = item.get("meta-type")
        if mt == "object":
            for m in item.get("members", []):
                inbound[m["type"]].append((item["name"], m["name"]))
            for v in item.get("variants") or []:
                inbound[v["type"]].append((item["name"], v["case"]))
        elif mt == "array":
            inbound[item["element-type"]].append((item["name"], "elem"))
        elif mt == "alternate":
            for i, m in enumerate(item.get("members", [])):
                inbound[m["type"]].append((item["name"], f"alt{i}"))
        elif mt == "command":
            inbound[item["arg-type"]].append((item["name"], "args"))
            inbound[item["ret-type"]].append((item["name"], "return"))
        elif mt == "event":
            inbound[item.get("arg-type", "")].append((item["name"], "event"))

    changed = True
    while changed:
        changed = False
        for item in by.values():
            if item["name"] in names:
                continue
            mt = item.get("meta-type")
            if mt not in {"object", "enum", "alternate"}:
                continue
            edges = inbound.get(item["name"]) or []
            parent = None
            field = None
            for src, fld in edges:
                if src in names:
                    parent, field = src, fld
                    break
            if parent is None:
                continue
            claim(item["name"], names[parent] + exported(field or "X"))
            changed = True

    for item in by.values():
        mt = item.get("meta-type")
        if mt in {"object", "enum", "alternate"} and item["name"] not in names:
            claim(item["name"], "Type" + exported(item["name"]))
    return names


def go_type(by: dict[str, dict], names: dict[str, str], schema_name: str) -> str:
    if schema_name in BUILTIN_GO:
        return BUILTIN_GO[schema_name]
    item = by[schema_name]
    mt = item.get("meta-type")
    if mt == "array":
        return "[]" + go_type(by, names, item["element-type"])
    if mt == "builtin":
        return BUILTIN_GO[item["name"]]
    return names[schema_name]


def field_decl(name: str, typ: str, optional: bool) -> str:
    ident = exported(name)
    go = typ
    if optional and not typ.startswith("*") and not typ.startswith("[]") and typ != "any":
        go = "*" + typ
    tag = f'`json:"{name},omitempty"`' if optional else f'`json:"{name}"`'
    return f"\t{ident} {go} {tag}\n"


def emit_types(by: dict[str, dict], names: dict[str, str]) -> str:
    chunks = [
        "// Code generated from QEMU query-qmp-schema. DO NOT EDIT.\n",
        "package qmp\n\n",
    ]

    # Stable order: Empty first, then named types alphabetically by Go name.
    objects = [i for i in by.values() if i.get("meta-type") == "object"]
    enums = [i for i in by.values() if i.get("meta-type") == "enum"]
    alts = [i for i in by.values() if i.get("meta-type") == "alternate"]

    seen_empty = False
    for item in sorted(objects, key=lambda i: names[i["name"]]):
        go = names[item["name"]]
        if go == "Empty":
            if seen_empty:
                continue
            seen_empty = True
            chunks.append("// Empty is the QAPI empty object.\n")
            chunks.append("type Empty struct{}\n\n")
            continue
        chunks.append(f"// {go} is QAPI object {item['name']}.\n")
        chunks.append(f"type {go} struct {{\n")
        fields: dict[str, tuple[str, bool]] = {}
        for m in item.get("members", []):
            optional = "default" in m
            fields[m["name"]] = (go_type(by, names, m["type"]), optional)
        for v in item.get("variants") or []:
            variant = by[v["type"]]
            if variant.get("meta-type") != "object":
                continue
            for m in variant.get("members", []):
                typ = go_type(by, names, m["type"])
                if m["name"] in fields:
                    existing, _ = fields[m["name"]]
                    if existing != typ and existing != "any":
                        fields[m["name"]] = ("any", True)
                else:
                    fields[m["name"]] = (typ, True)
        for fname, (typ, optional) in fields.items():
            chunks.append(field_decl(fname, typ, optional))
        chunks.append("}\n\n")

    for item in sorted(enums, key=lambda i: names[i["name"]]):
        go = names[item["name"]]
        values = item.get("values") or [m["name"] for m in item.get("members", [])]
        chunks.append(f"// {go} is QAPI enum {item['name']}.\n")
        chunks.append(f"type {go} string\n\n")
        chunks.append("const (\n")
        for value in values:
            chunks.append(f"\t{enum_const(go, value)} {go} = \"{value}\"\n")
        chunks.append(")\n\n")

    for item in sorted(alts, key=lambda i: names[i["name"]]):
        go = names[item["name"]]
        chunks.append(f"// {go} is a QAPI alternate.\n")
        chunks.append(f"type {go} struct {{\n\tValue any `json:\"-\"`\n}}\n\n")
        chunks.append(f"func (a {go}) MarshalJSON() ([]byte, error) {{\n")
        chunks.append("\treturn json.Marshal(a.Value)\n}\n\n")
        chunks.append(f"func (a *{go}) UnmarshalJSON(b []byte) error {{\n")
        chunks.append("\tvar v any\n\tif err := json.Unmarshal(b, &v); err != nil {\n\t\treturn err\n\t}\n")
        chunks.append("\ta.Value = v\n\treturn nil\n}\n\n")

    if alts:
        chunks.insert(2, "import \"encoding/json\"\n\n")

    return "".join(chunks)


def emit_commands(by: dict[str, dict], names: dict[str, str]) -> str:
    commands = sorted(
        (i for i in by.values() if i.get("meta-type") == "command"),
        key=lambda i: i["name"],
    )
    chunks = [
        "// Code generated from QEMU query-qmp-schema. DO NOT EDIT.\n",
        "package qmp\n\n",
    ]
    for cmd in commands:
        go = exported(cmd["name"])
        arg = go_type(by, names, cmd["arg-type"])
        ret = go_type(by, names, cmd["ret-type"])
        chunks.append(f"// {go} is the QMP command \"{cmd['name']}\".\n")
        if arg == "Empty":
            chunks.append(f"var {go} = Command[{arg}, {ret}]{{name: \"{cmd['name']}\"}}\n\n")
        else:
            chunks.append(
                f"func {go}(args {arg}) Command[{arg}, {ret}] {{\n"
                f"\treturn Command[{arg}, {ret}]{{name: \"{cmd['name']}\", Args: args}}\n"
                f"}}\n\n"
            )
    return "".join(chunks)


def emit_command_type() -> str:
    return """package qmp

// Command is a typed QMP request. Args is the wire arguments object and
// Result is the success "return" value for that command.
type Command[Args any, Result any] struct {
	name string
	Args Args
}

func (c Command[Args, Result]) Name() string { return c.name }

func (c Command[Args, Result]) HasArgs() bool {
	var zero Args
	_, empty := any(zero).(Empty)
	return !empty
}
"""


def main() -> int:
    by = load_schema()
    names = assign_names(by, fingerprint_names(by))
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    (OUT_DIR / "command.go").write_text(emit_command_type())
    (OUT_DIR / "types_gen.go").write_text(emit_types(by, names))
    (OUT_DIR / "commands_gen.go").write_text(emit_commands(by, names))
    print(f"wrote {len(names)} named types, {sum(1 for i in by.values() if i.get('meta-type')=='command')} commands")
    return 0


if __name__ == "__main__":
    sys.exit(main())
