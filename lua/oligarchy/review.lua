local M = {}

-- The process, input and client boundaries are injectable.
function M.start(options, callback)
  local run, input = options.run or vim.system, options.input or vim.ui.input
  local stopped, process, cancel_request = false, nil, nil
  local state = {}
  local function finish(err, agent)
    if stopped then
      return
    end
    stopped = true
    callback(err, agent, state)
  end
  local function progress(message)
    if options.progress then
      options.progress(message)
    end
  end
  local function git(args, label, next_step, settings)
    settings = settings or {}
    progress(label .. "…")
    local command = { "git", "-C", options.root }
    vim.list_extend(command, args)
    local ok, value = pcall(
      run,
      command,
      {
        text = true,
        timeout = 120000,
        env = { GIT_TERMINAL_PROMPT = "0" },
        stdin = settings.stdin,
      },
      vim.schedule_wrap(function(output)
        process = nil
        if stopped then
          return
        end
        if output.code ~= 0 then
          finish(label .. " failed: " .. vim.trim(output.stderr))
          return
        end
        next_step(vim.trim(output.stdout))
      end)
    )
    if ok then
      process = value
    else
      finish(label .. " failed: " .. tostring(value))
    end
  end
  local function publish()
    git({ "rev-parse", "HEAD" }, "Read commit", function(commit)
      state.commit = commit
      git(
        { "cat-file", "-e", commit .. ":.cursor/skills/grok-review/SKILL.md" },
        "Find committed grok-review skill",
        function()
          git({ "push", "origin", commit .. ":refs/heads/" .. state.branch }, "Push", function()
            state.pushed = true
            progress("Starting grok-review…")
            cancel_request = options.client:create_review(state, function(err, agent)
              cancel_request = nil
              if stopped then
                return
              end
              if err then
                finish(
                  err
                    .. "\nThe branch was pushed. Check Cursor jobs before retrying; the request may have been accepted."
                )
              else
                finish(nil, agent)
              end
            end)
          end)
        end
      )
    end)
  end
  local function branch(message)
    local seed = vim.fn.sha256(options.root .. tostring(vim.uv.hrtime()) .. tostring(math.random()))
    local adjectives =
      { "wobbly", "cosmic", "sleepy", "spicy", "dapper", "fuzzy", "sneaky", "bouncy" }
    local nouns =
      { "wombat", "otter", "badger", "penguin", "waffle", "narwhal", "capybara", "llama" }
    local name = "review/"
      .. adjectives[tonumber(seed:sub(1, 2), 16) % #adjectives + 1]
      .. "-"
      .. nouns[tonumber(seed:sub(3, 4), 16) % #nouns + 1]
      .. "-"
      .. seed:sub(5, 10)
    state.agent_id = "bc-"
      .. seed:sub(1, 8)
      .. "-"
      .. seed:sub(9, 12)
      .. "-4"
      .. seed:sub(14, 16)
      .. "-8"
      .. seed:sub(18, 20)
      .. "-"
      .. seed:sub(21, 32)
    git({ "switch", "-c", name }, "Create review branch", function()
      state.branch = name
      git({ "add", "--all" }, "Stage local changes", function()
        git({ "commit", "--file=-" }, "Commit local changes", publish, { stdin = message })
      end)
    end)
  end
  vim.schedule(function()
    if stopped then
      return
    end
    local env, err = require("oligarchy.env").load(options.root)
    if not env then
      finish(err)
      return
    end
    local token = env.CURSOR_API_TOKEN or vim.env.CURSOR_API_TOKEN
    if not token or token == "" then
      finish("Set CURSOR_API_TOKEN before Push & Review")
      return
    end
    git({ "remote", "get-url", "origin" }, "Read origin", function(remote)
      local host, path
      local authority, rest = remote:match("^https?://([^/]+)/(.+)$")
      if not authority then
        authority, rest = remote:match("^ssh://([^/]+)/(.+)$")
      end
      if authority then
        host, path = authority:gsub("^.*@", ""):gsub(":%d*$", ""), rest
      else
        host, path = remote:match("^[^@/]+@([^:/]+):(.+)$")
      end
      if not host then
        finish("Push & Review needs an HTTPS or SSH origin URL")
        return
      end
      state.repository = "https://" .. host .. "/" .. path:gsub("/+$", ""):gsub("%.git$", "")
      git(
        { "status", "--porcelain=v1", "--untracked-files=normal" },
        "Check local changes",
        function(status)
          if status == "" then
            finish("No local changes to review")
            return
          end
          progress("Waiting for commit message…")
          input(
            { prompt = "Push & Review — commit message (all local changes): " },
            vim.schedule_wrap(function(message)
              if stopped then
                return
              end
              if not message or vim.trim(message) == "" then
                finish("Push & Review cancelled")
                return
              end
              branch(message)
            end)
          )
        end
      )
    end)
  end)
  return function()
    stopped = true
    if process then
      process:kill(15)
    end
    if cancel_request then
      cancel_request()
    end
  end
end

return M
