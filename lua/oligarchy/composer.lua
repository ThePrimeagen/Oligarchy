local M = {}

-- A scratch buffer owned by one conversation, not a global prompt shared by jobs.
function M.new(options)
  local self = {}
  local buffer, window, parent
  local queued = false

  function self.text()
    if not buffer or not vim.api.nvim_buf_is_valid(buffer) then
      return ""
    end
    return table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n")
  end

  function self.resize()
    if
      not window
      or not vim.api.nvim_win_is_valid(window)
      or not vim.api.nvim_win_is_valid(parent)
    then
      return
    end
    local total = vim.api.nvim_win_get_height(window) + vim.api.nvim_win_get_height(parent)
    local maximum = math.max(3, math.floor(total / 2))
    local height = vim.api.nvim_win_text_height(
      window,
      { start_row = 0, end_row = vim.api.nvim_buf_line_count(buffer) - 1 }
    ).all
    height = math.max(3, math.min(height, maximum))
    if height ~= vim.api.nvim_win_get_height(window) then
      vim.api.nvim_win_set_height(window, height)
    end
  end

  function self.open(parent_window, draft)
    if
      buffer
      and vim.api.nvim_buf_is_valid(buffer)
      and window
      and vim.api.nvim_win_is_valid(window)
    then
      return
    end
    parent = parent_window
    buffer = vim.api.nvim_create_buf(false, true)
    local owned = buffer
    vim.bo[buffer].bufhidden = "wipe"
    vim.bo[buffer].swapfile = false
    vim.bo[buffer].filetype = "oligarchy-prompt"
    vim.api.nvim_buf_set_lines(buffer, 0, -1, false, vim.split(draft or "", "\n", { plain = true }))
    vim.api.nvim_win_call(parent, function()
      vim.cmd("belowright 3split")
      window = vim.api.nvim_get_current_win()
      vim.api.nvim_win_set_buf(window, buffer)
    end)
    vim.wo[window].wrap = true
    vim.wo[window].linebreak = true
    vim.wo[window].winfixheight = true
    vim.wo[window].number = false
    vim.wo[window].relativenumber = false
    vim.wo[window].statusline = " Prompt | Ctrl-Enter: send | Esc: normal mode "
    vim.keymap.set(
      { "n", "i" },
      "<C-CR>",
      options.send,
      { buffer = buffer, desc = "Send prompt to Cursor" }
    )
    vim.api.nvim_buf_attach(buffer, false, {
      on_lines = function()
        if queued then
          return
        end
        queued = true
        vim.schedule(function()
          queued = false
          if buffer ~= owned or not vim.api.nvim_buf_is_valid(owned) then
            return
          end
          options.changed(self.text())
          self.resize()
        end)
      end,
    })
    vim.api.nvim_create_autocmd("BufWipeout", {
      buffer = buffer,
      once = true,
      callback = function()
        if buffer ~= owned then
          return
        end
        self.close(true)
      end,
    })
    self.resize()
  end

  function self.focus()
    if window and vim.api.nvim_win_is_valid(window) then
      vim.api.nvim_set_current_win(window)
      vim.cmd("startinsert")
    end
  end

  function self.lock(locked)
    if buffer and vim.api.nvim_buf_is_valid(buffer) then
      vim.bo[buffer].modifiable = not locked
    end
  end

  function self.clear()
    self.lock(false)
    if buffer and vim.api.nvim_buf_is_valid(buffer) then
      vim.api.nvim_buf_set_lines(buffer, 0, -1, false, { "" })
      options.changed("")
      self.resize()
    end
  end

  function self.close(deferred)
    if not buffer then
      return
    end
    options.changed(self.text())
    options.save()
    local old_buffer, old_window = buffer, window
    buffer, window = nil, nil
    local function wipe()
      if
        old_window
        and vim.api.nvim_win_is_valid(old_window)
        and vim.api.nvim_win_get_buf(old_window) == old_buffer
      then
        local tab = vim.api.nvim_win_get_tabpage(old_window)
        if #vim.api.nvim_tabpage_list_wins(tab) > 1 then
          vim.api.nvim_win_close(old_window, true)
        end
      end
      if vim.api.nvim_buf_is_valid(old_buffer) then
        vim.api.nvim_buf_delete(old_buffer, { force = true })
      end
    end
    if deferred then
      vim.schedule(wipe)
    else
      wipe()
    end
  end

  return self
end
return M
