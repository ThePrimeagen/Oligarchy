-- Explicitly opt in: these are real authenticated, read-only Cursor API calls.
assert(vim.env.OLIGARCHY_LIVE_TEST == "1", "Set OLIGARCHY_LIVE_TEST=1 to run live Cursor tests")
local root = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":p:h:h:h")
local Http = require("oligarchy.cursor.http")
local Plugin = require("oligarchy")

describe("live Cursor jobs pane", function()
  local cache_dir
  before_each(function()
    cache_dir = vim.fn.tempname()
  end)
  after_each(function()
    vim.fn.delete(cache_dir, "rf")
    for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
      if vim.api.nvim_buf_get_name(buffer) == "oligarchy://cloud-jobs" then
        vim.api.nvim_buf_delete(buffer, { force = true })
      end
    end
  end)

  it("loads recent project jobs in under three seconds on open and two refreshes", function()
    local requests = 0
    Plugin.setup({
      root = root,
      cache_dir = cache_dir,
      http = function(request, callback)
        requests = requests + 1
        return Http.request(request, callback)
      end,
    })
    for attempt = 1, 3 do
      local started = vim.uv.hrtime()
      local previous_requests = requests
      if attempt == 1 then
        vim.cmd("OligarchyJobs")
      else
        vim.api.nvim_feedkeys("r", "xt", false)
      end
      local buffer = vim.api.nvim_get_current_buf()
      assert.is_true(
        vim.wait(6000, function()
          return vim.b[buffer].oligarchy_agents ~= nil
        end, 5),
        "Live Cursor request timed out"
      )
      local elapsed = (vim.uv.hrtime() - started) / 1e6
      local agents = vim.b[buffer].oligarchy_agents
      if not agents then
        error(table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n"))
      end
      assert.is_true(#agents > 0, "No jobs for this project in the latest ten account jobs")
      assert.is_true(#agents <= 10)
      local lines = table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n")
      for _, agent in ipairs(agents) do
        assert.is_string(agent.id)
        assert.is_string(agent.status)
        assert.matches(agent.id, lines, 1, true)
        assert.is_table(agent.repos)
      end
      print(
        string.format(
          "Live load %d: %d jobs, %d HTTP requests, %.0f ms",
          attempt,
          #agents,
          requests - previous_requests,
          elapsed
        )
      )
      assert.equals(
        1,
        requests - previous_requests,
        "Expected repository details in the list response"
      )
      assert.is_true(
        elapsed < 3000,
        string.format("Live load took %.0f ms (budget: 3000 ms)", elapsed)
      )
    end
  end)
  it("loads the selected job's real conversation into the same window", function()
    Plugin.setup({ root = root, cache_dir = cache_dir })
    vim.cmd("OligarchyJobs")
    local buffer = vim.api.nvim_get_current_buf()
    local window = vim.api.nvim_get_current_win()
    assert.is_true(vim.wait(6000, function()
      return vim.b[buffer].oligarchy_agents ~= nil
    end, 5))
    assert.is_true(#vim.b[buffer].oligarchy_agents > 0)
    local started = vim.uv.hrtime()
    local enter = vim.api.nvim_replace_termcodes("<CR>", true, false, true)
    local function select_job()
      local id = vim.b[buffer].oligarchy_agents[1].id
      for row, line in ipairs(vim.api.nvim_buf_get_lines(buffer, 0, -1, false)) do
        if line == "  " .. id then
          vim.api.nvim_win_set_cursor(0, { row, 0 })
          return
        end
      end
    end
    select_job()
    vim.api.nvim_feedkeys(enter, "xt", false)
    assert.is_true(vim.wait(6000, function()
      local lines = vim.api.nvim_buf_get_lines(buffer, 0, -1, false)
      return table.concat(lines, "\n"):find("Conversation up to date", 1, true) ~= nil
    end, 5))
    local messages = vim.b[buffer].oligarchy_conversation
    if not messages then
      error(table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n"))
    end
    assert.is_true(#messages > 0)
    assert.equals(window, vim.api.nvim_get_current_win())
    assert.equals(buffer, vim.api.nvim_get_current_buf())
    print(
      string.format(
        "Live conversation: %d messages, %.0f ms",
        #messages,
        (vim.uv.hrtime() - started) / 1e6
      )
    )
    assert.is_true(
      vim.wait(35000, function()
        local text = table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n")
        return not text:find("Fetching branch", 1, true)
      end, 20),
      "Live branch fetch timed out"
    )
    local text = table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n")
    assert.is_true(
      text:find("Branch updated:", 1, true) ~= nil,
      "Live branch fetch did not complete successfully"
    )
    local back = vim.api.nvim_replace_termcodes("<BS>", true, false, true)
    vim.api.nvim_feedkeys(back, "xt", false)
    select_job()
    local cached_at = vim.uv.hrtime()
    vim.api.nvim_feedkeys(enter, "xt", false)
    assert.equals(#messages, #vim.b[buffer].oligarchy_conversation)
    print(
      string.format(
        "Cached conversation: %.0f ms; live branch fetch succeeded",
        (vim.uv.hrtime() - cached_at) / 1e6
      )
    )
  end)
end)
