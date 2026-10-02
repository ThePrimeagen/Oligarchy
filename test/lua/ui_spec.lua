local Plugin = require("oligarchy")
local S = require("support")

local function text(buffer)
  return table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n")
end

local function press(key)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(key, true, false, true), "xt", false)
end

describe("Cursor jobs in Neovim", function()
  local root, http, key, source, source_window, reviews

  before_each(function()
    root = S.project()
    key = vim.env.CURSOR_API_TOKEN
    vim.env.CURSOR_API_TOKEN = nil
    http = S.http()
    reviews = {}
    Plugin.setup({
      start_review = function(options, callback)
        local call = { options = options, complete = callback }
        table.insert(reviews, call)
        return function()
          call.cancelled = true
        end
      end,
      sync_branch = function()
        return function() end
      end,
      root = root,
      cache_dir = root .. "/cache",
      http = http.request,
    })
    source = vim.api.nvim_create_buf(true, true)
    vim.api.nvim_set_current_buf(source)
    vim.api.nvim_buf_set_lines(source, 0, -1, false, { "work in progress" })
    source_window = vim.api.nvim_get_current_win()
  end)

  after_each(function()
    for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
      if vim.api.nvim_buf_get_name(buffer) == "oligarchy://cloud-jobs" then
        vim.api.nvim_buf_delete(buffer, { force = true })
      end
    end
    if vim.api.nvim_buf_is_valid(source) then
      vim.api.nvim_buf_delete(source, { force = true })
    end
    vim.env.CURSOR_API_TOKEN = key
    vim.fn.delete(root, "rf")
  end)

  it("opens jobs with leader C, preserves the editing buffer, and uses r and q", function()
    press((vim.g.mapleader or "\\") .. "C")
    local buffer = vim.api.nvim_get_current_buf()
    assert.are_not.equal(source_window, vim.api.nvim_get_current_win())
    assert.equals(source, vim.api.nvim_win_get_buf(source_window))
    assert.are.same({ "work in progress" }, vim.api.nvim_buf_get_lines(source, 0, -1, false))
    S.request(http, 1)
    http:respond(1, { items = { { id = "first", status = "ACTIVE" } } })
    S.request(http, 2)
    http:respond(2, S.agent("first"))
    S.wait(function()
      return text(buffer):find("Job first", 1, true)
    end)

    press("r")
    S.request(http, 3)
    http:respond(3, { items = {} })
    S.wait(function()
      return text(buffer):find("No recent cloud jobs", 1, true)
    end)
    assert.is_nil(text(buffer):find("Job first", 1, true))
    assert.equals(buffer, vim.api.nvim_get_current_buf())

    press("q")
    assert.is_false(vim.api.nvim_buf_is_valid(buffer))
    assert.equals(source, vim.api.nvim_get_current_buf())
    press((vim.g.mapleader or "\\") .. "C")
    S.request(http, 4)
    assert.equals("oligarchy://cloud-jobs", vim.api.nvim_buf_get_name(0))
  end)

  it("reuses the jobs view and ignores an old response after refresh", function()
    vim.cmd("OligarchyJobs")
    local buffer = vim.api.nvim_get_current_buf()
    S.request(http, 1)
    vim.cmd("OligarchyJobs")
    S.request(http, 2)
    assert.is_true(http.requests[1].cancelled)
    assert.equals(buffer, vim.api.nvim_get_current_buf())
    http:respond(2, { items = {} })
    S.wait(function()
      return text(buffer):find("No recent cloud jobs", 1, true)
    end)
    http:respond(1, { items = { { id = "stale", status = "ACTIVE" } } })
    local drained = false
    vim.schedule(function()
      drained = true
    end)
    S.wait(function()
      return drained
    end)
    assert.equals(2, #http.requests)
    assert.matches("No recent cloud jobs", text(buffer), 1, true)
  end)

  it("shows an HTTP error and lets r retry", function()
    vim.cmd("OligarchyJobs")
    local buffer = vim.api.nvim_get_current_buf()
    S.request(http, 1)
    http:respond(1, {}, 401)
    S.wait(function()
      return text(buffer):find("Cursor HTTP 401", 1, true)
    end)
    press("r")
    S.request(http, 2)
    http:respond(2, { items = {} })
    S.wait(function()
      return text(buffer):find("No recent cloud jobs", 1, true)
    end)
    assert.is_nil(text(buffer):find("Cursor HTTP 401", 1, true))
  end)

  it("shows multiline transport errors and lets r retry", function()
    vim.cmd("OligarchyJobs")
    local buffer = vim.api.nvim_get_current_buf()
    S.request(http, 1)
    http:fail(1, "Cursor request failed: certificate verification failed\nCheck the CA certificate")
    S.wait(function()
      return text(buffer):find("certificate verification failed", 1, true)
    end)
    assert.matches("Check the CA certificate", text(buffer), 1, true)
    press("r")
    S.request(http, 2)
    http:respond(2, { items = {} })
    S.wait(function()
      return text(buffer):find("No recent cloud jobs", 1, true)
    end)
    assert.is_nil(text(buffer):find("certificate verification failed", 1, true))
  end)

  it("cancels on q and keeps a late response out of a newly opened view", function()
    vim.cmd("OligarchyJobs")
    local old_buffer = vim.api.nvim_get_current_buf()
    S.request(http, 1)
    press("q")
    assert.is_true(http.requests[1].cancelled)
    assert.is_false(vim.api.nvim_buf_is_valid(old_buffer))
    vim.cmd("OligarchyJobs")
    local new_buffer = vim.api.nvim_get_current_buf()
    S.request(http, 2)
    http:respond(1, {}, 500)
    http:respond(2, { items = {} })
    S.wait(function()
      return text(new_buffer):find("No recent cloud jobs", 1, true)
    end)
    assert.is_nil(text(new_buffer):find("Cursor HTTP 500", 1, true))
  end)
  local function jobs()
    vim.cmd("OligarchyJobs")
    local buffer = vim.api.nvim_get_current_buf()
    S.request(http, 1)
    http:respond(1, { items = { S.agent("first"), S.agent("second") } })
    S.wait(function()
      return vim.b[buffer].oligarchy_agents ~= nil
    end)
    S.select("Job first")
    return buffer
  end

  it("opens the selected conversation in the same pane and returns with Ctrl-b", function()
    local buffer = jobs()
    local window = vim.api.nvim_get_current_win()
    for line, value in ipairs(vim.api.nvim_buf_get_lines(buffer, 0, -1, false)) do
      if value:find("Job second", 1, true) then
        vim.api.nvim_win_set_cursor(0, { line, 0 })
        break
      end
    end
    press("<CR>")
    assert.equals("https://api.cursor.com/v0/agents/second/conversation", S.request(http, 2).url)
    http:respond(2, {
      messages = {
        { type = "user_message", text = "Make a thing" },
        { type = "assistant_message", text = "First line\nSecond line" },
      },
    })
    S.wait(function()
      return vim.b[buffer].oligarchy_conversation ~= nil
    end)
    assert.equals(buffer, vim.api.nvim_get_current_buf())
    assert.equals(window, vim.api.nvim_get_current_win())
    assert.matches("Make a thing", text(buffer), 1, true)
    assert.matches("First line", text(buffer), 1, true)
    assert.matches("Second line", text(buffer), 1, true)
    press("<C-b>")
    assert.matches("Job first", text(buffer), 1, true)
    assert.is_nil(vim.b[buffer].oligarchy_conversation)
    assert.equals(2, #http.requests)
  end)

  it("starts Push & Review only in the Cursor buffer and shows the returned job", function()
    Plugin.push_review()
    assert.equals(0, #reviews)
    local buffer = jobs()
    press("P")
    assert.equals(1, #reviews)
    assert.equals(root, reviews[1].options.root)
    press("P")
    press("<CR>")
    press("a")
    assert.equals(1, #reviews)
    assert.equals(1, #http.requests)
    reviews[1].options.progress("Push…")
    assert.matches("Push…", text(buffer), 1, true)
    reviews[1].complete(nil, S.agent("review-job"), { branch = "review/wobbly-wombat-123abc" })
    S.wait(function()
      return text(buffer):find("Review started:", 1, true)
    end)
    assert.equals("review-job", vim.b[buffer].oligarchy_agents[1].id)
    assert.matches("review/wobbly-wombat-123abc", text(buffer), 1, true)
  end)

  it("reports Push & Review failures and cancels outstanding work when closed", function()
    local buffer = jobs()
    press("P")
    reviews[1].complete("Push failed", nil, { branch = "review/local-branch-123abc" })
    S.wait(function()
      return text(buffer):find("Push failed", 1, true)
    end)
    assert.matches("Local review branch: review/local-branch-123abc", text(buffer), 1, true)
    press("P")
    assert.equals(2, #reviews)
    press("q")
    assert.is_true(reviews[2].cancelled)
  end)

  it("ignores a conversation response after Ctrl-b", function()
    local buffer = jobs()
    press("<CR>")
    S.request(http, 2)
    press("<C-b>")
    assert.is_true(http.requests[2].cancelled)
    http:respond(2, { messages = { { type = "assistant_message", text = "stale reply" } } })
    local drained = false
    vim.schedule(function()
      drained = true
    end)
    S.wait(function()
      return drained
    end)
    assert.matches("Job first", text(buffer), 1, true)
    assert.is_nil(text(buffer):find("stale reply", 1, true))
  end)

  it("cancels the archive popup without sending a request", function()
    local buffer = jobs()
    press("a")
    local popup = vim.api.nvim_get_current_buf()
    assert.are_not.equal(buffer, popup)
    assert.matches("Archive this job?", text(popup), 1, true)
    press("<CR>") -- Cancel is initially selected.
    assert.is_false(vim.api.nvim_buf_is_valid(popup))
    assert.equals(buffer, vim.api.nvim_get_current_buf())
    assert.equals(1, #http.requests)
    assert.matches("Job first", text(buffer), 1, true)
  end)

  it("archives only after confirmation and removes only the selected job", function()
    local buffer = jobs()
    press("a")
    press("<Tab>")
    press("<CR>")
    local request = S.request(http, 2)
    assert.equals("POST", request.method)
    assert.equals("https://api.cursor.com/v1/agents/first/archive", request.url)
    press("a")
    assert.equals(2, #http.requests)
    http:respond(2, { id = "first" })
    S.wait(function()
      return #vim.b[buffer].oligarchy_agents == 1
    end)
    assert.is_nil(text(buffer):find("Job first", 1, true))
    assert.matches("Job second", text(buffer), 1, true)
  end)

  it("retains the job and shows the error when archiving fails", function()
    local buffer = jobs()
    press("a")
    press("<Tab>")
    press("<CR>")
    S.request(http, 2)
    http:respond(2, {}, 500)
    S.wait(function()
      return text(buffer):find("Cursor HTTP 500", 1, true)
    end)
    assert.matches("Job first", text(buffer), 1, true)
    assert.equals(2, #vim.b[buffer].oligarchy_agents)
  end)

  it("cancels a pending list refresh before archiving a cached job", function()
    local buffer = jobs()
    press("r")
    S.request(http, 2)
    S.select("Job first")
    press("a")
    press("<Tab>")
    press("<CR>")
    assert.equals("POST", S.request(http, 3).method)
    assert.is_true(http.requests[2].cancelled)
    http:respond(3, { id = "first" })
    S.wait(function()
      local result = vim.b[buffer].oligarchy_agents
      return result and #result == 1
    end)
    http:respond(2, { items = { S.agent("first"), S.agent("second") } })
    local drained = false
    vim.schedule(function()
      drained = true
    end)
    S.wait(function()
      return drained
    end)
    assert.equals(1, #vim.b[buffer].oligarchy_agents)
    assert.equals("second", vim.b[buffer].oligarchy_agents[1].id)
  end)

  it("closes a pending confirmation when the jobs buffer is wiped", function()
    local buffer = jobs()
    press("a")
    local popup = vim.api.nvim_get_current_win()
    vim.api.nvim_buf_delete(buffer, { force = true })
    S.wait(function()
      return not vim.api.nvim_win_is_valid(popup)
    end)
    assert.is_false(vim.api.nvim_buf_is_valid(buffer))
    assert.equals(1, #http.requests)
  end)
  it("does not start a conversation while confirmation is pending in another window", function()
    local buffer = jobs()
    local jobs_window = vim.api.nvim_get_current_win()
    press("a")
    local popup = vim.api.nvim_get_current_win()
    vim.api.nvim_set_current_win(jobs_window)
    press("<CR>")
    assert.equals(1, #http.requests)
    assert.is_nil(vim.b[buffer].oligarchy_conversation)
    vim.api.nvim_set_current_win(popup)
    press("<Tab>")
    press("<CR>")
    assert.equals("POST", S.request(http, 2).method)
    http:respond(2, { id = "first" })
    S.wait(function()
      return #vim.b[buffer].oligarchy_agents == 1
    end)
    assert.matches("Job second", text(buffer), 1, true)
  end)
end)
