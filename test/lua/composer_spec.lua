local Plugin = require("oligarchy")
local S = require("support")
local function press(key)
  vim.api.nvim_feedkeys(vim.api.nvim_replace_termcodes(key, true, false, true), "xt", false)
end

describe("conversation prompt", function()
  local root, http, history, prompt, token
  local function open()
    Plugin.open()
    history = vim.api.nvim_get_current_buf()
    S.request(http, 1)
    http:respond(1, { items = { S.agent("first") } })
    S.wait(function()
      return vim.b[history].oligarchy_agents ~= nil
    end)
    S.select("Job first")
    press("<CR>")
    S.request(http, 2)
    http:respond(
      2,
      { messages = { { id = "u1", type = "user_message", text = "Existing conversation" } } }
    )
    S.wait(function()
      return vim.b[history].oligarchy_conversation ~= nil
    end)
    Plugin.prompt()
    prompt = vim.api.nvim_get_current_buf()
    vim.cmd("stopinsert")
  end
  before_each(function()
    root, http = S.project(), S.http()
    token = vim.env.CURSOR_API_TOKEN
    vim.env.CURSOR_API_TOKEN = nil
    Plugin.setup({
      root = root,
      http = http.request,
      cache_dir = root .. "/cache",
      sync_branch = function()
        return function() end
      end,
    })
  end)
  after_each(function()
    vim.cmd("stopinsert")
    if history and vim.api.nvim_buf_is_valid(history) then
      vim.api.nvim_buf_delete(history, { force = true })
    end
    vim.wait(20, function()
      return prompt and not vim.api.nvim_buf_is_valid(prompt)
    end)
    vim.env.CURSOR_API_TOKEN = token
    vim.fn.delete(root, "rf")
  end)
  it("sends the exact multiline draft once and clears it only after acknowledgement", function()
    open()
    assert.are_not.equal(history, prompt)
    assert.is_true(vim.bo[prompt].modifiable)
    assert.is_false(vim.bo[history].modifiable)
    local draft = { 'Please fix "quotes" and \\paths', "", "Then explain café." }
    vim.api.nvim_buf_set_lines(prompt, 0, -1, false, draft)
    press("<C-CR>")
    local request = S.request(http, 3)
    assert.equals("POST", request.method)
    assert.equals("https://api.cursor.com/v0/agents/first/followup", request.url)
    assert.equals("application/json", request.headers["Content-Type"])
    assert.same({ prompt = { text = table.concat(draft, "\n") } }, vim.json.decode(request.body))
    press("<C-CR>")
    assert.equals(3, #http.requests)
    assert.same(draft, vim.api.nvim_buf_get_lines(prompt, 0, -1, false))
    http:respond(3, { id = "first" })
    S.request(http, 4)
    assert.same({ "" }, vim.api.nvim_buf_get_lines(prompt, 0, -1, false))
    assert.is_true(vim.bo[prompt].modifiable)
    assert.equals(
      "https://api.cursor.com/v0/agents/first/conversation",
      http.requests[4].request.url
    )
  end)
  it("keeps a failed draft editable and does not submit blank messages", function()
    open()
    vim.api.nvim_buf_set_lines(prompt, 0, -1, false, { "   ", "" })
    press("<C-CR>")
    assert.equals(2, #http.requests)
    vim.api.nvim_buf_set_lines(prompt, 0, -1, false, { "Keep my draft" })
    press("<C-CR>")
    S.request(http, 3)
    http:respond(3, {}, 429)
    S.wait(function()
      return vim.bo[prompt].modifiable
    end)
    assert.same({ "Keep my draft" }, vim.api.nvim_buf_get_lines(prompt, 0, -1, false))
    assert.matches(
      "Cursor HTTP 429",
      table.concat(vim.api.nvim_buf_get_lines(history, 0, -1, false), "\n"),
      1,
      true
    )
  end)
  it("preserves a replacement buffer and saves the draft when the prompt is replaced", function()
    open()
    local prompt_window = vim.api.nvim_get_current_win()
    vim.api.nvim_buf_set_lines(prompt, 0, -1, false, { "Keep this draft" })
    vim.cmd("enew")
    local replacement = vim.api.nvim_get_current_buf()
    vim.wait(20, function()
      return false
    end)
    assert.is_true(vim.api.nvim_win_is_valid(prompt_window))
    assert.equals(replacement, vim.api.nvim_win_get_buf(prompt_window))
    local saved = require("oligarchy.cache").new(root, root .. "/cache").read("first")
    assert.equals("Keep this draft", saved.draft)
    vim.api.nvim_win_close(prompt_window, true)
    vim.api.nvim_buf_delete(replacement, { force = true })
  end)
  it("saves drafts on navigation and closes the prompt when its conversation is wiped", function()
    open()
    local prompt_window = vim.api.nvim_get_current_win()
    vim.api.nvim_buf_set_lines(prompt, 0, -1, false, { "Draft for first" })
    vim.api.nvim_set_current_win(vim.fn.bufwinid(history))
    press("<BS>")
    assert.is_false(vim.api.nvim_buf_is_valid(prompt))
    assert.is_false(vim.api.nvim_win_is_valid(prompt_window))
    local saved = require("oligarchy.cache").new(root, root .. "/cache").read("first")
    assert.equals("Draft for first", saved.draft)
    S.select("Job first")
    press("<CR>")
    Plugin.prompt()
    prompt = vim.api.nvim_get_current_buf()
    vim.cmd("stopinsert")
    assert.same({ "Draft for first" }, vim.api.nvim_buf_get_lines(prompt, 0, -1, false))
    vim.api.nvim_buf_delete(history, { force = true })
    S.wait(function()
      return not vim.api.nvim_buf_is_valid(prompt)
    end)
  end)
end)
