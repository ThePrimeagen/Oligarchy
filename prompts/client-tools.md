# drive

One JSON object.

- `status` is `continue` or `complete`. `continue` runs `action`. `complete` ends the run and does not run it.
- `actionTaken` is what you did, in a few words.
- `action._tag` is the action: `send-keys`, `move`, `click`, `double-click`, `scroll`, `drag`, `hold`, `release`, `get-image`, `get-serial`, `start`, `stop`, `save`, `reserve`, `relinquish`, `follow`.

You do not send the agent, the session, or the server.

## send-keys

Types the string `keys` on the keyboard. Letters go over as written. `A` is shift+a.

Special keys sit in angle brackets: `<ENTER>` `<ESC>` `<TAB>` `<BS>` `<DEL>` `<SPACE>` `<UP>` `<DOWN>` `<LEFT>` `<RIGHT>` `<HOME>` `<END>` `<PGUP>` `<PGDN>` `<F1>` through `<F24>`.

Modifiers: `<C-c>` control, `<A-x>` alt, `<S-x>` shift, `<M-x>` meta. Combine them: `<C-S-c>`. `<LT>` and `<GT>` are the characters `<` and `>`.

## mouse

`x` and `y` are fractions of the screenshot, from 0 to 1. 0 is the left or top edge. 1 is the right or bottom edge. `fromX`, `fromY`, `toX`, and `toY` are the same.

`button` is `left`, `middle`, or `right`. Leave it out for left.
`modifier` is any of `shift`, `ctrl`, `alt`, `super`.
`direction` is `up`, `down`, `left`, or `right`.
`ticks` is from 1 to 100. Leave it out for 1.

`move` takes `x` and `y`.
`click` and `double-click` take `x`, `y`, and optionally `button` and `modifier`.
`scroll` takes `x`, `y`, `direction`, and optionally `ticks`.
`drag` takes `fromX`, `fromY`, `toX`, `toY`, and optionally `button` and `modifier`.
`hold` and `release` take `x`, `y`, and optionally `button`.

## the rest

`get-image` and `get-serial` take nothing.
`start` takes optional `resume`, `iso`, and `disk`.
`stop` takes optional `status` (`succeeded`, `failed`, `aborted`, `completed`) and `reason`.
`save`, `reserve`, `relinquish`, and `follow` take nothing.
