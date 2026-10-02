local M = {}

function M.project()
  local root = vim.fn.tempname()
  vim.fn.mkdir(root, "p")
  assert(vim.system({ "git", "init", "--quiet", root }):wait().code == 0)
  assert(vim
    .system({
      "git",
      "-C",
      root,
      "remote",
      "add",
      "origin",
      "git@github.com:ThePrimeagen/Oligarchy.git",
    })
    :wait().code == 0)
  vim.fn.writefile(
    { "CURSOR_API_TOKEN=test-key", 'OLIGARCHY_TEST_VALUE="literal $HOME # value"' },
    root .. "/.env"
  )
  return root
end

-- A fake at the HTTP boundary. Even cancelled requests can deliver late responses.
function M.http()
  local fake = { requests = {} }
  function fake.request(request, callback)
    local call = { request = request, callback = callback, cancelled = false }
    table.insert(fake.requests, call)
    return function()
      call.cancelled = true
    end
  end
  function fake:respond(index, data, status)
    self.requests[index].callback(nil, {
      status = status or 200,
      body = type(data) == "string" and data or vim.json.encode(data),
    })
  end
  function fake:fail(index, message)
    self.requests[index].callback(message)
  end
  return fake
end

function M.wait(predicate)
  assert(vim.wait(2000, predicate, 5), "Timed out waiting for the operation")
end

function M.select(label)
  for line, value in ipairs(vim.api.nvim_buf_get_lines(0, 0, -1, false)) do
    if value:find(label, 1, true) then
      vim.api.nvim_win_set_cursor(0, { line, 0 })
      return
    end
  end
  error("Missing entry: " .. label)
end

function M.request(fake, index)
  M.wait(function()
    return #fake.requests >= index
  end)
  return fake.requests[index].request
end

function M.collect(client)
  local result = { done = false }
  result.cancel = client:get_cloud_agents(function(err, agents)
    result.error = err
    result.agents = agents
    result.done = true
  end)
  return result
end

function M.agent(id, url, status)
  return {
    id = id,
    name = "Job " .. id,
    status = status or "ACTIVE",
    repos = { { url = url or "https://github.com/ThePrimeagen/Oligarchy" } },
  }
end

return M
