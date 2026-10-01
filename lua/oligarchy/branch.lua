local M = {}

function M.sync(root, client, id, callback, run)
  run = run or vim.system
  local cancelled = false
  local process, cancel_request
  local function done(err, branch)
    vim.schedule(function()
      if not cancelled then
        callback(err, branch)
      end
    end)
  end
  cancel_request = client:get_agent(id, function(err, agent)
    cancel_request = nil
    if err then
      done(err)
      return
    end
    local branch = type(agent.target) == "table" and agent.target.branchName
    if type(branch) ~= "string" or branch == "" then
      done("No branch published for this job")
      return
    end
    -- Ask Git to validate before constructing a refspec from remote metadata.
    local function start(args, cb)
      local ok, result = pcall(
        run,
        args,
        { text = true, timeout = 30000, env = { GIT_TERMINAL_PROMPT = "0" } },
        vim.schedule_wrap(function(output)
          process = nil
          if not cancelled then
            cb(output)
          end
        end)
      )
      if ok then
        process = result
      else
        done("Could not start git")
      end
    end
    start({ "git", "check-ref-format", "refs/heads/" .. branch }, function(check)
      if check.code ~= 0 then
        done("Invalid job branch name")
        return
      end
      start({
        "git",
        "-C",
        root,
        "fetch",
        "--no-tags",
        "--",
        "origin",
        "+refs/heads/" .. branch .. ":refs/remotes/origin/" .. branch,
      }, function(output)
        if output.code ~= 0 then
          done("Branch fetch failed: " .. vim.trim(output.stderr))
        else
          done(nil, branch)
        end
      end)
    end)
  end)
  return function()
    cancelled = true
    if cancel_request then
      cancel_request()
    end
    if process then
      process:kill(15)
    end
  end
end
return M
