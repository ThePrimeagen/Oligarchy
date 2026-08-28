package kemu

import (
	"encoding/json"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"sync"
	"time"

	"theprimeagen.com/yourmomma/pkg/qmp"
)

// KemuServer is a QMP client connected to one QEMU instance.
type KemuServer struct {
	path     string
	conn     net.Conn
	enc      *json.Encoder
	dec      *json.Decoder
	mu       sync.Mutex
	nextID   int
	Greeting qmp.Greeting
}

type wireResponse struct {
	Event  string          `json:"event"`
	Return json.RawMessage `json:"return"`
	Error  *qmp.Error      `json:"error"`
	ID     json.RawMessage `json:"id"`
}

// NewKemuServer dials the QMP unix socket, reads the greeting, and
// completes capabilities negotiation.
func NewKemuServer(socketPath string) (*KemuServer, error) {
	conn, err := net.Dial("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("kemu: dial %s: %w", socketPath, err)
	}
	s, err := NewKemuServerFromConn(conn)
	if err != nil {
		return nil, err
	}
	s.path = socketPath
	return s, nil
}

// NewKemuServerFromConn takes an accepted QMP connection, reads the
// greeting, and completes capabilities negotiation.
func NewKemuServerFromConn(conn net.Conn) (*KemuServer, error) {
	s := &KemuServer{
		conn: conn,
		enc:  json.NewEncoder(conn),
		dec:  json.NewDecoder(conn),
	}
	if err := s.dec.Decode(&s.Greeting); err != nil {
		conn.Close()
		return nil, fmt.Errorf("kemu: greeting: %w", err)
	}
	if _, err := Execute(s, qmp.QmpCapabilities(qmp.QmpCapabilitiesArgs{})); err != nil {
		conn.Close()
		return nil, fmt.Errorf("kemu: qmp_capabilities: %w", err)
	}
	return s, nil
}

// Close closes the QMP connection.
func (s *KemuServer) Close() error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conn == nil {
		return nil
	}
	err := s.conn.Close()
	s.conn = nil
	return err
}

// Do sends a named QMP command and decodes the success return into result.
func (s *KemuServer) Do(name string, args any, result any) error {
	return s.do(name, args, result)
}

func (s *KemuServer) do(name string, args any, result any) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.conn == nil {
		return fmt.Errorf("kemu: closed")
	}
	s.nextID++
	id := s.nextID
	req := map[string]any{
		"execute": name,
		"id":      id,
	}
	if args != nil {
		req["arguments"] = args
	}
	if err := s.enc.Encode(req); err != nil {
		return fmt.Errorf("kemu: send %s: %w", name, err)
	}
	want, err := json.Marshal(id)
	if err != nil {
		return err
	}
	for {
		var msg wireResponse
		if err := s.dec.Decode(&msg); err != nil {
			return fmt.Errorf("kemu: recv %s: %w", name, err)
		}
		if msg.Event != "" {
			continue
		}
		if len(msg.ID) > 0 && string(msg.ID) != string(want) {
			continue
		}
		if msg.Error != nil {
			return msg.Error
		}
		if result == nil || len(msg.Return) == 0 {
			return nil
		}
		if err := json.Unmarshal(msg.Return, result); err != nil {
			return fmt.Errorf("kemu: decode %s: %w", name, err)
		}
		return nil
	}
}

// Execute runs a typed QMP command and returns that command's result type.
func Execute[A any, R any](s *KemuServer, cmd qmp.Command[A, R]) (R, error) {
	var ret R
	var args any
	if cmd.HasArgs() {
		args = cmd.Args
	}
	err := s.do(cmd.Name(), args, &ret)
	return ret, err
}

// ReadImage captures the current guest display as a PNG.
func (s *KemuServer) ReadImage() ([]byte, error) {
	path := filepath.Join(os.TempDir(), fmt.Sprintf("oligarchy-%d-%d.png", os.Getpid(), time.Now().UnixNano()))
	format := qmp.ImageFormatPng
	if _, err := Execute(s, qmp.Screendump(qmp.ScreendumpArgs{
		Filename: path,
		Format:   &format,
	})); err != nil {
		return nil, fmt.Errorf("kemu: screendump: %w", err)
	}
	defer os.Remove(path)
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("kemu: read screendump: %w", err)
	}
	return data, nil
}

// SendKeys types keys into the guest using the given encoding.
func (s *KemuServer) SendKeys(keys string, encoding KeyEncoding) error {
	chords, err := ParseKeys(keys, encoding)
	if err != nil {
		return err
	}
	for _, chord := range chords {
		vals := make([]qmp.KeyValue, len(chord))
		for i, code := range chord {
			vals[i] = qmp.QCode(code)
		}
		if _, err := Execute(s, qmp.SendKey(qmp.SendKeyArgs{Keys: vals})); err != nil {
			return fmt.Errorf("kemu: send-key: %w", err)
		}
	}
	return nil
}
