local S = require("support")
local Branch = require("oligarchy.branch")
local Cursor = require("oligarchy.cursor")
local function git(root, ...)
  local args = { "git", "-C", root }
  vim.list_extend(args, { ... })
  local result = vim.system(args, { text = true }):wait()
  assert.equals(0, result.code, result.stderr)
  return vim.trim(result.stdout)
end

describe("branch fetching", function()
  local root, remote, http, client, token
  before_each(function()
    root, remote = S.project(), S.project()
    token = vim.env.CURSOR_API_TOKEN
    vim.env.CURSOR_API_TOKEN = nil
    http = S.http()
    client = Cursor.new({ root = root, http = http.request })
    for _, dir in ipairs({ root, remote }) do
      git(dir, "config", "user.name", "Test")
      git(dir, "config", "user.email", "test@example.com")
      vim.fn.writefile({ "original" }, dir .. "/file.txt")
      git(dir, "add", ".")
      git(dir, "commit", "-qm", "initial")
    end
    git(root, "remote", "set-url", "origin", remote)
    git(remote, "checkout", "-qb", "cursor/topic")
    vim.fn.writefile({ "remote change" }, remote .. "/file.txt")
    git(remote, "commit", "-qam", "remote")
  end)
  after_each(function()
    vim.env.CURSOR_API_TOKEN = token
    vim.fn.delete(root, "rf")
    vim.fn.delete(remote, "rf")
  end)
  it("fetches the latest branch twice without changing HEAD or dirty files", function()
    local head = git(root, "rev-parse", "HEAD")
    vim.fn.writefile({ "unsaved local change" }, root .. "/file.txt")
    for attempt = 1, 2 do
      local done, error
      Branch.sync(root, client, "first", function(err, branch, status)
        error, done = err, true
        assert.equals("cursor/topic", branch)
        assert.equals("RUNNING", status)
      end)
      assert.equals("https://api.cursor.com/v0/agents/first", S.request(http, attempt).url)
      http:respond(attempt, {
        id = "first",
        status = "RUNNING",
        target = { branchName = "cursor/topic" },
      })
      S.wait(function()
        return done
      end)
      assert.is_nil(error)
      assert.equals(git(remote, "rev-parse", "HEAD"), git(root, "rev-parse", "origin/cursor/topic"))
      assert.equals(head, git(root, "rev-parse", "HEAD"))
      assert.same({ "unsaved local change" }, vim.fn.readfile(root .. "/file.txt"))
      vim.fn.writefile({ "another remote change" }, remote .. "/file.txt")
      if attempt == 1 then
        git(remote, "commit", "-qam", "update")
      end
    end
  end)
  it("reports completion even when no branch has been published", function()
    local result
    Branch.sync(root, client, "first", function(err, branch, status)
      result = { err = err, branch = branch, status = status }
    end)
    S.request(http, 1)
    http:respond(1, { id = "first", status = "FINISHED" })
    S.wait(function()
      return result
    end)
    assert.equals("No branch published for this job", result.err)
    assert.equals("FINISHED", result.status)
    assert.is_nil(result.branch)
  end)
  it("reports unavailable branches and cancels pending metadata", function()
    local error
    Branch.sync(root, client, "first", function(err)
      error = err
    end)
    S.request(http, 1)
    http:respond(1, { id = "first", target = { branchName = "missing" } })
    S.wait(function()
      return error
    end)
    assert.matches("Branch fetch failed", error, 1, true)
    local called = false
    local cancel = Branch.sync(root, client, "first", function()
      called = true
    end)
    S.request(http, 2)
    cancel()
    http:respond(2, { id = "first", target = { branchName = "cursor/topic" } })
    vim.wait(20, function()
      return false
    end)
    assert.is_false(called)
    assert.is_true(http.requests[2].cancelled)
  end)
end)
