local M = {}

-- The REST history has no thought/final marker. For each consecutive assistant
-- turn, keep the latest message visible and infer earlier messages as thoughts.
-- IDs use the first message so appending replies preserves expansion state.
function M.groups(messages)
  local groups = {}
  for index, message in ipairs(messages) do
    local last = groups[#groups]
    if message.type == "assistant_message" and last and last.role == message.type then
      table.insert(last.messages, message.text)
    else
      table.insert(groups, {
        id = message.id or (message.type .. ":" .. index),
        role = message.type,
        messages = { message.text },
      })
    end
  end
  local boxes = {}
  for _, group in ipairs(groups) do
    if group.role == "assistant_message" then
      if #group.messages > 1 then
        table.insert(boxes, {
          id = "thoughts:" .. group.id,
          role = group.role,
          kind = "thoughts",
          messages = vim.list_slice(group.messages, 1, #group.messages - 1),
        })
      end
      table.insert(boxes, {
        -- Preserve the previous assistant-box key for existing saved folds.
        id = group.id,
        role = group.role,
        kind = "response",
        messages = { group.messages[#group.messages] },
      })
    else
      table.insert(boxes, group)
    end
  end
  return boxes
end

-- Explicit false matters: the user expanded a default-closed thoughts group.
function M.defaults(messages, closed)
  local changed = false
  for _, group in ipairs(M.groups(messages)) do
    if closed[group.id] == nil then
      closed[group.id] = group.kind == "thoughts"
      changed = true
    end
  end
  return changed
end

-- Wrap by display cells, so wide Unicode and long unbroken code fit too.
local function wrap(text, width)
  local result = {}
  for _, line in
    ipairs(vim.split(text:gsub("\r\n", "\n"):gsub("\t", "    "), "\n", { plain = true }))
  do
    local part, cells = "", 0
    for _, char in ipairs(vim.fn.split(line, "\\zs")) do
      local size = vim.fn.strdisplaywidth(char)
      if cells + size > width and part ~= "" then
        table.insert(result, part)
        part, cells = "", 0
      end
      part, cells = part .. char, cells + size
    end
    table.insert(result, part)
  end
  return result
end

function M.render(messages, closed, width)
  local lines, boxes, rows = {}, {}, {}
  local content_width = math.max(8, math.floor(width * 0.85))
  for _, group in ipairs(M.groups(messages)) do
    local label = ({ user_message = "user", assistant_message = "clanker" })[group.role]
      or group.role
    label = label:gsub("[\r\n]", " ")
    local prefix =
      string.rep(" ", group.role == "user_message" and math.max(0, width - content_width) or 0)
    local first = #lines + 1
    if group.kind == "thoughts" then
      local heading = (closed[group.id] and "[+] " or "[-] ")
        .. #group.messages
        .. (#group.messages == 1 and " thought" or " thoughts")
        .. " (inferred)"
      table.insert(lines, prefix .. "--- " .. heading .. " ---")
    else
      table.insert(
        lines,
        prefix .. "--- " .. label .. " ---" .. (closed[group.id] and " [+]" or "")
      )
    end
    if not closed[group.id] then
      for _, line in ipairs(wrap(table.concat(group.messages, "\n\n\n"), content_width)) do
        table.insert(lines, prefix .. line)
      end
    end
    for row = first, #lines do
      rows[row] = group.id
    end
    table.insert(boxes, {
      id = group.id,
      role = group.role,
      kind = group.kind,
      count = #group.messages,
      line = first,
      closed = closed[group.id] == true,
    })
    table.insert(lines, "")
  end
  return lines, boxes, rows
end

return M
