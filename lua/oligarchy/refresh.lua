local M = {}

function M.active(status)
  return status == "ACTIVE" or status == "CREATING" or status == "RUNNING"
end

-- The clock and timer are injectable so countdowns never require real waits in tests.
function M.start(options)
  local now = options.now or function()
    return vim.uv.hrtime() / 1000000
  end
  local timer = (options.new_timer or vim.uv.new_timer)()
  local deadline, closed = now() + 5000, false
  local function tick()
    if closed then
      return
    end
    local time = now()
    local busy = options.busy()
    if time >= deadline and not busy then
      deadline = time + 5000
      options.refresh()
    end
    if not closed then
      options.display(math.max(0, math.ceil((deadline - time) / 1000)), busy, time)
    end
  end
  timer:start(0, 100, vim.schedule_wrap(tick))
  return function()
    if closed then
      return
    end
    closed = true
    timer:stop()
    timer:close()
  end
end

return M
