local Cursor = require("oligarchy.cursor")
local S = require("support")

describe("Cursor cloud agents", function()
  local root, http, client, key, env_value

  before_each(function()
    root = S.project()
    key, env_value = vim.env.CURSOR_API_TOKEN, vim.env.OLIGARCHY_TEST_VALUE
    vim.env.CURSOR_API_TOKEN, vim.env.OLIGARCHY_TEST_VALUE = nil, nil
    http = S.http()
    client = Cursor.new({ root = root, http = http.request })
  end)

  after_each(function()
    vim.env.CURSOR_API_TOKEN, vim.env.OLIGARCHY_TEST_VALUE = key, env_value
    vim.fn.delete(root, "rf")
  end)

  it("fetches only the latest ten, reuses details, and includes idle jobs for this repo", function()
    local result = S.collect(client)
    assert.are.same({
      method = "GET",
      url = "https://api.cursor.com/v1/agents?limit=10&includeArchived=false",
      headers = { Accept = "application/json", Authorization = "Basic dGVzdC1rZXk6" },
      env = { CURSOR_API_TOKEN = "test-key", OLIGARCHY_TEST_VALUE = "literal $HOME # value" },
    }, S.request(http, 1))
    local active = S.agent("active")
    local idle = S.agent("idle", "https://github.com/theprimeagen/oligarchy.git/", "IDLE")
    http:respond(1, {
      items = { active, idle, S.agent("other", "https://github.com/other/repo") },
      nextCursor = "do-not-follow",
    })
    S.wait(function()
      return result.done
    end)
    assert.is_nil(result.error)
    assert.are.same({ active, idle }, result.agents)
    assert.equals(1, #http.requests)
  end)

  it("fetches missing details concurrently and preserves newest-first order", function()
    local result = S.collect(client)
    S.request(http, 1)
    http:respond(1, {
      items = {
        { id = "first", status = "IDLE" },
        { id = "second", status = "ACTIVE" },
        { id = "gone", status = "ACTIVE" },
      },
    })
    S.request(http, 4)
    assert.equals("https://api.cursor.com/v1/agents/first", http.requests[2].request.url)
    assert.equals("https://api.cursor.com/v1/agents/second", http.requests[3].request.url)
    http:respond(3, S.agent("second"))
    http:respond(4, {}, 404)
    http:respond(2, S.agent("first", nil, "IDLE"))
    S.wait(function()
      return result.done
    end)
    assert.are.same({ S.agent("first", nil, "IDLE"), S.agent("second") }, result.agents)
  end)

  it("caps even an oversized response at ten jobs", function()
    local result = S.collect(client)
    S.request(http, 1)
    local items = {}
    for i = 1, 11 do
      items[i] = S.agent(tostring(i))
    end
    http:respond(1, { items = items, nextCursor = "ignored" })
    S.wait(function()
      return result.done
    end)
    assert.equals(10, #result.agents)
    assert.equals("10", result.agents[10].id)
    assert.equals(1, #http.requests)
  end)

  it("loads the current .env on every call and keeps clients independent", function()
    local first = S.collect(client)
    S.request(http, 1)
    http:respond(1, { items = {} })
    S.wait(function()
      return first.done
    end)
    vim.fn.writefile({ "CURSOR_API_TOKEN=changed" }, root .. "/.env")
    local second = S.collect(client)
    assert.equals(
      "Basic " .. vim.base64.encode("changed:"),
      S.request(http, 2).headers.Authorization
    )
    http:respond(2, { items = {} })
    S.wait(function()
      return second.done
    end)
    assert.are.same({}, second.agents)

    local other = S.http()
    local third = S.collect(Cursor.new({ root = root, http = other.request }))
    S.request(other, 1)
    other:respond(1, { items = {} })
    S.wait(function()
      return third.done
    end)
    assert.equals(2, #http.requests)
  end)

  for _, status in ipairs({ 401, 403, 429, 500 }) do
    it("reports HTTP " .. status .. " without returning a partial result", function()
      local result = S.collect(client)
      S.request(http, 1)
      http:respond(1, {}, status)
      S.wait(function()
        return result.done
      end)
      assert.matches("Cursor HTTP " .. status, result.error, 1, true)
      assert.is_nil(result.agents)
    end)
  end

  it("reports transport failures", function()
    local result = S.collect(client)
    S.request(http, 1)
    http:fail(1, "Connection timed out")
    S.wait(function()
      return result.done
    end)
    assert.matches("Connection timed out", result.error, 1, true)
  end)

  it("rejects malformed JSON", function()
    local invalid = S.collect(client)
    S.request(http, 1)
    http:respond(1, "not json")
    S.wait(function()
      return invalid.done
    end)
    assert.equals("Cursor returned invalid JSON", invalid.error)
  end)

  it("cancels all pending detail requests and ignores their late responses", function()
    local result = S.collect(client)
    S.request(http, 1)
    http:respond(
      1,
      { items = { { id = "one", status = "IDLE" }, { id = "two", status = "ACTIVE" } } }
    )
    S.request(http, 3)
    result.cancel()
    assert.is_true(http.requests[2].cancelled)
    assert.is_true(http.requests[3].cancelled)
    http:respond(2, S.agent("one"))
    http:respond(3, S.agent("two"))
    local drained = false
    vim.schedule(function()
      drained = true
    end)
    S.wait(function()
      return drained
    end)
    assert.is_false(result.done)
  end)

  it("fails before HTTP when the key or Git origin is missing", function()
    vim.fn.writefile({}, root .. "/.env")
    local missing_key = S.collect(client)
    S.wait(function()
      return missing_key.done
    end)
    assert.matches("Set CURSOR_API_TOKEN", missing_key.error, 1, true)
    vim.fn.writefile({ "CURSOR_API_TOKEN=test-key" }, root .. "/.env")
    assert.equals(0, vim.system({ "git", "-C", root, "remote", "remove", "origin" }):wait().code)
    local missing_origin = S.collect(client)
    S.wait(function()
      return missing_origin.done
    end)
    assert.equals("Cannot read this project's Git origin", missing_origin.error)
    assert.equals(0, #http.requests)
  end)

  it("cancels the HTTP caller and ignores its late response", function()
    local result = S.collect(client)
    S.request(http, 1)
    result.cancel()
    assert.is_true(http.requests[1].cancelled)
    http:respond(1, { items = { { id = "late", status = "ACTIVE" } } })
    local drained = false
    vim.schedule(function()
      drained = true
    end)
    S.wait(function()
      return drained
    end)
    assert.is_false(result.done)
    assert.equals(1, #http.requests)
  end)

  it("accepts a synchronous HTTP fake while delivering the result asynchronously", function()
    local cancellations = 0
    local immediate = Cursor.new({
      root = root,
      http = function(_, callback)
        callback(nil, { status = 200, body = '{"items":[]}' })
        return function()
          cancellations = cancellations + 1
        end
      end,
    })
    local result = S.collect(immediate)
    assert.is_false(result.done)
    S.wait(function()
      return result.done
    end)
    assert.are.same({}, result.agents)
    result.cancel()
    assert.equals(0, cancellations)
  end)
  it("excludes archived list entries and entries archived before their details arrive", function()
    local result = S.collect(client)
    S.request(http, 1)
    local flagged = S.agent("flagged")
    flagged.archived = true
    http:respond(1, {
      items = {
        S.agent("gone", nil, "ARCHIVED"),
        flagged,
        { id = "changed", status = "ACTIVE" },
        S.agent("kept"),
      },
    })
    S.request(http, 2)
    http:respond(2, S.agent("changed", nil, "ARCHIVED"))
    S.wait(function()
      return result.done
    end)
    assert.are.same({ S.agent("kept") }, result.agents)
    assert.equals(2, #http.requests)
  end)

  it("fetches and validates conversation messages using the encoded selected ID", function()
    local done, error, messages = false, nil, nil
    client:get_conversation("id /?", function(err, result)
      error, messages, done = err, result, true
    end)
    local request = S.request(http, 1)
    assert.equals("GET", request.method)
    assert.equals("https://api.cursor.com/v0/agents/id%20%2F%3F/conversation", request.url)
    local expected = {
      { type = "user_message", text = "hello" },
      { type = "assistant_message", text = "one\ntwo" },
    }
    http:respond(1, { messages = expected })
    S.wait(function()
      return done
    end)
    assert.is_nil(error)
    assert.are.same(expected, messages)
  end)

  it("reports malformed conversation data and missing conversations", function()
    local error
    client:get_conversation("one", function(err)
      error = err
    end)
    S.request(http, 1)
    http:respond(1, { messages = { { type = "user_message" } } })
    S.wait(function()
      return error ~= nil
    end)
    assert.equals("Cursor returned an invalid conversation message", error)
    error = nil
    client:get_conversation("gone", function(err)
      error = err
    end)
    S.request(http, 2)
    http:respond(2, {}, 404)
    S.wait(function()
      return error ~= nil
    end)
    assert.matches("Cursor HTTP 404", error, 1, true)
  end)

  it(
    "starts a review on the pushed branch with an idempotent agent ID and grok-review prompt",
    function()
      local review = {
        repository = "https://github.com/ThePrimeagen/Oligarchy",
        branch = "review/wobbly-wombat-123abc",
        commit = string.rep("a", 40),
        agent_id = "bc-00000000-0000-4000-8000-000000000001",
      }
      local done, failure, agent
      client:create_review(review, function(err, value)
        failure, agent, done = err, value, true
      end)
      local call = S.request(http, 1)
      assert.equals("POST", call.method)
      assert.equals("https://api.cursor.com/v1/agents", call.url)
      local body = vim.json.decode(call.body)
      assert.equals(review.agent_id, body.agentId)
      assert.same({ { url = review.repository, startingRef = review.branch } }, body.repos)
      assert.is_true(body.workOnCurrentBranch)
      assert.is_false(body.autoCreatePR)
      assert.matches(".cursor/skills/grok-review/SKILL.md", body.prompt.text, 1, true)
      assert.matches(review.commit, body.prompt.text, 1, true)
      http:respond(1, { agent = S.agent(review.agent_id) })
      S.wait(function()
        return done
      end)
      assert.is_nil(failure)
      assert.equals(review.agent_id, agent.id)
      done = false
      client:create_review(review, function(err)
        failure, done = err, true
      end)
      S.request(http, 2)
      http:respond(2, { agent = S.agent("wrong-id") })
      S.wait(function()
        return done
      end)
      assert.equals("Cursor returned an invalid review agent", failure)
    end
  )

  it("archives with a bodyless POST and reports failures", function()
    local done, error = false, nil
    client:archive_agent("id /?", function(err)
      error, done = err, true
    end)
    local request = S.request(http, 1)
    assert.equals("POST", request.method)
    assert.equals("https://api.cursor.com/v1/agents/id%20%2F%3F/archive", request.url)
    assert.equals("Basic dGVzdC1rZXk6", request.headers.Authorization)
    assert.is_nil(request.body)
    http:respond(1, { id = "id /?" })
    S.wait(function()
      return done
    end)
    assert.is_nil(error)
    done = false
    client:archive_agent("two", function(err)
      error, done = err, true
    end)
    S.request(http, 2)
    http:respond(2, {}, 500)
    S.wait(function()
      return done
    end)
    assert.matches("Cursor HTTP 500", error, 1, true)
  end)
end)
