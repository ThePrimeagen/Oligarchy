local M = {}
local root = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":p:h:h:h")
local client = require("oligarchy.cursor").new({ root = root })
local buffer, cancel, close_popup
local agents, rows = {}, {}
local conversation
local local_view = false
local local_entry = {}
local local_summary, summary_error, summary_cancel
local summary_namespace = vim.api.nvim_create_namespace("oligarchy.local-summary")
local archiving = false
local action_cancel, branch_cancel, action
local state, box_rows = { closed = {} }, {}
local message_status, branch_status, action_status = "", "", ""
local cache, sync_branch, open_url, http
local composer
local skip_files = {}
local start_review
local Refresh = require("oligarchy.refresh")
local refresh_cancel, refresh_clock, refresh_timer
local refresh_namespace = vim.api.nvim_create_namespace("oligarchy.refresh")
local refresh_text = ""

local function show_refresh()
  if buffer and vim.api.nvim_buf_is_valid(buffer) then
    vim.api.nvim_buf_clear_namespace(buffer, refresh_namespace, 0, -1)
    if refresh_text ~= "" then
      vim.api.nvim_buf_set_extmark(buffer, refresh_namespace, 3, 0, {
        virt_text = { { refresh_text, "Comment" } },
        virt_text_pos = "eol",
      })
    end
  end
end

local function stop_refresh()
  if refresh_cancel then
    refresh_cancel()
    refresh_cancel = nil
  end
  refresh_text = ""
  show_refresh()
end

local function render(lines)
  vim.api.nvim_buf_clear_namespace(buffer, summary_namespace, 0, -1)
  vim.bo[buffer].modifiable = true
  vim.api.nvim_buf_set_lines(buffer, 0, -1, false, lines)
  vim.bo[buffer].modifiable = false
end

local function stop()
  stop_refresh()
  if summary_cancel then
    summary_cancel()
    summary_cancel = nil
  end
  if action == "send" and composer then
    composer.lock(false)
  end
  if action_cancel then
    action_cancel()
    action_cancel = nil
  end
  if branch_cancel then
    branch_cancel()
    branch_cancel = nil
  end
  action = nil
  if cancel then
    cancel()
    cancel = nil
  end
end

local function close_composer(deferred)
  if composer then
    local old = composer
    composer = nil
    old.close(deferred)
  end
end

local function open_composer()
  if not conversation then
    return
  end
  if not composer then
    local draft_state, agent_id, store = state, conversation.id, cache
    composer = require("oligarchy.composer").new({
      send = function()
        M.send()
      end,
      changed = function(text)
        draft_state.draft = text
      end,
      save = function()
        local err = store.write(agent_id, draft_state)
        if err then
          vim.notify(err, vim.log.levels.WARN)
        end
      end,
    })
  end
  composer.open(vim.fn.bufwinid(buffer), state.draft)
  composer.lock(action == "send")
end

function M.prompt()
  if not conversation then
    return
  end
  open_composer()
  composer.focus()
end

local function show_summary()
  local chunks = { { " (loading…)", "Comment" } }
  if summary_error then
    chunks = { { " (diff unavailable)", "Comment" } }
  elseif local_summary then
    if local_summary.files == 0 then
      chunks = { { " (unchanged)", "Comment" } }
    else
      chunks = {
        { " +" .. local_summary.added, "Added" },
        { "/", "Normal" },
        { "-" .. local_summary.removed, "Removed" },
        {
          " with "
            .. local_summary.files
            .. (local_summary.files == 1 and " file" or " files")
            .. " changed",
          "Normal",
        },
      }
    end
  end
  for row, entry in pairs(rows) do
    if entry == local_entry then
      local label = "Local"
      for _, chunk in ipairs(chunks) do
        label = label .. chunk[1]
      end
      vim.bo[buffer].modifiable = true
      vim.api.nvim_buf_set_lines(buffer, row - 1, row, false, { label })
      vim.bo[buffer].modifiable = false
      vim.api.nvim_buf_clear_namespace(buffer, summary_namespace, 0, -1)
      local column = #"Local"
      for _, chunk in ipairs(chunks) do
        vim.api.nvim_buf_set_extmark(buffer, summary_namespace, row - 1, column, {
          end_col = column + #chunk[1],
          hl_group = chunk[2],
        })
        column = column + #chunk[1]
      end
      return
    end
  end
end

local function show_list(message)
  close_composer()
  conversation = nil
  local_view = false
  box_rows = {}
  vim.b[buffer].oligarchy_boxes = nil
  rows = {}
  vim.b[buffer].oligarchy_conversation = nil
  vim.b[buffer].oligarchy_agents = agents
  local lines = {
    "Recent Cursor cloud jobs — " .. vim.fn.fnamemodify(root, ":t"),
    "",
    "Enter: open    P: Push & Review    a: archive    r: refresh    q: close",
    "",
    "Local",
    "",
  }
  local first_row = 5
  rows[first_row] = local_entry
  if message then
    vim.list_extend(lines, vim.split(message, "\n", { plain = true }))
    table.insert(lines, "")
  end
  if #agents == 0 then
    table.insert(lines, "No recent cloud jobs for this project among the latest 10.")
  end
  for _, agent in ipairs(agents) do
    local line = #lines + 1
    rows[line], rows[line + 1] = agent, agent
    table.insert(lines, agent.status .. "  " .. agent.name:gsub("[\r\n]", " "))
    table.insert(lines, "  " .. agent.id)
    table.insert(lines, "")
  end
  render(lines)
  show_summary()
  if summary_cancel then
    summary_cancel()
  end
  summary_cancel = require("oligarchy.local_diff").summary(root, skip_files, function(err, result)
    summary_cancel = nil
    local_summary, summary_error = result, err
    show_summary()
  end)
  local window = vim.fn.bufwinid(buffer)
  if window ~= -1 then
    vim.api.nvim_win_set_cursor(window, { first_row, 0 })
  end
end

local function show_local(message)
  local lines = {
    "Local",
    "d: diff    r: refresh diff    Ctrl-b: jobs    q: close",
    "",
    "Staged and unstaged changes against HEAD, plus untracked files on disk.",
  }
  vim.list_extend(lines, vim.split(message or "", "\n", { plain = true }))
  render(lines)
end

local function show_conversation()
  if not conversation or not buffer or not vim.api.nvim_buf_is_valid(buffer) then
    return
  end
  local window = vim.fn.bufwinid(buffer)
  if window == -1 then
    return
  end
  if require("oligarchy.conversation").defaults(state.messages or {}, state.closed) then
    local err = cache.write(conversation.id, state)
    if err then
      action_status = err
    end
  end
  local cursor = vim.api.nvim_win_get_cursor(window)
  local anchor = box_rows[cursor[1]]
  local offset = 0
  for _, box in ipairs(vim.b[buffer].oligarchy_boxes or {}) do
    if box.id == anchor then
      offset = cursor[1] - box.line
      break
    end
  end
  local lines = {
    conversation.name:gsub("[\r\n]", " "),
    "J/K: next/previous  Enter/za: fold  r: refresh  a: abort",
    "i: prompt  Ctrl-Enter: send  P: Push & Review  g: PR  d: diff  Ctrl-b: jobs  q: close",
    "",
  }
  for _, status in ipairs({ message_status, branch_status, action_status }) do
    vim.list_extend(lines, vim.split(status, "\n", { plain = true }))
  end
  table.insert(lines, "")
  local width = vim.api.nvim_win_get_width(window) - vim.fn.getwininfo(window)[1].textoff
  local body, boxes, positions =
    require("oligarchy.conversation").render(state.messages or {}, state.closed, width)
  box_rows = {}
  for row, id in pairs(positions) do
    box_rows[row + #lines] = id
  end
  for _, box in ipairs(boxes) do
    box.line = box.line + #lines
  end
  vim.list_extend(lines, body)
  if state.messages and #state.messages == 0 then
    table.insert(lines, "No conversation messages yet.")
  end
  render(lines)
  vim.b[buffer].oligarchy_conversation = state.messages
  show_refresh()
  vim.b[buffer].oligarchy_boxes = boxes
  if anchor then
    for index, box in ipairs(boxes) do
      if box.id == anchor then
        local last = boxes[index + 1] and boxes[index + 1].line - 2 or #lines - 1
        cursor = { box.closed and box.line or math.min(box.line + offset, last), cursor[2] }
        break
      end
    end
  end
  cursor[1] = math.min(cursor[1], #lines)
  vim.api.nvim_win_set_cursor(window, cursor)
end

local function refresh_messages(agent)
  cancel = client:get_conversation(agent.id, function(err, messages)
    cancel = nil
    if err then
      message_status = err
    else
      state.messages = messages
      require("oligarchy.conversation").defaults(messages, state.closed)
      message_status = cache.write(agent.id, state) or "Conversation up to date"
    end
    show_conversation()
  end)
end

local load_conversation
local function start_refresh()
  if refresh_cancel or not Refresh.active(conversation.status) then
    return
  end
  local frames = { "⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏" }
  refresh_cancel = Refresh.start({
    now = refresh_clock,
    new_timer = refresh_timer,
    busy = function()
      return cancel ~= nil or branch_cancel ~= nil or action ~= nil or vim.fn.bufwinid(buffer) == -1
    end,
    refresh = function()
      load_conversation(conversation, true)
    end,
    display = function(seconds, busy, time)
      local label = busy and "refreshing..." or ("refreshing in " .. seconds .. "s...")
      refresh_text = frames[math.floor(time / 100) % #frames + 1] .. " " .. label
      show_refresh()
    end,
  })
end

load_conversation = function(agent, automatic)
  stop()
  local entering = not conversation or conversation.id ~= agent.id
  conversation = agent
  rows = {}
  if entering then
    close_composer()
    state = cache.read(agent.id)
    box_rows = {}
  end
  message_status = state.messages and "Cached conversation — updating…"
    or "Loading conversation…"
  if not automatic then
    branch_status = "Fetching branch…"
    action_status = ""
    open_composer()
  end
  show_conversation()
  refresh_messages(agent)
  local function refreshed(err, branch, status)
    branch_cancel = nil
    if not automatic then
      branch_status = err or ("Branch updated: " .. branch)
    elseif err then
      message_status = err
    end
    if status then
      local was_active = Refresh.active(agent.status)
      agent.status = status
      if Refresh.active(status) then
        start_refresh()
      else
        stop_refresh()
        -- History may have arrived before the final turn finished.
        if was_active then
          if cancel then
            cancel()
          end
          refresh_messages(agent)
        end
      end
    end
    show_conversation()
  end
  -- Automatic refresh needs run status, but never fetches Git refs.
  if automatic then
    branch_cancel = client:get_agent(agent.id, function(err, metadata)
      refreshed(err, nil, metadata and metadata.status)
    end)
  else
    -- Independent of history: cached messages remain usable during fetch.
    branch_cancel = sync_branch(agent.id, refreshed)
  end
  start_refresh()
end

function M.send()
  if not conversation or not composer or action then
    return
  end
  local text = composer.text()
  if vim.trim(text) == "" then
    action_status = "Write a message before sending"
    show_conversation()
    return
  end
  state.draft = text
  local err = cache.write(conversation.id, state)
  if err then
    vim.notify(err, vim.log.levels.WARN)
  end
  action, action_status = "send", "Sending message…"
  composer.lock(true)
  show_conversation()
  action_cancel = client:send_message(conversation.id, text, function(failure)
    action, action_cancel = nil, nil
    composer.lock(false)
    if failure then
      action_status = failure
    else
      composer.clear()
      state.draft = ""
      local save_error = cache.write(conversation.id, state)
      if save_error then
        vim.notify(save_error, vim.log.levels.WARN)
      end
      conversation.status = "RUNNING"
      load_conversation(conversation)
      action_status = "Message sent"
    end
    show_conversation()
  end)
end

function M.jump(direction)
  if not conversation then
    return
  end
  local points = vim.b[buffer].oligarchy_boxes or {}
  local row = vim.api.nvim_win_get_cursor(0)[1]
  local target, remaining = row, vim.v.count1
  local first, last = 1, #points
  if direction < 0 then
    first, last = #points, 1
  end
  for index = first, last, direction do
    local line = points[index].line
    if (line - row) * direction > 0 then
      target = line
      remaining = remaining - 1
      if remaining == 0 then
        break
      end
    end
  end
  if target ~= row then
    vim.api.nvim_win_set_cursor(0, { target, 0 })
  end
end

function M.fold(closed)
  if not conversation then
    return
  end
  local id = box_rows[vim.api.nvim_win_get_cursor(0)[1]]
  if not id then
    return
  end
  if closed == nil then
    closed = not state.closed[id]
  end
  state.closed[id] = closed
  local err = cache.write(conversation.id, state)
  if err then
    action_status = err
  end
  show_conversation()
end

function M.abort()
  if not conversation or action then
    return
  end
  action, action_status = "abort", "Stopping agent…"
  show_conversation()
  action_cancel = client:abort_agent(conversation.id, function(err)
    action_cancel, action = nil, nil
    if not err then
      stop()
      conversation.status = "STOPPED"
      refresh_messages(conversation)
    end
    action_status = err or "Agent stopped"
    show_conversation()
  end)
end

local function open_diff(items, title, origin)
  vim.fn.setqflist({}, " ", { items = items, title = title })
  require("oligarchy.diff").show(items)
  if #items == 0 then
    return
  end
  close_composer()
  vim.api.nvim_set_current_win(origin)
  vim.cmd("botright new")
  vim.wo.signcolumn = "auto:2"
  local editor = vim.api.nvim_get_current_win()
  for _, window in ipairs(vim.api.nvim_tabpage_list_wins(0)) do
    if window ~= editor then
      -- Hide file buffers so unsaved edits survive closing their windows.
      vim.api.nvim_win_call(window, function()
        vim.cmd("hide close")
      end)
    end
  end
  vim.cmd("cc 1")
  vim.cmd("botright copen")
end

function M.local_diff()
  if not local_view or action then
    return
  end
  local origin = vim.fn.bufwinid(buffer)
  action = "diff"
  show_local("Reading local diff…")
  action_cancel = require("oligarchy.local_diff").collect(root, skip_files, function(err, items)
    action, action_cancel = nil, nil
    if err then
      show_local(err)
      return
    end
    show_local(tostring(#items) .. " diff hunks in quickfix")
    open_diff(items, "Oligarchy local diff", origin)
  end)
end

function M.pr(diff)
  if not conversation or action then
    return
  end
  local origin = vim.fn.bufwinid(buffer)
  action, action_status = "pr", "Getting current PR…"
  show_conversation()
  action_cancel = client:get_agent(conversation.id, function(err, agent)
    action_cancel = nil
    local url = agent and type(agent.target) == "table" and agent.target.prUrl
    local function done(message)
      action, action_cancel = nil, nil
      action_status = message
      show_conversation()
    end
    if err then
      done(err)
      return
    end
    if not require("oligarchy.github").pr(url) then
      done("No GitHub PR for this job")
      return
    end
    if not diff then
      local ok, result, failure = pcall(open_url, url)
      done(
        ok and not failure and "Opened PR in browser"
          or ("Could not open browser: " .. tostring(ok and failure or result))
      )
      return
    end
    action_status = "Fetching PR diff…"
    show_conversation()
    action_cancel = require("oligarchy.github").diff(root, url, http, function(failure, patch)
      if failure then
        done(failure)
        return
      end
      local ok, items = pcall(require("oligarchy.diff").hunks, patch, root, skip_files)
      if not ok then
        done("Could not parse PR diff")
        return
      end
      done(tostring(#items) .. " diff hunks in quickfix")
      open_diff(items, "Oligarchy PR diff", origin)
    end)
  end)
end

function M.push_review()
  if
    vim.api.nvim_get_current_buf() ~= buffer
    or local_view
    or action
    or archiving
    or close_popup
  then
    return
  end
  stop()
  action = "review"
  local owned = buffer
  local function update(message)
    action_status = message
    if conversation then
      show_conversation()
    else
      show_list(message)
    end
  end
  update("Preparing Push & Review…")
  action_cancel = start_review(
    { root = root, client = client, progress = update },
    vim.schedule_wrap(function(err, agent, result)
      if buffer ~= owned then
        return
      end
      action, action_cancel = nil, nil
      if err then
        if result.branch then
          err = err .. "\nLocal review branch: " .. result.branch
        end
        update(err)
        if conversation then
          start_refresh()
        end
        return
      end
      table.insert(agents, 1, agent)
      if #agents > 10 then
        table.remove(agents)
      end
      show_list("Review started: " .. result.branch)
    end)
  )
end

function M.back()
  if archiving or action == "review" or not (conversation or local_view) then
    return
  end
  stop()
  show_list()
end

function M.enter()
  if action == "review" or local_view then
    return
  end
  if conversation then
    M.fold()
    return
  end
  if archiving or close_popup then
    return
  end
  local agent = rows[vim.api.nvim_win_get_cursor(0)[1]]
  if agent == local_entry then
    stop()
    rows = {}
    local_view = true
    show_local()
  elseif agent then
    load_conversation(agent)
  end
end

function M.archive()
  if archiving or conversation or close_popup or action then
    return
  end
  local agent = rows[vim.api.nvim_win_get_cursor(0)[1]]
  if not agent or agent == local_entry then
    return
  end
  close_popup = require("oligarchy.confirm").archive(agent.name, function(confirmed)
    close_popup = nil
    if not confirmed then
      return
    end
    stop()
    archiving = true
    rows = {}
    render({ "Archiving " .. agent.name:gsub("[\r\n]", " ") .. "…" })
    cancel = client:archive_agent(agent.id, function(err)
      cancel = nil
      archiving = false
      if not buffer or not vim.api.nvim_buf_is_valid(buffer) then
        return
      end
      if not err then
        agents = vim.tbl_filter(function(item)
          return item.id ~= agent.id
        end, agents)
      end
      show_list(err)
    end)
  end)
end

function M.refresh()
  if archiving or close_popup or action then
    return
  end
  if not buffer or not vim.api.nvim_buf_is_valid(buffer) then
    M.open()
    return
  end
  if conversation then
    load_conversation(conversation)
    return
  end
  if local_view then
    M.local_diff()
    return
  end
  stop()
  show_list("Loading Cursor cloud jobs…")
  vim.b[buffer].oligarchy_agents = nil
  cancel = client:get_cloud_agents(function(err, result)
    cancel = nil
    if not buffer or not vim.api.nvim_buf_is_valid(buffer) then
      return
    end
    if err then
      show_list(err)
      return
    end
    agents = result
    show_list()
  end)
end

function M.open()
  require("oligarchy.diff").clear()
  if buffer and vim.api.nvim_buf_is_valid(buffer) then
    local window = vim.fn.bufwinid(buffer)
    if window ~= -1 then
      vim.api.nvim_set_current_win(window)
      M.refresh()
      return
    end
  else
    buffer = vim.api.nvim_create_buf(false, true)
    vim.api.nvim_buf_set_name(buffer, "oligarchy://cloud-jobs")
    vim.bo[buffer].bufhidden = "wipe"
    vim.bo[buffer].swapfile = false
    vim.bo[buffer].filetype = "oligarchy"
    vim.keymap.set("n", "<CR>", M.enter, { buffer = buffer, desc = "Open conversation" })
    vim.keymap.set("n", "P", M.push_review, { buffer = buffer, desc = "Push & Review" })
    vim.keymap.set("n", "<BS>", M.back, { buffer = buffer, desc = "Back to jobs" })
    vim.keymap.set("n", "<C-b>", M.back, { buffer = buffer, desc = "Back to jobs" })
    vim.keymap.set("n", "a", function()
      if conversation then
        M.abort()
      else
        M.archive()
      end
    end, { buffer = buffer, desc = "Archive job / abort conversation" })
    vim.keymap.set("n", "g", function()
      M.pr(false)
    end, { buffer = buffer })
    vim.keymap.set("n", "d", function()
      if local_view then
        M.local_diff()
      else
        M.pr(true)
      end
    end, { buffer = buffer })
    vim.keymap.set("n", "J", function()
      M.jump(1)
    end, { buffer = buffer, desc = "Next conversation point" })
    vim.keymap.set("n", "K", function()
      M.jump(-1)
    end, { buffer = buffer, desc = "Previous conversation point" })
    vim.keymap.set("n", "za", function()
      M.fold()
    end, { buffer = buffer })
    vim.keymap.set("n", "zc", function()
      M.fold(true)
    end, { buffer = buffer })
    vim.keymap.set("n", "zo", function()
      M.fold(false)
    end, { buffer = buffer })
    vim.keymap.set("n", "i", M.prompt, { buffer = buffer, desc = "Focus prompt" })
    vim.keymap.set("n", "<C-CR>", M.send, { buffer = buffer, desc = "Send prompt to Cursor" })
    vim.keymap.set("n", "r", M.refresh, { buffer = buffer, desc = "Refresh" })
    vim.keymap.set("n", "q", "<cmd>close<cr>", { buffer = buffer, desc = "Close cloud jobs" })
    vim.api.nvim_create_autocmd("BufWipeout", {
      buffer = buffer,
      once = true,
      callback = function()
        stop()
        close_composer(true)
        if close_popup then
          -- Closing the float here can reenter and interrupt the parent's wipeout.
          close_popup(true)
          close_popup = nil
        end
        buffer, conversation = nil, nil
        local_view = false
        archiving = false
        agents, rows = {}, {}
      end,
    })
  end
  vim.cmd("botright vsplit")
  vim.api.nvim_win_set_buf(0, buffer)
  vim.wo.wrap = false
  M.refresh()
end

function M.setup(options)
  stop()
  close_composer()
  if close_popup then
    close_popup()
    close_popup = nil
  end
  options = options or {}
  refresh_clock, refresh_timer = options.refresh_clock, options.refresh_timer
  root = options.root or root
  local_summary, summary_error = nil, nil
  skip_files = options.skip_files or {}
  start_review = options.start_review or require("oligarchy.review").start
  http = options.http or require("oligarchy.cursor.http").request
  client = require("oligarchy.cursor").new({ root = root, http = http })
  cache = require("oligarchy.cache").new(root, options.cache_dir)
  open_url = options.open_url or vim.ui.open
  sync_branch = options.sync_branch
    or function(id, callback)
      return require("oligarchy.branch").sync(root, client, id, callback)
    end
  local group = vim.api.nvim_create_augroup("OligarchyConversation", { clear = true })
  vim.api.nvim_create_autocmd({ "WinResized", "VimResized" }, {
    group = group,
    callback = function()
      if composer then
        composer.resize()
      end
      show_conversation()
    end,
  })
  conversation = nil
  local_view = false
  archiving = false
  vim.api.nvim_create_user_command(
    "OligarchyJobs",
    M.open,
    { desc = "Show recent Cursor cloud jobs" }
  )
  vim.keymap.set("n", "<leader>C", M.open, { desc = "Open Cursor cloud jobs" })
end

return M
