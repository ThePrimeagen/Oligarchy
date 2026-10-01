local Conversation = require("oligarchy.conversation")
local Cache = require("oligarchy.cache")
local S = require("support")
local function message(id, role, text)
  return { id = id, type = role .. "_message", text = text or id }
end

describe("inferred intermediate assistant messages", function()
  it("keeps an existing assistant fold while defaulting its new thoughts group closed", function()
    local messages = { message("a1", "assistant"), message("a2", "assistant") }
    local closed = { a1 = true }
    Conversation.defaults(messages, closed)
    local groups = Conversation.groups(messages)
    assert.is_true(closed[groups[1].id])
    assert.equals("a1", groups[2].id)
    assert.is_true(closed[groups[2].id])
  end)
  it(
    "leaves the last reply in each assistant turn visible and separates earlier messages",
    function()
      local groups = Conversation.groups({
        message("u1", "user"),
        message("a1", "assistant"),
        message("a2", "assistant"),
        message("a3", "assistant"),
        message("u2", "user"),
        message("a4", "assistant"),
      })
      assert.equals(5, #groups)
      assert.equals("thoughts", groups[2].kind)
      assert.same({ "a1", "a2" }, groups[2].messages)
      assert.equals("response", groups[3].kind)
      assert.same({ "a3" }, groups[3].messages)
      assert.same({ "a4" }, groups[5].messages)
    end
  )
  it("keeps thought identities stable when the former last reply becomes intermediate", function()
    local messages = { message("a1", "assistant"), message("a2", "assistant") }
    local before = Conversation.groups(messages)
    table.insert(messages, message("a3", "assistant"))
    local after = Conversation.groups(messages)
    assert.equals(before[1].id, after[1].id)
    assert.equals(before[2].id, after[2].id)
    assert.same({ "a1", "a2" }, after[1].messages)
    assert.same({ "a3" }, after[2].messages)
  end)
  it(
    "defaults thoughts closed, preserves explicit expansion, and does not hide a lone reply",
    function()
      local messages =
        { message("u1", "user"), message("a1", "assistant"), message("a2", "assistant") }
      local closed = {}
      assert.is_true(Conversation.defaults(messages, closed))
      local groups = Conversation.groups(messages)
      assert.is_true(closed[groups[2].id])
      assert.is_false(closed[groups[3].id])
      closed[groups[2].id] = false
      assert.is_false(Conversation.defaults(messages, closed))
      assert.is_false(closed[groups[2].id])
      assert.equals(1, #Conversation.groups({ message("only", "assistant") }))
    end
  )
  it(
    "persists both default collapse and explicit expansion alongside the complete history",
    function()
      local root = S.project()
      local cache = Cache.new(root, root .. "/cache")
      local data =
        { messages = { message("a1", "assistant"), message("a2", "assistant") }, closed = {} }
      Conversation.defaults(data.messages, data.closed)
      local id = Conversation.groups(data.messages)[1].id
      assert.is_nil(cache.write("job", data))
      assert.is_true(cache.read("job").closed[id])
      data.closed[id] = false
      assert.is_nil(cache.write("job", data))
      local saved = cache.read("job")
      assert.is_false(saved.closed[id])
      assert.same(data.messages, saved.messages)
      vim.fn.delete(root, "rf")
    end
  )
end)
