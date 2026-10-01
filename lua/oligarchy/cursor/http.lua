local M = {}

--- request = { method, url, headers, env, body? }; callback(err, { status, body }).
--- Returns a cancel function. No Cursor-specific response handling lives here.
--- run optionally replaces vim.system at the process boundary.
function M.request(request, callback, run)
  run = run or vim.system
  local cancelled = false
  local process
  local started = vim.uv.hrtime()
  local directory = vim.fn.stdpath("state") .. "/oligarchy"
  local log_path = directory .. "/http.log"
  local endpoint = request.url:gsub("[?#].*$", ""):gsub("(://)[^/]*@", "%1")
  local function record(code, status)
    local fd
    local ok = pcall(function()
      vim.fn.mkdir(directory, "p", 448) -- 0700
      fd = assert(vim.uv.fs_open(log_path, "a", 384)) -- 0600
      -- Never log headers, bodies, environment, query strings or curl stderr.
      local line = vim.json.encode({
        time = os.date("!%Y-%m-%dT%H:%M:%SZ"),
        method = request.method,
        url = endpoint,
        elapsed_ms = math.floor((vim.uv.hrtime() - started) / 1000000),
        exit_code = code,
        status = status,
        cancelled = cancelled,
      }) .. "\n"
      assert(vim.uv.fs_write(fd, line, -1) == #line)
    end)
    if fd then
      ok = vim.uv.fs_close(fd) and ok
    end
    if not ok then
      vim.notify("Could not write HTTP log: " .. log_path, vim.log.levels.WARN)
    end
  end
  local function quote(value)
    return '"'
      .. value:gsub("\\", "\\\\"):gsub('"', '\\"'):gsub("\n", "\\n"):gsub("\r", "\\r")
      .. '"'
  end
  local config = {}
  for name, value in pairs(request.headers) do
    table.insert(config, "header = " .. quote(name .. ": " .. value))
  end
  if request.body then
    table.insert(config, "data-binary = " .. quote(request.body))
  end
  -- Both credentials and prompt text travel through stdin, never process arguments.
  local ok, result = pcall(
    run,
    {
      "curl",
      "--disable",
      "--silent",
      "--show-error",
      "--connect-timeout",
      "10",
      "--max-time",
      "30",
      "--request",
      request.method,
      "--config",
      "-",
      "--write-out",
      "\n%{http_code}",
      "--url",
      request.url,
    },
    { text = true, env = request.env, stdin = table.concat(config, "\n") .. "\n" },
    vim.schedule_wrap(function(output)
      process = nil
      local body, status = output.stdout:match("^(.*)\n(%d%d%d)$")
      record(output.code, tonumber(status))
      if cancelled then
        return
      end
      if output.code ~= 0 then
        local message = "Cursor request failed: " .. vim.trim(output.stderr)
        if output.code == 28 then
          message = "Cursor request timed out: " .. request.method .. " " .. endpoint
          if request.method == "POST" then
            message = message
              .. "\nThe request may already have been accepted; refresh before retrying."
          end
        end
        callback(message .. "\nHTTP log: " .. log_path)
        return
      end
      if not body then
        callback("Cursor returned an invalid HTTP response")
        return
      end
      callback(nil, { status = tonumber(status), body = body })
    end)
  )
  if ok then
    process = result
  else
    vim.schedule(function()
      record(-1)
      if not cancelled then
        callback("Could not start curl: " .. tostring(result))
      end
    end)
  end
  return function()
    cancelled = true
    if process then
      process:kill(15)
    end
  end
end

return M
