local Http = require("oligarchy.cursor.http")
local S = require("support")

describe("curl HTTP transport", function()
  local calls, run, cancel, state_dir, previous_state
  before_each(function()
    previous_state = vim.env.XDG_STATE_HOME
    state_dir = vim.fn.tempname()
    vim.env.XDG_STATE_HOME = state_dir
    cancel, calls = nil, {}
    run = function(args, options, callback)
      local call = { args = args, options = options, complete = callback }
      table.insert(calls, call)
      return {
        kill = function(_, signal)
          call.signal = signal
        end,
      }
    end
  end)
  after_each(function()
    if cancel then
      cancel()
    end
    vim.env.XDG_STATE_HOME = previous_state
    vim.fn.delete(state_dir, "rf")
  end)

  it("passes private JSON and authentication through stdin and parses curl output", function()
    local done, result, failure
    local body = [[{"prompt":{"text":"say \"hello\"\nnext \\ path"}}]]
    cancel = Http.request({
      method = "POST",
      url = "http://127.0.0.1:1/followup",
      headers = { Authorization = "Basic test-token", ["Content-Type"] = "application/json" },
      body = body,
      env = { TEST_VALUE = "value" },
    }, function(err, response)
      failure, result, done = err, response, true
    end, run)
    assert.equals(1, #calls)
    local call = calls[1]
    assert.equals("curl", call.args[1])
    assert.equals("30", call.args[vim.fn.index(call.args, "--max-time") + 2])
    assert.equals("10", call.args[vim.fn.index(call.args, "--connect-timeout") + 2])
    assert.equals("POST", call.args[vim.fn.index(call.args, "--request") + 2])
    assert.equals("-", call.args[vim.fn.index(call.args, "--config") + 2])
    assert.same({ TEST_VALUE = "value" }, call.options.env)
    assert.matches([[header = "Authorization: Basic test-token"]], call.options.stdin, 1, true)
    assert.matches([[header = "Content-Type: application/json"]], call.options.stdin, 1, true)
    assert.matches(
      [[data-binary = "{\"prompt\":{\"text\":\"say \\\"hello\\\"\\nnext \\\\ path\"}}"]],
      call.options.stdin,
      1,
      true
    )
    local args = table.concat(call.args, " ")
    assert.is_nil(args:find("test-token", 1, true))
    assert.is_nil(args:find("hello", 1, true))
    -- Synthetic successful curl output, including the --write-out trailer.
    call.complete({ code = 0, stdout = '{"id":"job"}\n200', stderr = "" })
    S.wait(function()
      return done
    end)
    assert.is_nil(failure)
    assert.same({ status = 200, body = '{"id":"job"}' }, result)
    local log =
      table.concat(vim.fn.readfile(vim.fn.stdpath("state") .. "/oligarchy/http.log"), "\n")
    local entry = vim.json.decode(log)
    assert.equals("POST", entry.method)
    assert.equals(200, entry.status)
    assert.equals(0, entry.exit_code)
    assert.is_number(entry.elapsed_ms)
    assert.is_nil(log:find("test-token", 1, true))
    assert.is_nil(log:find("hello", 1, true))
  end)

  it("logs curl exit 28 and reports a timeout without retrying a POST", function()
    local done, failure
    cancel = Http.request({
      method = "POST",
      url = "http://127.0.0.1:1/followup?secret=hidden",
      headers = {},
      body = "private prompt",
    }, function(err)
      failure, done = err, true
    end, run)
    assert.equals(1, #calls)
    -- Timeout stderr captured from the original five-second regression.
    calls[1].complete({
      code = 28,
      stdout = "\n000",
      stderr = "curl: (28) Operation timed out after 5002 milliseconds with 0 bytes received",
    })
    S.wait(function()
      return done
    end)
    assert.matches("timed out", failure, 1, true)
    assert.matches("may already have been accepted", failure, 1, true)
    assert.equals(1, #calls)
    local path = vim.fn.stdpath("state") .. "/oligarchy/http.log"
    assert.matches(path, failure, 1, true)
    local log = table.concat(vim.fn.readfile(path), "\n")
    local entry = vim.json.decode(log)
    assert.equals(28, entry.exit_code)
    assert.is_nil(log:find("hidden", 1, true))
    assert.is_nil(log:find("private prompt", 1, true))
    assert.equals("rw-------", vim.fn.getfperm(path))
  end)

  it("kills a cancelled process and logs its late result without delivering it", function()
    local called = false
    cancel = Http.request({
      method = "GET",
      url = "http://127.0.0.1:1/conversation",
      headers = {},
    }, function()
      called = true
    end, run)
    assert.equals(1, #calls)
    cancel()
    assert.equals(15, calls[1].signal)
    -- Synthetic result from a process terminated before receiving a response.
    calls[1].complete({ code = 0, signal = 15, stdout = "", stderr = "" })
    local path = vim.fn.stdpath("state") .. "/oligarchy/http.log"
    S.wait(function()
      return vim.fn.filereadable(path) == 1
    end)
    assert.is_false(called)
    assert.is_true(vim.json.decode(vim.fn.readfile(path)[1]).cancelled)
  end)
end)
