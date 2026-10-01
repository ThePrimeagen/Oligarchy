std = "luajit"
globals = { "vim" } -- Neovim exposes writable option, buffer, and environment tables.
self = false -- Client methods retain the colon-call API for injected implementations.
max_line_length = false -- StyLua owns formatting, including indivisible strings.

files["test/lua/*_spec.lua"] = { std = "+busted" }
files["test/live/*_spec.lua"] = { std = "+busted" }
