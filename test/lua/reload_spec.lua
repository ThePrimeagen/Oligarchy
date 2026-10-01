local S = require("support")
local project = vim.fn.fnamemodify(debug.getinfo(1, "S").source:sub(2), ":p:h:h:h")

describe("re-sourcing the project vimrc", function()
  local root, token, source

  before_each(function()
    root = S.project()
    token = vim.env.CURSOR_API_TOKEN
    vim.env.CURSOR_API_TOKEN = nil
    source = vim.api.nvim_create_buf(true, true)
    vim.api.nvim_set_current_buf(source)
  end)

  after_each(function()
    for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
      if vim.api.nvim_buf_get_name(buffer) == "oligarchy://cloud-jobs" then
        vim.api.nvim_buf_delete(buffer, { force = true })
      end
    end
    if vim.api.nvim_buf_is_valid(source) then
      vim.api.nvim_buf_delete(source, { force = true })
    end
    vim.env.CURSOR_API_TOKEN = token
    vim.fn.delete(root, "rf")
  end)

  local function reload(http)
    vim.cmd("source " .. vim.fn.fnameescape(project .. "/.nvimrc"))
    local plugin = require("oligarchy")
    -- Inject before the vimrc's scheduled open, keeping this test offline.
    plugin.setup({ root = root, http = http.request })
    return plugin
  end

  it("replaces loaded modules and the pane, cancels old work, and uses fresh callbacks", function()
    local first_http = S.http()
    local first = reload(first_http)
    S.request(first_http, 1)
    local first_buffer = vim.api.nvim_get_current_buf()
    local cursor = require("oligarchy.cursor")
    local transport = require("oligarchy.cursor.http")
    local window_count = #vim.api.nvim_list_wins()

    local next_http = S.http()
    local next_plugin = reload(next_http)
    assert.are_not.equal(first, next_plugin)
    assert.are_not.equal(cursor, require("oligarchy.cursor"))
    assert.are_not.equal(transport, require("oligarchy.cursor.http"))
    assert.is_true(first_http.requests[1].cancelled)
    assert.is_false(vim.api.nvim_buf_is_valid(first_buffer))
    S.request(next_http, 1)
    assert.equals(window_count, #vim.api.nvim_list_wins())
    first_http:respond(1, {}, 500)
    next_http:respond(1, { items = { S.agent("fresh") } })
    local next_buffer = vim.api.nvim_get_current_buf()
    S.wait(function()
      return vim.b[next_buffer].oligarchy_agents ~= nil
    end)
    assert.equals("fresh", vim.b[next_buffer].oligarchy_agents[1].id)

    vim.cmd("OligarchyJobs")
    S.request(next_http, 2)
    assert.equals(1, #first_http.requests)
    next_http:respond(2, { items = {} })
    S.wait(function()
      return vim.b[next_buffer].oligarchy_agents ~= nil
    end)
  end)

  it("supersedes a scheduled open when sourced twice immediately", function()
    local first_http, next_http = S.http(), S.http()
    reload(first_http)
    reload(next_http)
    S.request(next_http, 1)
    assert.equals(0, #first_http.requests)
    next_http:respond(1, { items = {} })
    S.wait(function()
      return vim.b.oligarchy_agents ~= nil
    end)
    assert.equals(1, #next_http.requests)
  end)
end)
