local M = {}

-- Read dotenv values literally: never source the file or expand shell expressions.
-- Existing process variables win. Return an overlay for child processes.
function M.load(root)
  local path = root .. "/.env"
  local file, message, code = io.open(path, "r")
  if not file then
    if code == 2 then
      return {}
    end
    return nil, "Cannot read .env: " .. message
  end

  local values = {}
  local line_number = 0
  for line in file:lines() do
    line_number = line_number + 1
    line = vim.trim(line)
    if line ~= "" and line:sub(1, 1) ~= "#" then
      line = line:gsub("^export%s+", "")
      local key, value = line:match("^([%a_][%w_]*)%s*=%s*(.*)$")
      if not key then
        file:close()
        return nil, "Invalid .env assignment on line " .. line_number
      end
      local quote = value:sub(1, 1)
      if quote == '"' or quote == "'" then
        local closing = 2
        while closing <= #value and value:sub(closing, closing) ~= quote do
          if quote == '"' and value:sub(closing, closing) == "\\" then
            closing = closing + 1
          end
          closing = closing + 1
        end
        local tail = vim.trim(value:sub(closing + 1))
        if closing > #value or (tail ~= "" and not tail:match("^#")) then
          file:close()
          return nil, "Invalid .env quoted value on line " .. line_number
        end
        value = value:sub(2, closing - 1)
        if quote == '"' then
          local escapes = { n = "\n", r = "\r", t = "\t", ['"'] = '"', ["\\"] = "\\" }
          value = value:gsub("\\(.)", function(char)
            return escapes[char] or ("\\" .. char)
          end)
        end
      else
        value = vim.trim(value:gsub("%s+#.*$", ""))
      end
      local inherited = vim.env[key]
      values[key] = inherited and inherited ~= "" and inherited or value
    end
  end
  file:close()
  return values
end

return M
