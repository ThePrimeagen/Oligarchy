package oligarchy

import (
	"crypto/rand"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"sync"
	"time"

	"theprimeagen.com/yourmomma/pkg/kemu"
)

const DefaultAddr = "127.0.0.1:42069"

type session struct {
	kemu *kemu.KemuServer
	proc Process
	dir  string
	ln   net.Listener
}

// OligarchyServer is the session daemon in front of KemuServer.
type OligarchyServer struct {
	Addr          string
	SocketDir     string
	Launcher      Launcher
	AcceptTimeout time.Duration
	mu            sync.Mutex
	sessions      map[string]*session
}

// NewOligarchyServer builds a daemon that listens on addr.
func NewOligarchyServer(addr string) *OligarchyServer {
	if addr == "" {
		addr = DefaultAddr
	}
	return &OligarchyServer{
		Addr:     addr,
		sessions: map[string]*session{},
	}
}

func (s *OligarchyServer) socketDir() string {
	if s.SocketDir != "" {
		return s.SocketDir
	}
	return os.TempDir()
}

func (s *OligarchyServer) launcher() Launcher {
	if s.Launcher != nil {
		return s.Launcher
	}
	return QEMULauncher{}
}

func (s *OligarchyServer) acceptTimeout() time.Duration {
	if s.AcceptTimeout > 0 {
		return s.AcceptTimeout
	}
	return 10 * time.Second
}

// Start creates a session directory under SocketDir (default /tmp),
// listens on a QMP unix socket, launches QEMU against that socket, and
// returns the session UUID.
func (s *OligarchyServer) Start(cfg LaunchConfig) (string, error) {
	id, err := newSessionID()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(s.socketDir(), "oligarchy-"+id)
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return "", fmt.Errorf("session dir: %w", err)
	}
	sock := filepath.Join(dir, "qmp.sock")
	_ = os.Remove(sock)
	ln, err := net.Listen("unix", sock)
	if err != nil {
		os.RemoveAll(dir)
		return "", fmt.Errorf("qmp listen: %w", err)
	}

	cleanup := func() {
		_ = ln.Close()
		_ = os.RemoveAll(dir)
	}

	proc, err := s.launcher().Launch(dir, sock, cfg)
	if err != nil {
		cleanup()
		return "", err
	}
	conn, err := acceptTimeout(ln, s.acceptTimeout())
	if err != nil {
		_ = proc.Kill()
		cleanup()
		return "", fmt.Errorf("qmp accept: %w", err)
	}
	ks, err := kemu.NewKemuServerFromConn(conn)
	if err != nil {
		_ = proc.Kill()
		cleanup()
		return "", err
	}

	s.mu.Lock()
	s.sessions[id] = &session{kemu: ks, proc: proc, dir: dir, ln: ln}
	s.mu.Unlock()
	return id, nil
}

func acceptTimeout(ln net.Listener, d time.Duration) (net.Conn, error) {
	if ul, ok := ln.(*net.UnixListener); ok {
		if err := ul.SetDeadline(time.Now().Add(d)); err != nil {
			return nil, err
		}
		defer ul.SetDeadline(time.Time{})
	}
	return ln.Accept()
}

func newSessionID() (string, error) {
	var b [16]byte
	if _, err := rand.Read(b[:]); err != nil {
		return "", err
	}
	b[6] = (b[6] & 0x0f) | 0x40
	b[8] = (b[8] & 0x3f) | 0x80
	return fmt.Sprintf("%x-%x-%x-%x-%x", b[0:4], b[4:6], b[6:8], b[8:10], b[10:]), nil
}

func (s *OligarchyServer) session(id string) (*kemu.KemuServer, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	sess, ok := s.sessions[id]
	if !ok {
		return nil, fmt.Errorf("unknown session %q", id)
	}
	return sess.kemu, nil
}

// GetImage returns the current desktop image for a session.
func (s *OligarchyServer) GetImage(id string) ([]byte, error) {
	ks, err := s.session(id)
	if err != nil {
		return nil, err
	}
	return ks.ReadImage()
}

// SendKeys types keys into a session.
func (s *OligarchyServer) SendKeys(id, keys, encoding string) error {
	ks, err := s.session(id)
	if err != nil {
		return err
	}
	return ks.SendKeys(keys, kemu.KeyEncoding(encoding))
}

// Handler returns the HTTP control plane.
func (s *OligarchyServer) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("POST /start", s.handleStart)
	mux.HandleFunc("GET /image", s.handleImage)
	mux.HandleFunc("POST /send-keys", s.handleSendKeys)
	return mux
}

// ListenAndServe starts the HTTP control plane.
func (s *OligarchyServer) ListenAndServe() error {
	return http.ListenAndServe(s.Addr, s.Handler())
}

type sendKeysRequest struct {
	ID       string `json:"id"`
	Keys     string `json:"keys"`
	Encoding string `json:"encoding"`
}

type errorBody struct {
	Error string `json:"error"`
}

func writeError(w http.ResponseWriter, status int, err error) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(errorBody{Error: err.Error()})
}

func (s *OligarchyServer) handleStart(w http.ResponseWriter, r *http.Request) {
	var req LaunchConfig
	dec := json.NewDecoder(r.Body)
	if err := dec.Decode(&req); err != nil && err != io.EOF {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	id, err := s.Start(req)
	if err != nil {
		writeError(w, http.StatusInternalServerError, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"id": id})
}

func (s *OligarchyServer) handleImage(w http.ResponseWriter, r *http.Request) {
	id := r.URL.Query().Get("id")
	if id == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("session id is required"))
		return
	}
	data, err := s.GetImage(id)
	if err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.Header().Set("Content-Type", "image/png")
	w.Header().Set("Content-Length", fmt.Sprintf("%d", len(data)))
	_, _ = w.Write(data)
}

func (s *OligarchyServer) handleSendKeys(w http.ResponseWriter, r *http.Request) {
	var req sendKeysRequest
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	if req.ID == "" {
		writeError(w, http.StatusBadRequest, fmt.Errorf("session id is required"))
		return
	}
	if err := s.SendKeys(req.ID, req.Keys, req.Encoding); err != nil {
		writeError(w, http.StatusBadRequest, err)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"ok": "true"})
}
