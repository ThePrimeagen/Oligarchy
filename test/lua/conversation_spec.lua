local Plugin = require("oligarchy")
local S = require("support")
local function press(key)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(key, true, false, true), "xt", false)
end
local function content(buf)
  return table.concat(vim.api.nvim_buf_get_lines(buf, 0, -1, false), "\n")
end

describe("conversation controls and persistence", function()
  local root, http, buffer, opened, token
  local messages = {
    { id = "u1", type = "user_message", text = "User request" },
    { id = "a1", type = "assistant_message", text = "First answer\nSecond answer" },
  }
  local function enter()
    Plugin.open()
    local n = #http.requests
    S.request(http, n + 1)
    http:respond(n + 1, { items = { S.agent("first") } })
    buffer = vim.api.nvim_get_current_buf()
    S.wait(function()
      return vim.b[buffer].oligarchy_agents ~= nil
    end)
    press("<CR>")
    S.request(http, n + 2)
    return n + 2
  end
  before_each(function()
    root = S.project()
    http = S.http()
    token = vim.env.CURSOR_API_TOKEN
    vim.env.CURSOR_API_TOKEN = nil
    opened = {}
    Plugin.setup({
      sync_branch = function()
        return function() end
      end,
      root = root,
      http = http.request,
      cache_dir = root .. "/cache",
      open_url = function(url)
        table.insert(opened, url)
      end,
    })
  end)
  after_each(function()
    if buffer and vim.api.nvim_buf_is_valid(buffer) then
      vim.api.nvim_buf_delete(buffer, { force = true })
    end
    vim.cmd("silent! cclose")
    vim.fn.setqflist({}, "f")
    vim.env.CURSOR_API_TOKEN = token
    vim.fn.delete(root, "rf")
  end)
  it(
    "collapses inferred thoughts by default and persists expanding them across reloads and appends",
    function()
      local history = {
        { id = "u1", type = "user_message", text = "User request" },
        { id = "a1", type = "assistant_message", text = "Checking details" },
        { id = "a2", type = "assistant_message", text = "Running tests" },
        { id = "a3", type = "assistant_message", text = "Finished the task" },
      }
      local n = enter()
      http:respond(n, { messages = history })
      S.wait(function()
        return vim.b[buffer].oligarchy_conversation ~= nil
      end)
      local boxes = vim.b[buffer].oligarchy_boxes
      assert.equals(3, #boxes)
      assert.equals("thoughts", boxes[2].kind)
      assert.equals(2, boxes[2].count)
      assert.is_true(boxes[2].closed)
      assert.is_nil(content(buffer):find("Checking details", 1, true))
      assert.is_nil(content(buffer):find("Running tests", 1, true))
      assert.matches("Finished the task", content(buffer), 1, true)
      local cached = require("oligarchy.cache").new(root, root .. "/cache").read("first")
      assert.is_true(cached.closed[boxes[2].id])
      vim.api.nvim_win_set_cursor(0, { boxes[2].line, 0 })
      press("<CR>")
      assert.matches("Checking details", content(buffer), 1, true)
      assert.matches("Running tests", content(buffer), 1, true)
      vim.api.nvim_buf_delete(buffer, { force = true })
      Plugin.setup({
        root = root,
        http = http.request,
        cache_dir = root .. "/cache",
        sync_branch = function()
          return function() end
        end,
      })
      n = enter()
      assert.matches("Checking details", content(buffer), 1, true)
      table.insert(history, { id = "a4", type = "assistant_message", text = "Updated result" })
      http:respond(n, { messages = history })
      S.wait(function()
        return #vim.b[buffer].oligarchy_conversation == 5
      end)
      boxes = vim.b[buffer].oligarchy_boxes
      assert.equals(3, boxes[2].count)
      assert.is_false(boxes[2].closed)
      assert.matches("Updated result", content(buffer), 1, true)
      vim.api.nvim_win_set_cursor(0, { boxes[2].line, 0 })
      press("<CR>")
      press("<BS>")
      press("<CR>")
      assert.is_nil(content(buffer):find("Checking details", 1, true))
      assert.matches("Updated result", content(buffer), 1, true)
    end
  )
  it("jumps between user, collapsed thoughts, output and the next user with J and K", function()
    local n = enter()
    http:respond(n, {
      messages = {
        { id = "u1", type = "user_message", text = "Request" },
        { id = "a1", type = "assistant_message", text = "Checking details" },
        { id = "a2", type = "assistant_message", text = "Output" },
        { id = "u2", type = "user_message", text = "Follow-up" },
      },
    })
    S.wait(function()
      return vim.b[buffer].oligarchy_conversation ~= nil
    end)
    local points = vim.b[buffer].oligarchy_boxes
    vim.api.nvim_win_set_cursor(0, { 1, 0 })
    for _, point in ipairs(points) do
      press("J")
      assert.equals(point.line, vim.api.nvim_win_get_cursor(0)[1])
    end
    press("J")
    assert.equals(points[#points].line, vim.api.nvim_win_get_cursor(0)[1])
    for index = #points - 1, 1, -1 do
      press("K")
      assert.equals(points[index].line, vim.api.nvim_win_get_cursor(0)[1])
    end
    press("K")
    assert.equals(points[1].line, vim.api.nvim_win_get_cursor(0)[1])
    press("J")
    press("<CR>") -- Expanding thoughts changes subsequent point positions.
    assert.matches("Checking details", content(buffer), 1, true)
    points = vim.b[buffer].oligarchy_boxes
    press("J")
    assert.equals(points[3].line, vim.api.nvim_win_get_cursor(0)[1])
    press("K")
    assert.equals(points[2].line, vim.api.nvim_win_get_cursor(0)[1])
    assert.equals(n, #http.requests)
  end)
  it("navigates from inside a message, honors counts, and leaves loading views alone", function()
    local n = enter()
    local cursor = vim.api.nvim_win_get_cursor(0)
    press("J")
    press("K")
    assert.same(cursor, vim.api.nvim_win_get_cursor(0))
    http:respond(n, {
      messages = {
        { id = "u1", type = "user_message", text = "Request" },
        { id = "a1", type = "assistant_message", text = "Thinking" },
        { id = "a2", type = "assistant_message", text = "Output" },
      },
    })
    S.wait(function()
      return vim.b[buffer].oligarchy_conversation ~= nil
    end)
    local points = vim.b[buffer].oligarchy_boxes
    for row, line in ipairs(vim.api.nvim_buf_get_lines(buffer, 0, -1, false)) do
      if line:find("Request", 1, true) then
        vim.api.nvim_win_set_cursor(0, { row, 0 })
        break
      end
    end
    press("K")
    assert.equals(points[1].line, vim.api.nvim_win_get_cursor(0)[1])
    press("2J")
    assert.equals(points[3].line, vim.api.nvim_win_get_cursor(0)[1])
    press("9K")
    assert.equals(points[1].line, vim.api.nvim_win_get_cursor(0)[1])
    press("<BS>")
    cursor = vim.api.nvim_win_get_cursor(0)
    press("J")
    press("K")
    assert.same(cursor, vim.api.nvim_win_get_cursor(0))
  end)
  it("keeps cached content visible on refresh failure and always requests updates", function()
    local n = enter()
    http:respond(n, { messages = messages })
    S.wait(function()
      return vim.b[buffer].oligarchy_conversation ~= nil
    end)
    press("<BS>")
    press("<CR>")
    assert.matches("User request", content(buffer), 1, true)
    S.request(http, n + 1)
    http:respond(n + 1, {}, 500)
    S.wait(function()
      return content(buffer):find("Cursor HTTP 500", 1, true)
    end)
    assert.matches("First answer", content(buffer), 1, true)
    press("r")
    assert.matches("First answer", content(buffer), 1, true)
    S.request(http, n + 2)
  end)
  it("aborts once without archiving and displays failure without losing messages", function()
    local n = enter()
    http:respond(n, { messages = messages })
    S.wait(function()
      return vim.b[buffer].oligarchy_conversation ~= nil
    end)
    press("a")
    local request = S.request(http, n + 1)
    assert.equals("POST", request.method)
    assert.equals("https://api.cursor.com/v0/agents/first/stop", request.url)
    press("a")
    assert.equals(n + 1, #http.requests)
    http:respond(n + 1, {}, 409)
    S.wait(function()
      return content(buffer):find("Cursor HTTP 409", 1, true)
    end)
    assert.matches("First answer", content(buffer), 1, true)
    press("a")
    S.request(http, n + 2)
    http:respond(n + 2, { id = "first" })
    S.wait(function()
      return content(buffer):find("Agent stopped", 1, true)
    end)
  end)
  it("opens the current PR and appends every diff hunk to quickfix", function()
    local n = enter()
    http:respond(n, { messages = messages })
    S.wait(function()
      return vim.b[buffer].oligarchy_conversation ~= nil
    end)
    press("g")
    assert.equals("https://api.cursor.com/v0/agents/first", S.request(http, n + 1).url)
    local metadata =
      { id = "first", target = { prUrl = "https://github.com/ThePrimeagen/Oligarchy/pull/12" } }
    http:respond(n + 1, metadata)
    S.wait(function()
      return #opened == 1
    end)
    assert.equals(metadata.target.prUrl, opened[1])
    vim.fn.setqflist({ { filename = root .. "/keep.lua", lnum = 1, text = "keep" } })
    press("d")
    S.request(http, n + 2)
    http:respond(n + 2, metadata)
    local request = S.request(http, n + 3)
    assert.equals("https://api.github.com/repos/ThePrimeagen/Oligarchy/pulls/12", request.url)
    assert.equals("application/vnd.github.diff", request.headers.Accept)
    assert.is_nil(request.headers.Authorization) -- Cursor credentials never go to GitHub.
    http:respond(
      n + 3,
      "diff --git a/file.lua b/file.lua\n--- a/file.lua\n+++ b/file.lua\n@@ -1 +1 @@\n-old\n+new\n@@ -10,0 +11,2 @@\n+two\n+three\n"
    )
    S.wait(function()
      return #vim.fn.getqflist() == 3
    end)
    local qf = vim.fn.getqflist()
    assert.equals("keep", qf[1].text)
    assert.equals(1, qf[2].lnum)
    assert.equals(11, qf[3].lnum)
    assert.equals(root .. "/file.lua", vim.api.nvim_buf_get_name(qf[2].bufnr))
    assert.matches("+new", qf[2].user_data.diff, 1, true)
  end)
  it("reports missing PRs and ignores actions after leaving the conversation", function()
    local n = enter()
    http:respond(n, { messages = messages })
    S.wait(function()
      return vim.b[buffer].oligarchy_conversation ~= nil
    end)
    press("g")
    S.request(http, n + 1)
    http:respond(n + 1, { id = "first", target = {} })
    S.wait(function()
      return content(buffer):find("No GitHub PR", 1, true)
    end)
    assert.equals(0, #opened)
    press("g")
    S.request(http, n + 2)
    press("<BS>")
    http:respond(n + 2, { id = "first", target = { prUrl = "https://github.com/o/r/pull/1" } })
    vim.wait(20, function()
      return false
    end)
    assert.equals(0, #opened)
    assert.is_true(http.requests[n + 2].cancelled)
  end)
  it("starts branch and history refreshes concurrently on every entry and r", function()
    local pending, cancelled = {}, {}
    Plugin.setup({
      root = root,
      http = http.request,
      cache_dir = root .. "/cache",
      sync_branch = function(id, callback)
        assert.equals("first", id)
        table.insert(pending, callback)
        local n = #pending
        return function()
          cancelled[n] = true
        end
      end,
    })
    local n = enter()
    assert.equals(1, #pending) -- History is still pending.
    http:respond(n, { messages = messages })
    S.wait(function()
      return vim.b[buffer].oligarchy_conversation ~= nil
    end)
    assert.matches("First answer", content(buffer), 1, true)
    for row, line in ipairs(vim.api.nvim_buf_get_lines(buffer, 0, -1, false)) do
      if line:find("First answer", 1, true) then
        vim.api.nvim_win_set_cursor(0, { row, 0 })
        break
      end
    end
    local reading = vim.api.nvim_get_current_line()
    pending[1](nil, "topic")
    assert.equals(reading, vim.api.nvim_get_current_line())
    assert.matches("Branch updated: topic", content(buffer), 1, true)
    press("r")
    S.request(http, n + 1)
    assert.equals(2, #pending)
    pending[2]("Branch fetch failed\nUnable to access remote")
    http:respond(n + 1, { messages = messages })
    S.wait(function()
      return content(buffer):find("Conversation up to date", 1, true)
    end)
    assert.matches("Branch fetch failed", content(buffer), 1, true)
    assert.matches("Unable to access remote", content(buffer), 1, true)
    assert.is_false(vim.bo[buffer].modifiable)
    press("<BS>")
    press("<CR>")
    S.request(http, n + 2)
    assert.equals(3, #pending)
    press("<BS>")
    assert.is_true(cancelled[3])
  end)
end)
