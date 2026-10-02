local Plugin = require("oligarchy")
local S = require("support")

local function press(key)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(key, true, false, true), "xt", false)
end

describe("local changes", function()
  local root, http, buffer

  local function git(...)
    local args = { "git", "-C", root }
    vim.list_extend(args, { ... })
    local result = vim.system(args):wait()
    assert.equals(0, result.code, result.stderr)
    return result.stdout
  end

  local function changes()
    local done, failure, items
    require("oligarchy.local_diff").collect(
      root,
      { "skip.txt", { partial = true, match = ".lock" } },
      function(err, result)
        done, failure, items = true, err, result
      end
    )
    S.wait(function()
      return done
    end)
    assert.is_nil(failure)
    return items
  end

  local function open_local()
    Plugin.open()
    buffer = vim.api.nvim_get_current_buf()
    press("<CR>")
  end

  local function summary()
    local done, failure, stats
    require("oligarchy.local_diff").summary(
      root,
      { "skip.txt", { partial = true, match = ".lock" } },
      function(err, result)
        done, failure, stats = true, err, result
      end
    )
    S.wait(function()
      return done
    end)
    assert.is_nil(failure)
    return stats
  end

  before_each(function()
    root, http = S.project(), S.http()
    vim.fn.writefile({ ".env", "cache/", "ignored.txt" }, root .. "/.gitignore")
    Plugin.setup({ root = root, http = http.request, cache_dir = root .. "/cache" })
  end)

  after_each(function()
    if buffer and vim.api.nvim_buf_is_valid(buffer) then
      vim.api.nvim_buf_delete(buffer, { force = true })
    end
    vim.cmd("silent! cclose")
    vim.fn.setqflist({}, "f")
    vim.fn.delete(root, "rf")
  end)

  it(
    "combines staged, unstaged and untracked hunks with ignores without changing the index",
    function()
      local lines = {}
      for i = 1, 30 do
        lines[i] = "line " .. i
      end
      vim.fn.writefile(lines, root .. "/tracked.txt")
      vim.fn.writefile({ "delete me" }, root .. "/deleted.txt")
      git("add", ".")
      git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "base")
      lines[2] = "staged"
      vim.fn.writefile(lines, root .. "/tracked.txt")
      git("add", "tracked.txt")
      lines[28] = "unstaged"
      vim.fn.writefile(lines, root .. "/tracked.txt")
      vim.fn.delete(root .. "/deleted.txt")
      for _, name in ipairs({ "new file.txt", "skip.txt", "generated.lock", "ignored.txt" }) do
        vim.fn.writefile({ "new" }, root .. "/" .. name)
      end
      vim.fn.writefile({ "binary\ndata" }, root .. "/binary.bin", "b")
      local index = git("diff", "--cached")
      local status = git("status", "--porcelain")
      local items = changes()
      assert.equals(3, #items)
      assert.equals(root .. "/tracked.txt", items[1].filename)
      assert.equals(2, items[1].lnum)
      assert.equals(28, items[2].lnum)
      assert.matches("+staged", items[1].user_data.diff, 1, true)
      assert.matches("+unstaged", items[2].user_data.diff, 1, true)
      assert.equals(root .. "/new file.txt", items[3].filename)
      assert.same({ added = 3, removed = 3, files = 4 }, summary())
      assert.equals(index, git("diff", "--cached"))
      assert.equals(status, git("status", "--porcelain"))
    end
  )

  it("supports a repository before its first commit and a clean checkout", function()
    git("add", ".gitignore")
    vim.fn.writefile({ "first" }, root .. "/first.txt")
    assert.equals(2, #changes())
    assert.same({ added = 4, removed = 0, files = 2 }, summary())
    git("add", ".")
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "base")
    assert.same({}, changes())
    assert.same({ added = 0, removed = 0, files = 0 }, summary())
  end)

  it("navigates to the first changed line and the surviving end of a file", function()
    local lines = {}
    for i = 1, 20 do
      lines[i] = "line " .. i
    end
    vim.fn.writefile(lines, root .. "/file.txt")
    git("add", ".")
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "base")
    lines[5] = "changed"
    table.remove(lines)
    table.remove(lines)
    vim.fn.writefile(lines, root .. "/file.txt")
    open_local()
    press("d")
    S.wait(function()
      return #vim.fn.getqflist() == 2
    end)
    vim.cmd("wincmd p")
    assert.equals(5, vim.api.nvim_win_get_cursor(0)[1])
    assert.equals("changed", vim.api.nvim_get_current_line())
    vim.cmd("cnext")
    assert.equals(18, vim.api.nvim_win_get_cursor(0)[1])
    assert.equals(18, vim.fn.getqflist()[2].lnum)
    assert.equals("line 18", vim.api.nvim_get_current_line())
  end)

  it("counts renames, mode changes and empty new files even without line changes", function()
    vim.fn.writefile({ "same" }, root .. "/old.txt")
    vim.fn.writefile({ "script" }, root .. "/script")
    git("add", ".")
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "base")
    git("mv", "old.txt", "renamed\tfile\n.txt")
    vim.fn.setfperm(root .. "/script", "rwxr-xr-x")
    vim.fn.writefile({}, root .. "/empty")
    assert.same({ added = 0, removed = 0, files = 3 }, summary())
  end)

  it("uses glob ignores for both local hunks and summary counts", function()
    vim.fn.mkdir(root .. "/lua", "p")
    vim.fn.writefile({ "return true" }, root .. "/lua/plugin.lua")
    local skips = { ".gitignore", { match = "*.lua", pattern = true } }
    local done, failure, items
    require("oligarchy.local_diff").collect(root, skips, function(err, result)
      done, failure, items = true, err, result
    end)
    S.wait(function()
      return done
    end)
    assert.is_nil(failure)
    assert.same({}, items)
    done = false
    require("oligarchy.local_diff").summary(root, skips, function(err, result)
      done, failure, items = true, err, result
    end)
    S.wait(function()
      return done
    end)
    assert.is_nil(failure)
    assert.same({ added = 0, removed = 0, files = 0 }, items)
  end)

  it("preserves filenames with literal escapes, control characters and Unicode", function()
    git("add", ".gitignore")
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "base")
    local expected = {}
    for _, name in ipairs({ "literal\\141.lua", "back\b.lua", "form\f.lua", "café.lua" }) do
      vim.fn.writefile({ "new" }, root .. "/" .. name)
      table.insert(expected, root .. "/" .. name)
    end
    local actual = {}
    for _, entry in ipairs(changes()) do
      table.insert(actual, entry.filename)
    end
    table.sort(expected)
    table.sort(actual)
    assert.same(expected, actual)
  end)

  it("refreshes the Local summary independently of Cursor and keeps the selected job", function()
    Plugin.open()
    buffer = vim.api.nvim_get_current_buf()
    S.request(http, 1)
    http:respond(1, { items = { S.agent("first") } })
    S.wait(function()
      return vim.b[buffer].oligarchy_agents ~= nil
    end)
    S.select("Job first")
    S.wait(function()
      return table
        .concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n")
        :find("Local +3/-0 with 1 file changed", 1, true)
    end)
    assert.matches("Job first", vim.api.nvim_get_current_line(), 1, true)
    git("add", ".gitignore")
    git("-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-qm", "base")
    press("r")
    S.wait(function()
      return table
        .concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n")
        :find("Local (unchanged)", 1, true)
    end)
    S.request(http, 2)
    http:respond(2, {}, 401)
    S.wait(function()
      return table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n"):find("401")
    end)
    assert.matches(
      "Local (unchanged)",
      table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n"),
      1,
      true
    )
  end)

  it("opens Local while jobs load, cancels that request and offers only local actions", function()
    Plugin.open()
    buffer = vim.api.nvim_get_current_buf()
    S.request(http, 1)
    press("<CR>")
    assert.is_true(http.requests[1].cancelled)
    http:respond(1, { items = { S.agent("late") } })
    for _, key in ipairs({ "i", "a", "g", "P", "<C-CR>" }) do
      press(key)
    end
    assert.equals(1, #http.requests)
    assert.equals("Local", vim.api.nvim_buf_get_lines(buffer, 0, 1, false)[1])
    press("d")
    S.wait(function()
      return #vim.fn.getqflist() == 1
    end)
    assert.equals(root .. "/.gitignore", vim.api.nvim_buf_get_name(vim.fn.getqflist()[1].bufnr))
  end)

  it("keeps Local available after a Cursor failure and returns to the list", function()
    Plugin.open()
    buffer = vim.api.nvim_get_current_buf()
    S.request(http, 1)
    http:respond(1, {}, 401)
    S.wait(function()
      return table.concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n"):find("401")
    end)
    press("<CR>")
    assert.equals("Local", vim.api.nvim_buf_get_lines(buffer, 0, 1, false)[1])
    press("<C-b>")
    press("<CR>")
    assert.equals("Local", vim.api.nvim_buf_get_lines(buffer, 0, 1, false)[1])
    assert.equals(1, #http.requests)
  end)

  it("reports Git errors without replacing quickfix", function()
    vim.fn.delete(root .. "/.git", "rf")
    vim.fn.setqflist({ { filename = root .. "/keep", lnum = 1, text = "existing" } })
    Plugin.open()
    buffer = vim.api.nvim_get_current_buf()
    S.wait(function()
      return table
        .concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n")
        :find("Local (diff unavailable)", 1, true)
    end)
    S.select("Local")
    press("<CR>")
    press("d")
    S.wait(function()
      return table
        .concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n")
        :find("Local diff failed", 1, true)
    end)
    assert.equals("existing", vim.fn.getqflist()[1].text)
  end)

  it("clears stale quickfix entries when every file is skipped", function()
    Plugin.setup({ root = root, http = http.request, skip_files = { ".gitignore" } })
    vim.fn.setqflist({ { filename = root .. "/keep", lnum = 1, text = "existing" } })
    open_local()
    press("r")
    S.wait(function()
      return table
        .concat(vim.api.nvim_buf_get_lines(buffer, 0, -1, false), "\n")
        :find("0 diff hunks", 1, true)
    end)
    assert.same({}, vim.fn.getqflist())
    vim.fn.writefile({ "new" }, root .. "/new.txt")
    press("r")
    S.wait(function()
      return #vim.fn.getqflist() == 1
    end)
    assert.equals(root .. "/new.txt", vim.api.nvim_buf_get_name(vim.fn.getqflist()[1].bufnr))
    assert.equals(1, vim.fn.getqflist({ idx = 0 }).idx)
  end)

  it("regenerates quickfix with current ignores and never accumulates old hunks", function()
    vim.fn.writefile({ "return true" }, root .. "/plugin.lua")
    vim.fn.writefile({ "notes" }, root .. "/notes.txt")
    open_local()
    press("d")
    S.wait(function()
      return #vim.fn.getqflist() == 3
    end)
    Plugin.setup({
      root = root,
      http = http.request,
      skip_files = { ".gitignore", { match = "*.lua", pattern = true } },
    })
    for _ = 1, 2 do
      local changedtick = vim.fn.getqflist({ changedtick = 0, id = 0 })
      open_local()
      press("d")
      S.wait(function()
        local current = vim.fn.getqflist({ changedtick = 0, id = 0 })
        return current.id ~= changedtick.id or current.changedtick ~= changedtick.changedtick
      end)
      local items = vim.fn.getqflist()
      assert.equals(1, #items)
      assert.equals(root .. "/notes.txt", vim.api.nvim_buf_get_name(items[1].bufnr))
      assert.equals(1, vim.fn.getqflist({ idx = 0 }).idx)
    end
  end)

  it("kills pending Git work and suppresses late callbacks after cancellation", function()
    local complete, killed, called
    local cancel = require("oligarchy.local_diff").collect(root, {}, function()
      called = true
    end, function(_, _, callback)
      assert.is_nil(complete)
      complete = callback
      return {
        kill = function()
          killed = true
        end,
      }
    end)
    cancel()
    assert.is_true(killed)
    complete({ code = 0, stdout = "HEAD", stderr = "" })
    local drained = false
    vim.schedule(function()
      drained = true
    end)
    S.wait(function()
      return drained
    end)
    assert.is_nil(called)
  end)

  it("reports a Git process that cannot start", function()
    local failure
    require("oligarchy.local_diff").collect(root, {}, function(err)
      failure = err
    end, function()
      error("missing executable")
    end)
    S.wait(function()
      return failure
    end)
    assert.matches("Could not start git", failure, 1, true)
  end)
end)
