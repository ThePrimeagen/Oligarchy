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

-- One quickfix entry per textual hunk, with the complete patch in user_data.
function M.hunks(text, root)
  local entries, old, new, hunk = {}, nil, nil, nil
  local function finish()
    if not hunk then
      return
    end
    table.insert(entries, {
      filename = root .. "/" .. hunk.path,
      lnum = math.max(1, hunk.line),
      col = 1,
      text = hunk.path .. " " .. hunk.lines[1],
      user_data = { diff = table.concat(hunk.lines, "\n"), deleted = new == nil },
    })
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
      hunk = { path = new or old, line = tonumber(new and to or from), lines = { line } }
    elseif hunk then
      table.insert(hunk.lines, line)
    elseif line:match("^%-%-%- ") then
      old = filename(line:sub(5))
    elseif line:match("^%+%+%+ ") then
      new = filename(line:sub(5))
    end
  end
  finish()
  if #entries == 0 and text ~= "" and not text:match("^diff %-%-git ") then
    error("Invalid unified diff")
  end
  return entries
end
return M
