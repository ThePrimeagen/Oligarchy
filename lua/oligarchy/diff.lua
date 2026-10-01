local M = {}

local function filename(value)
  if value:sub(1, 1) == '"' then
    value = value:match('^"(.*)"$') or ""
    value = value
      :gsub("\\(%d%d%d)", function(octal)
        return string.char(tonumber(octal, 8))
      end)
      :gsub('\\([\\"tnr])', { ["\\"] = "\\", ['"'] = '"', t = "\t", n = "\n", r = "\r" })
  else
    value = value:match("^[^\t]*")
  end
  if value == "/dev/null" then
    return nil
  end
  value = value:gsub("^[ab]/", "")
  if value == "" or value:sub(1, 1) == "/" or value:find("%z") then
    error("Invalid diff path")
  end
  for part in value:gmatch("[^/]+") do
    if part == ".." then
      error("Invalid diff path")
    end
  end
  return value
end

-- One quickfix entry per textual hunk in a surviving file.
function M.hunks(text, root, skip_files)
  local function skipped(path)
    for _, rule in ipairs(skip_files or {}) do
      if
        rule == path
        or (type(rule) == "table" and rule.partial and path:find(rule.match, 1, true))
      then
        return true
      end
    end
    return false
  end
  local entries, old, new, hunk = {}, nil, nil, nil
  local has_hunks = false
  local function finish()
    if not hunk then
      return
    end
    -- Deleted files have +++ /dev/null; opening them would create empty buffers.
    if new and not skipped(new) then
      local changes, current = {}, hunk.line
      for i = 2, #hunk.lines do
        local operation = hunk.lines[i]:sub(1, 1)
        if operation == "+" or operation == "-" then
          local line = math.max(1, current)
          local change = changes[#changes]
          if not change or change.lnum ~= line then
            change = { lnum = line }
            table.insert(changes, change)
          end
          change[operation == "+" and "added" or "removed"] = true
        end
        if operation == "+" or operation == " " then
          current = current + 1
        end
      end
      table.insert(entries, {
        filename = root .. "/" .. hunk.path,
        lnum = math.max(1, hunk.line),
        col = 1,
        text = hunk.path .. " " .. hunk.lines[1],
        user_data = { diff = table.concat(hunk.lines, "\n"), changes = changes },
      })
    end
    hunk = nil
  end
  for _, line in ipairs(vim.split(text, "\n", { plain = true })) do
    if line:match("^diff %-%-git ") then
      finish()
      old, new = nil, nil
    elseif line:match("^@@ ") then
      finish()
      local from, to = line:match("^@@ %-(%d+),?%d* %+(%d+),?%d* @@")
      if not from or not (new or old) then
        error("Invalid diff hunk")
      end
      has_hunks = true
      hunk = { path = new, line = tonumber(to), lines = { line } }
    elseif hunk then
      table.insert(hunk.lines, line)
    elseif line:match("^%-%-%- ") then
      old = filename(line:sub(5))
    elseif line:match("^%+%+%+ ") then
      new = filename(line:sub(5))
    end
  end
  finish()
  if not has_hunks and text ~= "" and not text:match("^diff %-%-git ") then
    error("Invalid unified diff")
  end
  return entries
end

function M.clear()
  local namespace = vim.api.nvim_create_namespace("oligarchy-diff")
  vim.api.nvim_create_augroup("OligarchyDiff", { clear = true })
  for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buffer) then
      vim.api.nvim_buf_clear_namespace(buffer, namespace, 0, -1)
    end
  end
end

-- Apply the latest PR's changes without loading files just to decorate them.
function M.show(items)
  local namespace = vim.api.nvim_create_namespace("oligarchy-diff")
  local files = {}
  for _, item in ipairs(items) do
    files[item.filename] = files[item.filename] or {}
    vim.list_extend(files[item.filename], item.user_data.changes)
  end
  local function apply(buffer)
    vim.api.nvim_buf_clear_namespace(buffer, namespace, 0, -1)
    local count = vim.api.nvim_buf_line_count(buffer)
    for _, change in ipairs(files[vim.api.nvim_buf_get_name(buffer)] or {}) do
      if change.added and change.lnum <= count then
        vim.api.nvim_buf_set_extmark(buffer, namespace, change.lnum - 1, 0, {
          sign_text = "+",
          sign_hl_group = "Added",
          priority = 100,
        })
      end
      if change.removed then
        vim.api.nvim_buf_set_extmark(buffer, namespace, math.min(change.lnum, count) - 1, 0, {
          sign_text = "-",
          sign_hl_group = "Removed",
          priority = 101,
        })
      end
    end
  end
  local group = vim.api.nvim_create_augroup("OligarchyDiff", { clear = true })
  vim.api.nvim_create_autocmd({ "BufReadPost", "BufNewFile" }, {
    group = group,
    callback = function(event)
      apply(event.buf)
    end,
  })
  for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(buffer) then
      apply(buffer)
    end
  end
end
return M
