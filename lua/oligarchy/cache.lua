local M = {}

function M.new(root, directory)
  local dir = (directory or (vim.fn.stdpath("cache") .. "/oligarchy")) .. "/" .. vim.fn.sha256(root)
  local function path(id)
    return dir .. "/" .. vim.fn.sha256(id) .. ".json"
  end
  local cache = {}
  function cache.read(id)
    local ok, data = pcall(function()
      return vim.json.decode(table.concat(vim.fn.readfile(path(id)), "\n"))
    end)
    if not ok or type(data) ~= "table" or data.version ~= 1 then
      return { closed = {} }
    end
    local closed = {}
    if type(data.closed) == "table" then
      for key, value in pairs(data.closed) do
        if type(key) == "string" and type(value) == "boolean" then
          closed[key] = value
        end
      end
    end
    local valid = type(data.messages) == "table" and vim.islist(data.messages)
    if valid then
      for _, message in ipairs(data.messages) do
        if
          type(message) ~= "table"
          or type(message.text) ~= "string"
          or type(message.type) ~= "string"
          or (message.id ~= nil and type(message.id) ~= "string")
        then
          valid = false
          break
        end
      end
    end
    return {
      closed = closed,
      messages = valid and data.messages or nil,
      draft = type(data.draft) == "string" and data.draft or nil,
    }
  end
  function cache.write(id, data)
    local fd, temporary
    local ok = pcall(function()
      vim.fn.mkdir(dir, "p", 448) -- private directory, 0700
      fd, temporary = vim.uv.fs_mkstemp(path(id) .. ".XXXXXX")
      assert(fd)
      local bytes = vim.json.encode({
        version = 1,
        messages = data.messages,
        closed = data.closed,
        draft = data.draft,
      })
      assert(vim.uv.fs_write(fd, bytes, 0) == #bytes)
      assert(vim.uv.fs_close(fd))
      fd = nil
      assert(vim.uv.fs_rename(temporary, path(id)))
    end)
    if fd then
      vim.uv.fs_close(fd)
    end
    if temporary then
      vim.uv.fs_unlink(temporary)
    end
    if not ok then
      return "Could not write conversation cache"
    end
  end
  return cache
end
return M
