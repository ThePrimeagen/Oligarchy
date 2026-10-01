local M = {}

function M.archive(name, callback)
  local width = math.min(56, vim.o.columns - 4)
  local height = 5
  local buffer = vim.api.nvim_create_buf(false, true)
  local buttons = "   Archive    Cancel"
  vim.api.nvim_buf_set_lines(buffer, 0, -1, false, {
    "Archive this job?",
    "",
    name:gsub("[\r\n]", " "),
    "",
    buttons,
  })
  vim.bo[buffer].bufhidden = "wipe"
  vim.bo[buffer].modifiable = false
  local window = vim.api.nvim_open_win(buffer, true, {
    relative = "editor",
    width = width,
    height = height,
    row = math.max(0, math.floor((vim.o.lines - height) / 2) - 1),
    col = math.max(0, math.floor((vim.o.columns - width) / 2)),
    style = "minimal",
    border = "rounded",
    title = " Archive job ",
    title_pos = "center",
  })
  vim.api.nvim_set_hl(0, "OligarchyArchive", { fg = "#ffffff", bg = "#b91c1c", bold = true })
  vim.api.nvim_set_hl(0, "OligarchyCancel", { fg = "#ffffff", bg = "#4b5563" })
  local ns = vim.api.nvim_create_namespace("oligarchy.confirm")
  local positions = { buttons:find("Archive", 1, true) - 1, buttons:find("Cancel", 1, true) - 1 }
  for index, group in ipairs({ "OligarchyArchive", "OligarchyCancel" }) do
    vim.api.nvim_buf_set_extmark(buffer, ns, 4, positions[index], {
      end_col = positions[index] + (index == 1 and 7 or 6),
      hl_group = group,
    })
  end
  local selected, resolved = 2, false
  local function select(index)
    selected = index
    vim.api.nvim_win_set_cursor(window, { 5, positions[selected] })
  end
  local function finish(confirmed, defer_close)
    if resolved then
      return
    end
    resolved = true
    local function close()
      if vim.api.nvim_win_is_valid(window) then
        vim.api.nvim_win_close(window, true)
      end
    end
    if defer_close then
      vim.schedule(close)
    else
      close()
    end
    callback(confirmed)
  end
  for _, key in ipairs({ "<Tab>", "<S-Tab>", "h", "l", "<Left>", "<Right>" }) do
    vim.keymap.set("n", key, function()
      select(3 - selected)
    end, { buffer = buffer })
  end
  vim.keymap.set("n", "<CR>", function()
    finish(selected == 1)
  end, { buffer = buffer })
  for _, key in ipairs({ "<Esc>", "q" }) do
    vim.keymap.set("n", key, function()
      finish(false)
    end, { buffer = buffer })
  end
  vim.keymap.set("n", "<LeftMouse>", function()
    local mouse = vim.fn.getmousepos()
    if mouse.winid ~= window or mouse.line ~= 5 then
      return
    end
    for index, start in ipairs(positions) do
      if mouse.column > start and mouse.column <= start + (index == 1 and 7 or 6) then
        finish(index == 1)
        return
      end
    end
  end, { buffer = buffer })
  vim.api.nvim_create_autocmd("WinClosed", {
    pattern = tostring(window),
    once = true,
    callback = function()
      if not resolved then
        resolved = true
        callback(false)
      end
    end,
  })
  select(selected)
  return function(defer_close)
    finish(false, defer_close)
  end
end

return M
