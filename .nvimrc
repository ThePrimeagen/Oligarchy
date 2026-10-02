execute 'set runtimepath^=' . fnameescape(expand('<sfile>:p:h'))
lua << EOF
-- Wiping the old jobs buffer cancels its requests through BufWipeout.
local buffer = vim.fn.bufnr('oligarchy://cloud-jobs')
if buffer ~= -1 then
  for _, window in ipairs(vim.fn.win_findbuf(buffer)) do
    local tab = vim.api.nvim_win_get_tabpage(window)
    if #vim.api.nvim_tabpage_list_wins(tab) > 1 then
      vim.api.nvim_win_close(window, true)
    end
  end
  if vim.api.nvim_buf_is_valid(buffer) then
    vim.api.nvim_buf_delete(buffer, { force = true })
  end
end

require('plenary.reload').reload_module('oligarchy')
local plugin = require('oligarchy')
plugin.setup({
  skip_files = {
    "bun.lock",
    "package.json",
    { match = "*.lua", pattern = true },
    { match = "doc/*", pattern = true },
    -- Strings match exact paths relative to this repository.
    -- To match anywhere in a path, use:
    -- { partial = true, match = "package.json" },
  },
})
vim.schedule(function()
  -- Re-sourcing again before this runs supersedes the old scheduled open.
  if package.loaded.oligarchy == plugin then
    plugin.open()
  end
end)
EOF
