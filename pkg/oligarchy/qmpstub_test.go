package oligarchy

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"time"
)

var stubPNG = []byte{0x89, 'P', 'N', 'G', 0x0d, 0x0a, 0x1a, 0x0a}

type noopProc struct{}

func (noopProc) Kill() error { return nil }

type connectingLauncher struct {
	fail error
	mute bool
}

func (l *connectingLauncher) Launch(sessionDir, socketPath string, cfg LaunchConfig) (Process, error) {
	if l.fail != nil {
		return nil, l.fail
	}
	if l.mute {
		return noopProc{}, nil
	}
	go dialAndServeQMP(socketPath)
	return noopProc{}, nil
}

func dialAndServeQMP(socketPath string) {
	var conn net.Conn
	var err error
	for i := 0; i < 50; i++ {
		conn, err = net.Dial("unix", socketPath)
		if err == nil {
			break
		}
		time.Sleep(5 * time.Millisecond)
	}
	if err != nil {
		return
	}
	serveQMP(conn)
}

func serveQMP(conn net.Conn) {
	defer conn.Close()
	enc := json.NewEncoder(conn)
	dec := json.NewDecoder(conn)
	_ = enc.Encode(map[string]any{
		"QMP": map[string]any{
			"version": map[string]any{
				"qemu":    map[string]any{"major": 11, "minor": 1, "micro": 0},
				"package": "",
			},
			"capabilities": []any{},
		},
	})
	for {
		var req struct {
			Execute   string          `json:"execute"`
			Arguments json.RawMessage `json:"arguments"`
			ID        any             `json:"id"`
		}
		if err := dec.Decode(&req); err != nil {
			return
		}
		switch req.Execute {
		case "qmp_capabilities":
			_ = enc.Encode(map[string]any{"return": map[string]any{}, "id": req.ID})
		case "screendump":
			var args struct {
				Filename string `json:"filename"`
			}
			_ = json.Unmarshal(req.Arguments, &args)
			if args.Filename != "" {
				_ = os.WriteFile(args.Filename, stubPNG, 0o644)
			}
			_ = enc.Encode(map[string]any{"return": map[string]any{}, "id": req.ID})
		case "send-key":
			_ = enc.Encode(map[string]any{"return": map[string]any{}, "id": req.ID})
		default:
			_ = enc.Encode(map[string]any{
				"error": map[string]any{
					"class": "GenericError",
					"desc":  fmt.Sprintf("unexpected command %s", req.Execute),
				},
				"id": req.ID,
			})
		}
	}
}
