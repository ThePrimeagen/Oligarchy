local M = {}

local function repository_key(url)
  return vim
    .trim(url)
    :gsub("^%w+://", "")
    :gsub("^[^/@]+@", "")
    :gsub(":", "/")
    :gsub("/+$", "")
    :gsub("%.git$", "")
    :lower()
end

local function encode(value)
  return (
    value:gsub("[^%w%-._~]", function(char)
      return string.format("%%%02X", string.byte(char))
    end)
  )
end

--- Each client owns its project root and HTTP caller.
function M.new(options)
  local root = options.root
  local http = options.http or require("oligarchy.cursor.http").request
  local client = {}

  -- Shared authenticated JSON request. Each operation reads the current .env.
  local function request(method, path, callback, body)
    local cancelled, stop = false, nil
    local function deliver(err, data, status)
      vim.schedule(function()
        if not cancelled then
          callback(err, data, status)
        end
      end)
    end
    local env, err = require("oligarchy.env").load(root)
    local token = env and (env.CURSOR_API_TOKEN or vim.env.CURSOR_API_TOKEN)
    if not env then
      deliver(err)
    elseif not token or token == "" then
      deliver("Set CURSOR_API_TOKEN in " .. root .. "/.env")
    else
      stop = http(
        {
          method = method,
          url = "https://api.cursor.com" .. path,
          headers = {
            Accept = "application/json",
            Authorization = "Basic " .. vim.base64.encode(token .. ":"),
            ["Content-Type"] = body and "application/json" or nil,
          },
          env = env,
          body = body and vim.json.encode(body) or nil,
        },
        vim.schedule_wrap(function(failure, response)
          stop = nil
          if cancelled then
            return
          end
          if failure then
            deliver(failure)
            return
          end
          local status = response.status
          if status < 200 or status >= 300 then
            local message = "Cursor HTTP " .. status
            if status == 401 or status == 403 then
              message = message .. ": check CURSOR_API_TOKEN and its repository access"
            else
              message = message .. "; retry the request"
            end
            deliver(message, nil, status)
            return
          end
          if status == 204 then
            deliver(nil, {}, status)
            return
          end
          local ok, data = pcall(vim.json.decode, response.body)
          if not ok or type(data) ~= "table" then
            deliver("Cursor returned invalid JSON")
            return
          end
          deliver(nil, data, status)
        end)
      )
    end
    return function()
      cancelled = true
      if stop then
        stop()
        stop = nil
      end
    end
  end

  function client:create_review(review, callback)
    return request("POST", "/v1/agents", function(err, data)
      if err then
        callback(err)
        return
      end
      local agent = data.agent
      if
        type(agent) ~= "table"
        or agent.id ~= review.agent_id
        or type(agent.name) ~= "string"
        or type(agent.status) ~= "string"
      then
        callback("Cursor returned an invalid review agent")
        return
      end
      callback(nil, agent)
    end, {
      agentId = review.agent_id,
      name = "Review " .. review.branch,
      repos = { { url = review.repository, startingRef = review.branch } },
      workOnCurrentBranch = true,
      autoCreatePR = false,
      prompt = {
        text = "Use the grok-review skill at .cursor/skills/grok-review/SKILL.md.\n"
          .. "Review commit "
          .. review.commit
          .. " on branch "
          .. review.branch
          .. ".\n"
          .. "Use git show to inspect this commit, including its commit message and changes. "
          .. "Follow the skill's review and fix workflow, including its restriction on running tests. "
          .. "Keep any fixes on this review branch and summarize the findings and changes.",
      },
    })
  end

  function client:send_message(agent_id, text, callback)
    if vim.trim(text) == "" then
      local cancelled = false
      vim.schedule(function()
        if not cancelled then
          callback("Write a message before sending")
        end
      end)
      return function()
        cancelled = true
      end
    end
    return request("POST", "/v0/agents/" .. encode(agent_id) .. "/followup", function(err, data)
      if err then
        callback(err)
        return
      end
      if data.id ~= agent_id then
        callback("Cursor returned an invalid follow-up response")
        return
      end
      callback(nil)
    end, { prompt = { text = text } })
  end

  function client:get_conversation(agent_id, callback)
    return request("GET", "/v0/agents/" .. encode(agent_id) .. "/conversation", function(err, data)
      if err then
        callback(err)
        return
      end
      if type(data.messages) ~= "table" or not vim.islist(data.messages) then
        callback("Cursor returned an invalid conversation")
        return
      end
      for _, message in ipairs(data.messages) do
        if
          type(message) ~= "table"
          or type(message.type) ~= "string"
          or type(message.text) ~= "string"
          or (message.id ~= nil and type(message.id) ~= "string")
        then
          callback("Cursor returned an invalid conversation message")
          return
        end
      end
      callback(nil, data.messages)
    end)
  end

  function client:archive_agent(agent_id, callback)
    return request("POST", "/v1/agents/" .. encode(agent_id) .. "/archive", function(err, data)
      if err then
        callback(err)
        return
      end
      if data.id ~= agent_id then
        callback("Cursor returned an invalid archive response")
        return
      end
      callback(nil)
    end)
  end

  function client:get_agent(agent_id, callback)
    return request("GET", "/v0/agents/" .. encode(agent_id), function(err, data)
      if err then
        callback(err)
        return
      end
      if data.id ~= agent_id then
        callback("Cursor returned invalid agent metadata")
        return
      end
      callback(nil, data)
    end)
  end

  function client:abort_agent(agent_id, callback)
    return request("POST", "/v0/agents/" .. encode(agent_id) .. "/stop", function(err, data)
      if err then
        callback(err)
        return
      end
      if data.id ~= agent_id then
        callback("Cursor returned an invalid stop response")
        return
      end
      callback(nil)
    end)
  end

  --- Return this project's jobs from the account's latest ten, newest first.
  --- callback(err, agents) runs on the main loop. Returns a cancel function.
  function client:get_cloud_agents(callback)
    local cancelled, finished = false, false
    local pending = {}
    local function stop_all()
      for _, stop in pairs(pending) do
        stop()
      end
      pending = {}
    end
    local function cancel()
      cancelled = true
      stop_all()
    end
    local function finish(err, agents)
      if finished or cancelled then
        return
      end
      finished = true
      stop_all()
      vim.schedule(function()
        if not cancelled then
          callback(err, agents)
        end
      end)
    end

    local function get(path, done)
      if finished or cancelled then
        return
      end
      local id = {}
      pending[id] = request("GET", "/v1" .. path, function(err, data, status)
        pending[id] = nil
        if finished or cancelled then
          return
        end
        if status == 404 then
          done(nil)
        elseif err then
          finish(err)
        else
          done(data)
        end
      end)
    end

    local ok, process = pcall(
      vim.system,
      { "git", "-C", root, "remote", "get-url", "origin" },
      { text = true },
      vim.schedule_wrap(function(output)
        pending.git = nil
        if cancelled or finished then
          return
        end
        if output.code ~= 0 then
          finish("Cannot read this project's Git origin")
          return
        end
        local repository = repository_key(output.stdout)
        -- A bounded snapshot: never walk the account's full history on opening.
        get("/agents?limit=10&includeArchived=false", function(data)
          if not data or type(data.items) ~= "table" or not vim.islist(data.items) then
            finish("Cursor returned an invalid agents list")
            return
          end
          local count = math.min(10, #data.items)
          if count == 0 then
            finish(nil, {})
            return
          end
          local remaining = count
          local matches = {}
          local function accept(index, detail)
            if detail and detail.status ~= "ARCHIVED" and detail.archived ~= true then
              if
                type(detail.repos) ~= "table"
                or not vim.islist(detail.repos)
                or type(detail.name) ~= "string"
                or type(detail.id) ~= "string"
                or type(detail.status) ~= "string"
              then
                finish("Cursor returned invalid agent details")
                return
              end
              for _, repo in ipairs(detail.repos) do
                if type(repo) ~= "table" or type(repo.url) ~= "string" then
                  finish("Cursor returned an invalid agent repository")
                  return
                end
                if repository_key(repo.url) == repository then
                  matches[index] = detail
                  break
                end
              end
            end
            remaining = remaining - 1
            if remaining == 0 then
              local agents = {}
              for i = 1, count do
                if matches[i] then
                  table.insert(agents, matches[i])
                end
              end
              finish(nil, agents)
            end
          end
          for i = 1, count do
            local agent = data.items[i]
            if type(agent) ~= "table" or type(agent.id) ~= "string" then
              finish("Cursor returned invalid agent metadata")
              return
            end
            if agent.status == "ARCHIVED" or agent.archived == true then
              accept(i, nil)
            elseif agent.repos ~= nil then
              -- Current live responses include details: no extra HTTP call.
              accept(i, agent)
            else
              -- Older/minimal responses need details. Fetch these concurrently.
              get("/agents/" .. encode(agent.id), function(detail)
                accept(i, detail)
              end)
            end
            if finished then
              return
            end
          end
        end)
      end)
    )
    if ok then
      pending.git = function()
        process:kill(15)
      end
    else
      finish("Could not start git: " .. tostring(process))
    end
    return cancel
  end
  return client
end

function M.get_cloud_agents(root, callback)
  return M.new({ root = root }):get_cloud_agents(callback)
end

return M
