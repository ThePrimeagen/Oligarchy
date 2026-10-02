local M = {}
local Diff = require("oligarchy.diff")

-- Read Git's changes against HEAD and untracked files without staging anything.
local function read(root, stats, consume, callback, run)
  run = run or vim.system
  local cancelled, process = false, nil
  local function fail(message)
    callback("Local diff failed: " .. message)
  end
  local function start(args, codes, next_step)
    if stats and args[1] == "diff" then
      table.insert(args, 2, "--numstat")
      table.insert(args, 3, "-z")
    end
    local command = { "git", "-C", root }
    vim.list_extend(command, args)
    local ok, result = pcall(
      run,
      command,
      { timeout = 30000, stdin = "" },
      vim.schedule_wrap(function(output)
        process = nil
        if cancelled then
          return
        end
        if not codes[output.code] then
          fail(vim.trim(output.stderr or "") .. " (exit " .. output.code .. ")")
          return
        end
        next_step(output)
      end)
    )
    if ok then
      process = result
    else
      vim.schedule(function()
        if not cancelled then
          fail("Could not start git")
        end
      end)
    end
  end
  local function append(patch)
    local ok = pcall(consume, patch)
    if not ok then
      fail("Could not parse diff")
      return false
    end
    return true
  end
  local function untracked()
    start({ "ls-files", "--others", "--exclude-standard", "-z" }, { [0] = true }, function(output)
      local paths = vim.split(output.stdout, "\0", { plain = true, trimempty = true })
      local index = 0
      local function next_file()
        index = index + 1
        if not paths[index] then
          callback(nil)
          return
        end
        start({
          "diff",
          "--no-index",
          "--no-ext-diff",
          "--no-textconv",
          "--no-color",
          "--src-prefix=a/",
          "--dst-prefix=b/",
          "--",
          "/dev/null",
          paths[index],
        }, { [0] = true, [1] = true }, function(patch)
          if append(patch.stdout) then
            next_file()
          end
        end)
      end
      next_file()
    end)
  end
  local function tracked(base)
    start({
      "diff",
      "--no-ext-diff",
      "--no-textconv",
      "--no-color",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      base,
      "--",
    }, { [0] = true }, function(output)
      if append(output.stdout) then
        untracked()
      end
    end)
  end
  start({ "rev-parse", "--verify", "--quiet", "HEAD" }, { [0] = true, [1] = true }, function(output)
    if output.code == 0 then
      tracked(vim.trim(output.stdout))
    else
      -- An unborn branch has no HEAD. Git computes the empty tree for its hash format.
      start({ "hash-object", "-t", "tree", "--stdin" }, { [0] = true }, function(tree)
        tracked(vim.trim(tree.stdout))
      end)
    end
  end)
  return function()
    cancelled = true
    if process then
      process:kill(15)
    end
  end
end

function M.collect(root, skip_files, callback, run)
  local items = {}
  return read(root, false, function(patch)
    vim.list_extend(items, Diff.hunks(patch, root, skip_files))
  end, function(err)
    callback(err, not err and items or nil)
  end, run)
end

function M.summary(root, skip_files, callback, run)
  local summary = { added = 0, removed = 0, files = 0 }
  local files = {}
  return read(root, true, function(output)
    local fields = vim.split(output, "\0", { plain = true, trimempty = true })
    local index = 1
    while index <= #fields do
      local added, removed, path = fields[index]:match("^([^\t]+)\t([^\t]+)\t(.*)$")
      if path == "" then
        -- Renames and no-index diffs encode the old and new paths separately.
        path = fields[index + 2]
        index = index + 2
      end
      if not Diff.skipped(path, skip_files) then
        summary.added = summary.added + (tonumber(added) or 0)
        summary.removed = summary.removed + (tonumber(removed) or 0)
        if not files[path] then
          files[path] = true
          summary.files = summary.files + 1
        end
      end
      index = index + 1
    end
  end, function(err)
    callback(err, not err and summary or nil)
  end, run)
end

return M
