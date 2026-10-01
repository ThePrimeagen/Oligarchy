local Env = require("oligarchy.env")

describe("project dotenv", function()
  local root, inherited
  before_each(function()
    root = vim.fn.tempname()
    vim.fn.mkdir(root, "p")
    inherited = vim.env.OLIGARCHY_KEEP
    vim.env.OLIGARCHY_KEEP = "inherited"
  end)
  after_each(function()
    vim.env.OLIGARCHY_KEEP = inherited
    vim.fn.delete(root, "rf")
  end)

  it(
    "reads literal values, quotes, escapes and comments without overwriting the environment",
    function()
      vim.fn.writefile({
        "# comment",
        "export OLIGARCHY_A='test-key'",
        "OLIGARCHY_KEEP=file",
        'OLIGARCHY_B="literal $HOME # value"',
        "OLIGARCHY_C=value # comment",
        "OLIGARCHY_D=one=two",
        'OLIGARCHY_E="one\\ntwo"',
        'OLIGARCHY_F="actual" # "comment"',
        'OLIGARCHY_G="say \\"hello\\""',
      }, root .. "/.env")
      local values, err = Env.load(root)
      assert.is_nil(err)
      assert.are.same({
        OLIGARCHY_A = "test-key",
        OLIGARCHY_KEEP = "inherited",
        OLIGARCHY_B = "literal $HOME # value",
        OLIGARCHY_C = "value",
        OLIGARCHY_D = "one=two",
        OLIGARCHY_E = "one\ntwo",
        OLIGARCHY_F = "actual",
        OLIGARCHY_G = 'say "hello"',
      }, values)
      assert.equals("inherited", vim.env.OLIGARCHY_KEEP)
    end
  )

  it("allows a missing dotenv file", function()
    assert.are.same({}, Env.load(root))
  end)

  it("reports invalid assignments and quotes without leaking their contents", function()
    vim.fn.writefile({ "not-an-assignment" }, root .. "/.env")
    local values, err = Env.load(root)
    assert.is_nil(values)
    assert.equals("Invalid .env assignment on line 1", err)
    vim.fn.writefile({ "CURSOR_API_TOKEN='never-print-me" }, root .. "/.env")
    values, err = Env.load(root)
    assert.is_nil(values)
    assert.equals("Invalid .env quoted value on line 1", err)
  end)
end)
