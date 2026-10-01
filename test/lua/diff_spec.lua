local Diff = require("oligarchy.diff")
local Cache = require("oligarchy.cache")
local Github = require("oligarchy.github")
local S = require("support")

describe("diff hunk navigation", function()
  it("handles new, deleted, renamed, quoted files and multiple hunks", function()
    local patch = table.concat({
      "diff --git a/new.lua b/new.lua",
      "--- /dev/null",
      "+++ b/new.lua",
      "@@ -0,0 +1,2 @@",
      "+one",
      "+two",
      "diff --git a/old.lua b/old.lua",
      "--- a/old.lua",
      "+++ /dev/null",
      "@@ -4,2 +0,0 @@",
      "-one",
      "-two",
      "diff --git a/before.lua b/after.lua",
      "rename from before.lua",
      "rename to after.lua",
      "--- a/before.lua",
      "+++ b/after.lua",
      "@@ -2 +2 @@",
      "-old",
      "+new",
      "@@ -20 +22 @@",
      "-x",
      "+y",
      'diff --git "a/sp ace.lua" "b/sp ace.lua"',
      '--- "a/sp ace.lua"',
      '+++ "b/sp ace.lua"',
      "@@ -1 +1 @@",
      "-old",
      "+new",
    }, "\n")
    local result = Diff.hunks(patch, "/project")
    assert.equals(5, #result)
    assert.equals("/project/new.lua", result[1].filename)
    assert.equals(1, result[1].lnum)
    assert.equals("/project/old.lua", result[2].filename)
    assert.equals(4, result[2].lnum)
    assert.is_true(result[2].user_data.deleted)
    assert.equals("/project/after.lua", result[3].filename)
    assert.equals(22, result[4].lnum)
    assert.equals("/project/sp ace.lua", result[5].filename)
  end)
  it("rejects invalid patches and paths outside the project", function()
    assert.has_error(function()
      Diff.hunks("not a diff", "/project")
    end)
    assert.has_error(function()
      Diff.hunks("--- a/../../bad\n+++ b/../../bad\n@@ -1 +1 @@", "/project")
    end)
    assert.same({}, Diff.hunks("", "/project"))
  end)
end)

describe("conversation disk cache", function()
  local root
  before_each(function()
    root = S.project()
  end)
  after_each(function()
    vim.fn.delete(root, "rf")
  end)
  it("keeps projects isolated, validates corrupted files and preserves closed state", function()
    local cache = Cache.new(root, root .. "/cache")
    local path = root .. "/cache/" .. vim.fn.sha256(root) .. "/" .. vim.fn.sha256("job") .. ".json"
    assert.is_nil(
      cache.write(
        "job",
        { messages = { { type = "assistant_message", text = "cached" } }, closed = { box = true } }
      )
    )
    assert.equals("cached", cache.read("job").messages[1].text)
    assert.is_true(cache.read("job").closed.box)
    assert.is_nil(Cache.new(root .. "/other", root .. "/cache").read("job").messages)
    vim.fn.writefile({ "{broken" }, path)
    assert.same({ closed = {} }, cache.read("job"))
    vim.fn.writefile({ '{"version":1,"messages":[{"text":false}],"closed":{}}' }, path)
    assert.is_nil(cache.read("job").messages)
    assert.is_string(Cache.new(root, root .. "/.env").write("job", { closed = {} }))
  end)
end)

describe("GitHub HTTP boundary", function()
  it("uses only GitHub credentials and reports HTTP errors and cancellation", function()
    local root, http = S.project(), S.http()
    local previous = vim.env.GITHUB_TOKEN
    vim.env.GITHUB_TOKEN = "github-test-token"
    local error
    Github.diff(root, "https://github.com/o/r/pull/1", http.request, function(err)
      error = err
    end)
    assert.equals("Bearer github-test-token", S.request(http, 1).headers.Authorization)
    http:respond(1, {}, 403)
    S.wait(function()
      return error
    end)
    assert.matches("GitHub HTTP 403", error, 1, true)
    local called = false
    local cancel = Github.diff(root, "https://github.com/o/r/pull/1", http.request, function()
      called = true
    end)
    cancel()
    http:respond(2, "")
    vim.wait(20, function()
      return false
    end)
    assert.is_false(called)
    vim.env.GITHUB_TOKEN = previous
    vim.fn.delete(root, "rf")
  end)
end)
