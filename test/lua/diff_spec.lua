local Diff = require("oligarchy.diff")
local Cache = require("oligarchy.cache")
local Github = require("oligarchy.github")
local S = require("support")

describe("diff hunk navigation", function()
  it("jumps to the first edit after leading context", function()
    local entries = Diff.hunks(
      table.concat({
        "--- a/file.lua",
        "+++ b/file.lua",
        "@@ -26,4 +26,5 @@ local function filename(value)",
        "   return value",
        " end",
        " ",
        "+local added = true",
        " -- next section",
      }, "\n"),
      "/project"
    )
    assert.equals(29, entries[1].lnum)
    assert.same({ { lnum = 29, added = true } }, entries[1].user_data.changes)
  end)

  it("anchors trailing deletions to the last surviving line of the hunk", function()
    local entries = Diff.hunks(
      table.concat({
        "--- a/file.lua",
        "+++ b/file.lua",
        "@@ -4,4 +4,2 @@",
        " keep",
        " last",
        "-remove",
        "-also remove",
      }, "\n"),
      "/project"
    )
    assert.equals(5, entries[1].lnum)
    assert.same({ { lnum = 5, removed = true } }, entries[1].user_data.changes)
  end)

  it("anchors deletion-only hunks at the beginning, middle and empty end of a file", function()
    for _, case in ipairs({
      { header = "@@ -1,2 +1 @@", body = "-remove\n keep", line = 1 },
      { header = "@@ -5,2 +4,0 @@", body = "-remove\n-also remove", line = 4 },
      { header = "@@ -1,2 +0,0 @@", body = "-remove\n-also remove", line = 1 },
    }) do
      local entries = Diff.hunks(
        "--- a/file.lua\n+++ b/file.lua\n" .. case.header .. "\n" .. case.body,
        "/project"
      )
      assert.equals(case.line, entries[1].lnum)
      assert.same({ { lnum = case.line, removed = true } }, entries[1].user_data.changes)
    end
  end)

  it("skips deleted files while keeping new, renamed, quoted files and multiple hunks", function()
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
    assert.equals(4, #result)
    assert.equals("/project/new.lua", result[1].filename)
    assert.equals(1, result[1].lnum)
    assert.equals("/project/after.lua", result[2].filename)
    assert.equals(22, result[3].lnum)
    assert.equals("/project/sp ace.lua", result[4].filename)
    local filtered = Diff.hunks(patch, "/project", { "new.lua", "after.lua" })
    assert.equals(1, #filtered)
    assert.equals("/project/sp ace.lua", filtered[1].filename)
  end)
  it("skips exact repository-relative paths, including a diff with every file skipped", function()
    local patch = "--- a/bun.lock\n+++ b/bun.lock\n@@ -1 +1 @@\n-old\n+new\n"
    assert.same({}, Diff.hunks(patch, "/project", { "bun.lock" }))
    assert.equals(1, #Diff.hunks(patch, "/project", { "nested/bun.lock", "bun.*" }))
  end)
  it("mixes exact paths with literal partial matches anywhere in a path", function()
    local patches = {}
    for _, path in ipairs({
      "package.json",
      "apps/web/package.json.backup",
      "apps/web/packageXjson",
      "docs/notes.txt",
    }) do
      table.insert(
        patches,
        "diff --git a/"
          .. path
          .. " b/"
          .. path
          .. "\n--- a/"
          .. path
          .. "\n+++ b/"
          .. path
          .. "\n@@ -1 +1 @@\n-old\n+new\n"
      )
    end
    local patch = table.concat(patches)
    assert.equals(3, #Diff.hunks(patch, "/project", { "package.json" }))
    local result = Diff.hunks(patch, "/project", {
      "docs/notes.txt",
      { partial = true, match = "package.json" },
    })
    assert.equals(1, #result)
    assert.equals("/project/apps/web/packageXjson", result[1].filename)
    assert.same(
      {},
      Diff.hunks(patch, "/project", {
        { partial = true, match = "package" },
        { partial = true, match = "docs/" },
      })
    )
  end)
  it("skips deletion-only patches but keeps removed lines within a surviving file", function()
    local deleted = "--- a/gone.lua\n+++ /dev/null\n@@ -1,2 +0,0 @@\n-one\n-two\n"
    assert.same({}, Diff.hunks(deleted, "/project"))
    assert.same({}, Diff.hunks("diff --git a/gone.lua b/gone.lua\n" .. deleted, "/project"))
    local result =
      Diff.hunks("--- a/keep.lua\n+++ b/keep.lua\n@@ -4,2 +3,0 @@\n-one\n-two\n", "/project")
    assert.equals(1, #result)
    assert.equals("/project/keep.lua", result[1].filename)
    assert.equals(3, result[1].lnum)
    assert.matches("-one\n-two", result[1].user_data.diff, 1, true)
  end)

  it("mixes glob ignores with exact and partial rules, including nested Lua files", function()
    local patches = {}
    for _, path in ipairs({
      "init.lua",
      "lua/plugin/init.lua",
      "initXlua",
      "init.lua.bak",
      "INIT.LUA",
      "bun.lock",
      "generated/output.txt",
    }) do
      table.insert(
        patches,
        "diff --git a/"
          .. path
          .. " b/"
          .. path
          .. "\n--- a/"
          .. path
          .. "\n+++ b/"
          .. path
          .. "\n@@ -1 +1 @@\n-old\n+new\n"
      )
    end
    local ignorecase = vim.o.ignorecase
    vim.o.ignorecase = true
    local result = Diff.hunks(table.concat(patches), "/project", {
      { match = "*.lua", pattern = true },
      "bun.lock",
      { match = "generated/", partial = true },
    })
    vim.o.ignorecase = ignorecase
    local names = {}
    for _, item in ipairs(result) do
      table.insert(names, item.filename)
    end
    assert.same({ "/project/initXlua", "/project/init.lua.bak", "/project/INIT.LUA" }, names)
  end)

  it("supports directory prefixes, single-character globs and character classes", function()
    local patch =
      "diff --git a/src/file1.c b/src/file1.c\n--- a/src/file1.c\n+++ b/src/file1.c\n@@ -1 +1 @@\n-old\n+new\n"
    assert.same({}, Diff.hunks(patch, "/project", { { match = "src/file?.[ch]", pattern = true } }))
    assert.equals(
      1,
      #Diff.hunks(patch, "/project", { { match = "lib/file?.[ch]", pattern = true } })
    )
    assert.equals(
      1,
      #Diff.hunks(patch, "/project", { { match = "src/file??.[ch]", pattern = true } })
    )
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
  it("maps additions and removals to the new file's lines", function()
    local result = Diff.hunks(
      table.concat({
        "--- a/file.lua",
        "+++ b/file.lua",
        "@@ -3,5 +3,5 @@",
        " context",
        "-old one",
        "-old two",
        "+new one",
        "+new two",
        " context",
        "-last",
        "+last replacement",
        "\\ No newline at end of file",
        "@@ -20,2 +20,0 @@",
        "-removed one",
        "-removed two",
      }, "\n"),
      "/project"
    )
    assert.same({
      { lnum = 4, added = true, removed = true },
      { lnum = 5, added = true },
      { lnum = 7, added = true, removed = true },
    }, result[1].user_data.changes)
    assert.same({ { lnum = 20, removed = true } }, result[2].user_data.changes)
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
  it("uses GH_TOKEN when GITHUB_TOKEN is empty", function()
    local root, http = S.project(), S.http()
    local github_token, gh_token = vim.env.GITHUB_TOKEN, vim.env.GH_TOKEN
    vim.env.GITHUB_TOKEN, vim.env.GH_TOKEN = "", nil
    vim.fn.writefile({ "GITHUB_TOKEN=", "GH_TOKEN=dotenv-fallback" }, root .. "/.env")
    local cancel = Github.diff(root, "https://github.com/o/r/pull/1", http.request, function() end)
    assert.equals("Bearer dotenv-fallback", S.request(http, 1).headers.Authorization)
    cancel()
    vim.fn.writefile({ "GITHUB_TOKEN=" }, root .. "/.env")
    vim.env.GH_TOKEN = "environment-fallback"
    cancel = Github.diff(root, "https://github.com/o/r/pull/1", http.request, function() end)
    assert.equals("Bearer environment-fallback", S.request(http, 2).headers.Authorization)
    cancel()
    vim.env.GITHUB_TOKEN, vim.env.GH_TOKEN = github_token, gh_token
    vim.fn.delete(root, "rf")
  end)

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
