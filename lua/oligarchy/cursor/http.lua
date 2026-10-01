local M = {}

--- request = { method, url, headers, env }; callback(err, { status, body }).
--- Returns a cancel function. No Cursor-specific response handling lives here.
function M.request(request, callback)
  local cancelled = false
  local process
  local headers = {}
  for name, value in pairs(request.headers) do
    table.insert(headers, name .. ": " .. value)
  end
  -- Headers go through stdin so credentials never appear in process arguments.
  local ok, result = pcall(
    vim.system,
    {
      "curl",
      "--disable",
      "--silent",
      "--show-error",
      "--connect-timeout",
      "3",
      "--max-time",
      "5",
      "--request",
      request.method,
      "--header",
      "@-",
      "--write-out",
      "\n%{http_code}",
      "--url",
      request.url,
    },
    { text = true, env = request.env, stdin = table.concat(headers, "\n") .. "\n" },
    vim.schedule_wrap(function(output)
      process = nil
      if cancelled then
        return
      end
      if output.code ~= 0 then
        callback("Cursor request failed: " .. vim.trim(output.stderr))
        return
      end
      local body, status = output.stdout:match("^(.*)\n(%d%d%d)$")
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
