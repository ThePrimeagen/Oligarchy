local Plugin = require("oligarchy")
local S = require("support")

describe("active conversation refresh", function()
  local root, http, buffer, token, now, timers, branches, review_done

  local function advance(milliseconds)
    now = now + milliseconds
    for _, timer in ipairs(vim.list_slice(timers)) do
      if not timer.closed then
        timer.tick()
      end
    end
    local drained = false
    vim.schedule(function()
      drained = true
    end)
    S.wait(function()
      return drained
    end)
  end

  local function enter(status)
    Plugin.open()
    S.request(http, 1)
    http:respond(1, { items = { S.agent("first", nil, status) } })
    buffer = vim.api.nvim_get_current_buf()
    S.wait(function()
      return vim.b[buffer].oligarchy_agents ~= nil
    end)
    S.select("Job first")
    Plugin.enter()
    S.request(http, 2)
  end

  local function history(index, text)
    http:respond(index, {
      messages = { { id = "answer", type = "assistant_message", text = text } },
    })
    S.wait(function()
      local messages = vim.b[buffer].oligarchy_conversation
      return messages and messages[1] and messages[1].text == text
    end)
  end

  local function run_status(index, status)
    assert.equals("https://api.cursor.com/v0/agents/first", S.request(http, index).url)
    http:respond(index, { id = "first", status = status })
    advance(0)
  end

  before_each(function()
    root, http = S.project(), S.http()
    token = vim.env.CURSOR_API_TOKEN
    vim.env.CURSOR_API_TOKEN = nil
    now, timers, branches = 0, {}, {}
    Plugin.setup({
      root = root,
      http = http.request,
      cache_dir = root .. "/cache",
      start_review = function(_, callback)
        review_done = callback
        return function() end
      end,
      refresh_clock = function()
        return now
      end,
      refresh_timer = function()
        local timer = {}
        function timer:start(_, _, callback)
          self.tick = callback
        end
        function timer:stop() end
        function timer:close()
          self.closed = true
        end
        table.insert(timers, timer)
        return timer
      end,
      sync_branch = function(_, callback)
        local branch = { done = callback }
        table.insert(branches, branch)
        return function()
          branch.cancelled = true
        end
      end,
    })
  end)

  after_each(function()
    vim.cmd("stopinsert")
    if buffer and vim.api.nvim_buf_is_valid(buffer) then
      vim.api.nvim_buf_delete(buffer, { force = true })
    end
    vim.env.CURSOR_API_TOKEN = token
    vim.fn.delete(root, "rf")
  end)

  it("refreshes history and run status every five seconds without fetching the branch", function()
    enter("ACTIVE")
    history(2, "First response")
    branches[1].done(nil, "cursor/topic", "RUNNING")
    advance(4999)
    assert.equals(2, #http.requests)
    advance(1)
    S.request(http, 3)
    assert.equals(1, #branches)
    run_status(4, "RUNNING")
    history(3, "New response")
    advance(5000)
    S.request(http, 5)
    run_status(6, "RUNNING")
    assert.equals(1, #branches)
  end)

  it("waits for slow requests and retries failed refreshes without overlap", function()
    enter("ACTIVE")
    advance(15000)
    assert.equals(2, #http.requests)
    assert.is_not_true(http.requests[2].cancelled)
    history(2, "Cached response")
    advance(100)
    assert.equals(2, #http.requests) -- Branch fetch is still pending.
    branches[1].done("Branch fetch failed", nil, "RUNNING")
    advance(100)
    S.request(http, 3)
    http:fail(3, "Timed out")
    run_status(4, "RUNNING")
    S.wait(function()
      return table
        .concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n")
        :find("Timed out", 1, true)
    end)
    assert.equals("Cached response", vim.b[buffer].oligarchy_conversation[1].text)
    advance(5000)
    S.request(http, 5)
    assert.equals(1, #branches)
  end)

  it("fetches the final reply after completion and stops polling", function()
    enter("ACTIVE")
    history(2, "Still working")
    branches[1].done(nil, "cursor/topic", "RUNNING")
    advance(5000)
    S.request(http, 3)
    history(3, "Still finishing")
    run_status(4, "FINISHED")
    S.request(http, 5)
    history(5, "Final response")
    advance(20000)
    assert.equals(5, #http.requests)
    assert.is_true(timers[#timers].closed)
    assert.equals(1, #branches)
  end)

  it("does not poll idle conversations", function()
    enter("IDLE")
    history(2, "Finished")
    branches[1].done(nil, "cursor/topic", "FINISHED")
    advance(20000)
    assert.equals(2, #http.requests)
    assert.equals(0, #timers)
  end)

  it("resumes after sending and preserves a new unsent draft during refresh", function()
    enter("IDLE")
    history(2, "Finished")
    branches[1].done(nil, "cursor/topic", "FINISHED")
    Plugin.prompt()
    vim.cmd("stopinsert")
    local prompt, window = vim.api.nvim_get_current_buf(), vim.api.nvim_get_current_win()
    vim.api.nvim_buf_set_lines(prompt, 0, -1, false, { "Please continue" })
    Plugin.send()
    S.request(http, 3)
    http:respond(3, { id = "first" })
    S.request(http, 4)
    history(4, "Working again")
    branches[2].done(nil, "cursor/topic", "RUNNING")
    vim.api.nvim_buf_set_lines(prompt, 0, -1, false, { "Unsent draft", "Second line" })
    advance(5000)
    S.request(http, 5)
    run_status(6, "RUNNING")
    history(5, "New reply")
    assert.equals(2, #branches) -- Entry and send; no automatic branch fetch.
    assert.equals(window, vim.api.nvim_get_current_win())
    assert.same({ "Unsent draft", "Second line" }, vim.api.nvim_buf_get_lines(prompt, 0, -1, false))
  end)

  it("waits for actions and stops polling after a successful abort", function()
    enter("ACTIVE")
    history(2, "Working")
    branches[1].done(nil, "cursor/topic", "RUNNING")
    Plugin.abort()
    S.request(http, 3)
    advance(10000)
    assert.equals(3, #http.requests)
    assert.is_false(http.requests[3].cancelled)
    http:respond(3, { id = "first" })
    S.request(http, 4)
    history(4, "Stopped")
    advance(10000)
    assert.equals(4, #http.requests)
    assert.is_true(timers[1].closed)
  end)

  it("cancels polling on navigation and ignores an already queued tick", function()
    enter("ACTIVE")
    history(2, "Answer")
    branches[1].done(nil, "cursor/topic", "RUNNING")
    now = 5000
    timers[1].tick()
    Plugin.back()
    advance(0)
    assert.is_true(timers[1].closed)
    assert.equals(2, #http.requests)
  end)

  it("resumes polling after Push & Review is cancelled or fails", function()
    enter("ACTIVE")
    history(2, "Working")
    branches[1].done(nil, "cursor/topic", "RUNNING")
    Plugin.push_review()
    assert.is_true(timers[1].closed)
    review_done("Push & Review cancelled", nil, {})
    S.wait(function()
      return #timers == 2
    end)
    advance(5000)
    S.request(http, 3)
    assert.equals(1, #branches)
  end)

  it("cancels the timer and requests when the pane closes", function()
    enter("ACTIVE")
    history(2, "Working")
    branches[1].done(nil, "cursor/topic", "RUNNING")
    advance(5000)
    S.request(http, 4)
    vim.api.nvim_buf_delete(buffer, { force = true })
    advance(10000)
    assert.is_true(timers[#timers].closed)
    assert.is_true(http.requests[3].cancelled)
    assert.is_true(http.requests[4].cancelled)
    assert.equals(4, #http.requests)
  end)
end)
