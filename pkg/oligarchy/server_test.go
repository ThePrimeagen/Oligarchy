package oligarchy

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
	"time"
)

var uuidV4 = regexp.MustCompile(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$`)

func newTestServer(t *testing.T, launcher Launcher) *OligarchyServer {
	t.Helper()
	dir := filepath.Join(os.TempDir(), fmt.Sprintf("imp-%d", time.Now().UnixNano()))
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	s := NewOligarchyServer("")
	s.SocketDir = dir
	s.Launcher = launcher
	s.AcceptTimeout = 2 * time.Second
	return s
}

func TestStartReturnsUUID(t *testing.T) {
	s := newTestServer(t, &connectingLauncher{})
	id, err := s.Start(LaunchConfig{})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if !uuidV4.MatchString(id) {
		t.Fatalf("Start returned %q, want a UUID v4", id)
	}
}

func TestStartCreatesSessionDirUnderTmp(t *testing.T) {
	s := newTestServer(t, &connectingLauncher{})
	id, err := s.Start(LaunchConfig{})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	dir := filepath.Join(s.SocketDir, "oligarchy-"+id)
	sock := filepath.Join(dir, "qmp.sock")
	info, err := os.Stat(dir)
	if err != nil {
		t.Fatalf("session dir: %v", err)
	}
	if !info.IsDir() {
		t.Fatalf("%s is not a directory", dir)
	}
	if _, err := os.Stat(sock); err != nil {
		t.Fatalf("qmp socket: %v", err)
	}
}

func TestTwoStartsGetDistinctIDs(t *testing.T) {
	s := newTestServer(t, &connectingLauncher{})
	a, err := s.Start(LaunchConfig{})
	if err != nil {
		t.Fatalf("Start a: %v", err)
	}
	b, err := s.Start(LaunchConfig{})
	if err != nil {
		t.Fatalf("Start b: %v", err)
	}
	if a == b {
		t.Fatalf("both starts returned %q", a)
	}
}

func TestGetImageUnknownSession(t *testing.T) {
	s := newTestServer(t, &connectingLauncher{})
	_, err := s.GetImage("00000000-0000-4000-8000-000000000000")
	if err == nil {
		t.Fatal("expected error for unknown session")
	}
}

func TestSendKeysUnknownSession(t *testing.T) {
	s := newTestServer(t, &connectingLauncher{})
	err := s.SendKeys("00000000-0000-4000-8000-000000000000", "a", "")
	if err == nil {
		t.Fatal("expected error for unknown session")
	}
}

func TestGetImageUsesSessionID(t *testing.T) {
	s := newTestServer(t, &connectingLauncher{})
	id, err := s.Start(LaunchConfig{})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	data, err := s.GetImage(id)
	if err != nil {
		t.Fatalf("GetImage: %v", err)
	}
	if !bytes.Equal(data, stubPNG) {
		t.Fatalf("GetImage returned %v, want stub PNG", data)
	}
}

func TestSendKeysUsesSessionID(t *testing.T) {
	s := newTestServer(t, &connectingLauncher{})
	id, err := s.Start(LaunchConfig{})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	if err := s.SendKeys(id, "a", ""); err != nil {
		t.Fatalf("SendKeys: %v", err)
	}
}

func TestStartLaunchErrorLeavesNoSession(t *testing.T) {
	s := newTestServer(t, &connectingLauncher{fail: fmt.Errorf("qemu exploded")})
	id, err := s.Start(LaunchConfig{})
	if err == nil {
		t.Fatal("expected launch error")
	}
	if id != "" {
		t.Fatalf("id=%q on failure", id)
	}
	s.mu.Lock()
	n := len(s.sessions)
	s.mu.Unlock()
	if n != 0 {
		t.Fatalf("sessions=%d, want 0", n)
	}
}

func TestStartNoQMPConnectionFails(t *testing.T) {
	s := newTestServer(t, &connectingLauncher{mute: true})
	s.AcceptTimeout = 50 * time.Millisecond
	id, err := s.Start(LaunchConfig{})
	if err == nil {
		t.Fatal("expected timeout error")
	}
	if id != "" {
		t.Fatalf("id=%q on failure", id)
	}
	s.mu.Lock()
	n := len(s.sessions)
	s.mu.Unlock()
	if n != 0 {
		t.Fatalf("sessions=%d, want 0", n)
	}
}

func TestHandleStartReturnsID(t *testing.T) {
	s := newTestServer(t, &connectingLauncher{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	resp, err := http.Post(ts.URL+"/start", "application/json", strings.NewReader(`{"iso":"a.iso","disk":"d.qcow2"}`))
	if err != nil {
		t.Fatalf("POST /start: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d: %s", resp.StatusCode, body)
	}
	var out struct {
		ID   string `json:"id"`
		Name string `json:"name"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		t.Fatalf("decode: %v", err)
	}
	if !uuidV4.MatchString(out.ID) {
		t.Fatalf("id=%q, want UUID v4", out.ID)
	}
	if out.Name != "" {
		t.Fatalf("name should not be returned, got %q", out.Name)
	}
}

func TestHandleImageRequiresID(t *testing.T) {
	s := newTestServer(t, &connectingLauncher{})
	id, err := s.Start(LaunchConfig{})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/image?name=" + id)
	if err != nil {
		t.Fatalf("GET /image?name=: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		t.Fatal("GET /image?name= should not succeed; id is required")
	}

	resp, err = http.Get(ts.URL + "/image?id=" + id)
	if err != nil {
		t.Fatalf("GET /image?id=: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d: %s", resp.StatusCode, body)
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		t.Fatalf("read: %v", err)
	}
	if !bytes.Equal(data, stubPNG) {
		t.Fatalf("body=%v, want stub PNG", data)
	}
}

func TestHandleSendKeysRequiresID(t *testing.T) {
	s := newTestServer(t, &connectingLauncher{})
	id, err := s.Start(LaunchConfig{})
	if err != nil {
		t.Fatalf("Start: %v", err)
	}
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	resp, err := http.Post(ts.URL+"/send-keys", "application/json", strings.NewReader(`{"name":"`+id+`","keys":"a"}`))
	if err != nil {
		t.Fatalf("POST name: %v", err)
	}
	resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		t.Fatal("POST /send-keys with name should not succeed; id is required")
	}

	resp, err = http.Post(ts.URL+"/send-keys", "application/json", strings.NewReader(`{"id":"`+id+`","keys":"a"}`))
	if err != nil {
		t.Fatalf("POST id: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(resp.Body)
		t.Fatalf("status %d: %s", resp.StatusCode, body)
	}
}

func TestHandleImageUnknownID(t *testing.T) {
	s := newTestServer(t, &connectingLauncher{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	resp, err := http.Get(ts.URL + "/image?id=00000000-0000-4000-8000-000000000000")
	if err != nil {
		t.Fatalf("GET: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		t.Fatal("unknown id should not return 200")
	}
}

func TestHandleSendKeysUnknownID(t *testing.T) {
	s := newTestServer(t, &connectingLauncher{})
	ts := httptest.NewServer(s.Handler())
	t.Cleanup(ts.Close)

	resp, err := http.Post(ts.URL+"/send-keys", "application/json", strings.NewReader(`{"id":"00000000-0000-4000-8000-000000000000","keys":"a"}`))
	if err != nil {
		t.Fatalf("POST: %v", err)
	}
	defer resp.Body.Close()
	if resp.StatusCode == http.StatusOK {
		t.Fatal("unknown id should not return 200")
	}
}
