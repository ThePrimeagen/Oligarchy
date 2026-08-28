package qmp

// Command is a typed QMP request. Args is the wire arguments object and
// Result is the success "return" value for that command.
type Command[Args any, Result any] struct {
	name string
	Args Args
}

func (c Command[Args, Result]) Name() string { return c.name }

func (c Command[Args, Result]) HasArgs() bool {
	var zero Args
	_, empty := any(zero).(Empty)
	return !empty
}
