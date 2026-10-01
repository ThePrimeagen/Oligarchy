local Review = require("oligarchy.review")
local S = require("support")

describe("Push & Review", function()
  local root, calls, launches, options, complete, error, result, cancel, prompt
  before_each(function()
    root = S.project()
    calls, launches = {}, {}
    complete, error, result, prompt = false, nil, nil, nil
    options = {
      root = root,
      run = function(args, settings, callback)
        local call = { args = args, settings = settings, complete = callback }
        table.insert(calls, call)
        return {
          kill = function(_, signal)
            call.signal = signal
          end,
        }
      end,
      input = function(_, callback)
        prompt = callback
      end,
      client = {
        create_review = function(_, request, callback)
          local call = { request = request, complete = callback }
          table.insert(launches, call)
          return function()
            call.cancelled = true
          end
        end,
      },
    }
  end)
  after_each(function()
    if cancel then
      cancel()
    end
    vim.fn.delete(root, "rf")
  end)
  local function start()
    cancel = Review.start(options, function(err, _, state)
      error, result, complete = err, state, true
    end)
  end
  local function respond(index, command, stdout, code)
    S.wait(function()
      return calls[index] ~= nil
    end)
    assert.equals(command, calls[index].args[4])
    calls[index].complete({ code = code or 0, stdout = stdout or "", stderr = "synthetic failure" })
  end
  local function prepare(changes)
    respond(1, "remote", "git@github.com:ThePrimeagen/Oligarchy.git\n")
    respond(2, "status", changes and " M tracked.lua\n?? new.lua\n" or "")
  end
  it("stages all local changes, commits them, then pushes and starts a review", function()
    start()
    prepare(true)
    S.wait(function()
      return prompt ~= nil
    end)
    prompt("Fix parser\n\nPreserve exact text")
    respond(3, "switch")
    assert.matches("^review/[a-z]+%-[a-z]+%-%x+$", calls[3].args[6])
    respond(4, "add")
    assert.equals("--all", calls[4].args[5])
    respond(5, "commit")
    assert.equals("Fix parser\n\nPreserve exact text", calls[5].settings.stdin)
    respond(6, "rev-parse", string.rep("a", 40) .. "\n")
    respond(7, "cat-file")
    respond(8, "push")
    S.wait(function()
      return #launches == 1
    end)
    local request = launches[1].request
    assert.equals("https://github.com/ThePrimeagen/Oligarchy", request.repository)
    assert.equals(string.rep("a", 40), request.commit)
    assert.equals(request.commit .. ":refs/heads/" .. request.branch, calls[8].args[6])
    launches[1].complete(nil, S.agent(request.agent_id))
    S.wait(function()
      return complete
    end)
    assert.is_nil(error)
    assert.equals(request.branch, result.branch)
  end)
  it("stops on a clean worktree without prompting, branching, pushing or launching", function()
    start()
    prepare(false)
    S.wait(function()
      return complete
    end)
    assert.equals("No local changes to review", error)
    assert.is_nil(prompt)
    assert.equals(2, #calls)
    assert.equals(0, #launches)
    assert.is_nil(result.branch)
  end)
  it("starts the review on the HTTPS repository for credential, SSH and scp origins", function()
    for _, remote in ipairs({
      "https://x-access-token:secret@github.com/ThePrimeagen/Oligarchy\n",
      "ssh://git@github.com:22/ThePrimeagen/Oligarchy.git/\n",
      "ssh://github.com/ThePrimeagen/Oligarchy.git\n",
      "git@github.com:ThePrimeagen/Oligarchy.git\n",
    }) do
      calls, complete = {}, false
      start()
      respond(1, "remote", remote)
      respond(2, "status", "")
      S.wait(function()
        return complete
      end)
      assert.equals("https://github.com/ThePrimeagen/Oligarchy", result.repository)
    end
  end)
  it("rejects an origin that is not HTTPS or SSH before checking local changes", function()
    start()
    respond(1, "remote", "/srv/git/Oligarchy.git\n")
    S.wait(function()
      return complete
    end)
    assert.equals("Push & Review needs an HTTPS or SSH origin URL", error)
    assert.equals(1, #calls)
    assert.is_nil(result.repository)
  end)
  it("cancels the commit prompt without creating a branch", function()
    start()
    prepare(true)
    S.wait(function()
      return prompt ~= nil
    end)
    prompt(nil)
    S.wait(function()
      return complete
    end)
    assert.equals("Push & Review cancelled", error)
    assert.equals(2, #calls)
    assert.equals(0, #launches)
  end)
  it("keeps the branch and stops when committing fails", function()
    start()
    prepare(true)
    S.wait(function()
      return prompt ~= nil
    end)
    prompt("Review this change")
    respond(3, "switch")
    respond(4, "add")
    respond(5, "commit", "", 1)
    S.wait(function()
      return complete
    end)
    assert.matches("Commit local changes failed", error, 1, true)
    assert.is_string(result.branch)
    assert.equals(5, #calls)
    assert.equals(0, #launches)
  end)
  it("does not commit or push if staging local changes fails", function()
    start()
    prepare(true)
    S.wait(function()
      return prompt ~= nil
    end)
    prompt("Review this change")
    respond(3, "switch")
    respond(4, "add", "", 1)
    S.wait(function()
      return complete
    end)
    assert.matches("Stage local changes failed", error, 1, true)
    assert.equals(4, #calls)
    assert.equals(0, #launches)
  end)
  it("does not launch a job if pushing the new commit fails", function()
    start()
    prepare(true)
    S.wait(function()
      return prompt ~= nil
    end)
    prompt("Review this change")
    respond(3, "switch")
    respond(4, "add")
    respond(5, "commit")
    respond(6, "rev-parse", string.rep("b", 40))
    respond(7, "cat-file")
    respond(8, "push", "", 1)
    S.wait(function()
      return complete
    end)
    assert.matches("Push failed", error, 1, true)
    assert.equals(0, #launches)
  end)
  it("reports an uncertain launch without pushing again or retrying the job", function()
    start()
    prepare(true)
    S.wait(function()
      return prompt ~= nil
    end)
    prompt("Review these local changes")
    respond(3, "switch")
    respond(4, "add")
    respond(5, "commit")
    respond(6, "rev-parse", string.rep("c", 40))
    respond(7, "cat-file")
    respond(8, "push")
    S.wait(function()
      return #launches == 1
    end)
    launches[1].complete("Cursor request timed out")
    S.wait(function()
      return complete
    end)
    assert.is_true(result.pushed)
    assert.matches("may have been accepted", error, 1, true)
    assert.equals(8, #calls)
    assert.equals(1, #launches)
  end)
  it("suppresses later steps after cancellation", function()
    start()
    S.wait(function()
      return calls[1] ~= nil
    end)
    cancel()
    assert.equals(15, calls[1].signal)
    calls[1].complete({ code = 0, stdout = "git@github.com:o/r.git", stderr = "" })
    local drained = false
    vim.schedule(function()
      drained = true
    end)
    S.wait(function()
      return drained
    end)
    assert.equals(1, #calls)
    assert.is_false(complete)
  end)
end)
