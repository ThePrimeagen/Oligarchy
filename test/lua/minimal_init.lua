local root = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":p:h:h:h")
local plenary = vim.env.PLENARY_PATH or (vim.fn.stdpath("data") .. "/lazy/plenary.nvim")
assert(vim.fn.isdirectory(plenary) == 1, "Set PLENARY_PATH to your plenary.nvim checkout")
vim.opt.runtimepath:prepend(root)
vim.opt.runtimepath:append(plenary)
vim.opt.shadafile = "NONE"
package.path = root .. "/test/lua/?.lua;" .. package.path
vim.cmd("runtime plugin/plenary.vim")
