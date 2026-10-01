local M = {}

function M.pr(url)
  if type(url) ~= "string" then
    return
  end
  local owner, repo, number = url:match("^https://github%.com/([%w_.-]+)/([%w_.-]+)/pull/(%d+)/?$")
  if owner then
    return owner, repo, number
  end
end

function M.diff(root, url, http, callback)
  local owner, repo, number = M.pr(url)
  local cancelled, cancel = false, nil
  local function done(err, body)
    vim.schedule(function()
      if not cancelled then
        callback(err, body)
      end
    end)
  end
  local env, err = require("oligarchy.env").load(root)
  if not owner then
    done("No GitHub PR for this job")
  elseif not env then
    done(err)
  else
    local headers = {
      Accept = "application/vnd.github.diff",
      ["User-Agent"] = "oligarchy.nvim",
      ["X-GitHub-Api-Version"] = "2022-11-28",
    }
    local token = env.GITHUB_TOKEN or vim.env.GITHUB_TOKEN or env.GH_TOKEN or vim.env.GH_TOKEN
    if token and token ~= "" then
      headers.Authorization = "Bearer " .. token
    end
    cancel = http({
      method = "GET",
      url = "https://api.github.com/repos/" .. owner .. "/" .. repo .. "/pulls/" .. number,
      headers = headers,
      env = env,
    }, function(failure, response)
      if failure then
        done(failure)
      elseif response.status ~= 200 then
        done("GitHub HTTP " .. response.status .. ": check PR access and GITHUB_TOKEN")
      else
        done(nil, response.body)
      end
    end)
  end
  return function()
    cancelled = true
    if cancel then
      cancel()
    end
  end
end

return M
