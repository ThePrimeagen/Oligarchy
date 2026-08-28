package qmp

import "fmt"

// Greeting is the object QEMU writes immediately after a QMP connection.
// See https://www.qemu.org/docs/master/interop/qmp-spec.html
type Greeting struct {
	QMP GreetingInfo `json:"QMP"`
}

// GreetingInfo is the body of the QMP greeting.
type GreetingInfo struct {
	Version      VersionInfo     `json:"version"`
	Capabilities []QMPCapability `json:"capabilities"`
}

// Error is a QMP error response.
type Error struct {
	Class string `json:"class"`
	Desc  string `json:"desc"`
}

func (e *Error) Error() string {
	if e == nil {
		return "qmp: empty error"
	}
	return fmt.Sprintf("%s: %s", e.Class, e.Desc)
}

// QCode builds a KeyValue qcode variant.
func QCode(code QKeyCode) KeyValue {
	return KeyValue{Type_: KeyValueKindQcode, Data: code}
}
