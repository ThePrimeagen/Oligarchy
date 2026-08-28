package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"theprimeagen.com/yourmomma/pkg/kemu"
	"theprimeagen.com/yourmomma/pkg/oligarchy"
)

func main() {
	if len(os.Args) < 2 {
		usage()
		os.Exit(2)
	}
	var err error
	switch os.Args[1] {
	case "start":
		err = cmdStart(os.Args[2:])
	case "get-image":
		err = cmdGetImage(os.Args[2:])
	case "send-keys":
		err = cmdSendKeys(os.Args[2:])
	default:
		usage()
		os.Exit(2)
	}
	if err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}

func usage() {
	fmt.Fprintf(os.Stderr, `oligarchy is the client for oligarchy-server

Usage:
  oligarchy start [-iso path] [-disk path]
  oligarchy get-image <id> [-o file]
  oligarchy send-keys <id> <keys> [encoding]

`)
}

func addr() string {
	if v := os.Getenv("OLIGARCHY_ADDR"); v != "" {
		return v
	}
	return oligarchy.DefaultAddr
}

func parseStartArgs(args []string) (oligarchy.LaunchConfig, error) {
	fs := flag.NewFlagSet("start", flag.ContinueOnError)
	fs.SetOutput(io.Discard)
	iso := fs.String("iso", oligarchy.DefaultISO, "guest ISO path")
	disk := fs.String("disk", "", "qcow2 disk path (created if missing)")
	diskSize := fs.String("disk-size", "", "qcow2 virtual size when creating")
	vars := fs.String("vars", "", "OVMF_VARS template path")
	code := fs.String("code", "", "OVMF_CODE firmware path")
	mem := fs.String("m", "", "guest memory")
	smp := fs.Int("smp", 0, "guest SMP count")
	if err := fs.Parse(args); err != nil {
		return oligarchy.LaunchConfig{}, err
	}
	if fs.NArg() != 0 {
		return oligarchy.LaunchConfig{}, fmt.Errorf("usage: oligarchy start [-iso path] [-disk path]")
	}
	isoPath, err := filepath.Abs(*iso)
	if err != nil {
		return oligarchy.LaunchConfig{}, err
	}
	if _, err := os.Stat(isoPath); err != nil {
		return oligarchy.LaunchConfig{}, fmt.Errorf("iso: %w", err)
	}
	diskPath := *disk
	if diskPath != "" {
		diskPath, err = filepath.Abs(diskPath)
		if err != nil {
			return oligarchy.LaunchConfig{}, err
		}
	}
	return oligarchy.LaunchConfig{
		ISO:      isoPath,
		Disk:     diskPath,
		DiskSize: *diskSize,
		VarsFD:   *vars,
		CodeFD:   *code,
		Memory:   *mem,
		SMP:      *smp,
	}, nil
}

func cmdStart(args []string) error {
	cfg, err := parseStartArgs(args)
	if err != nil {
		return err
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := postJSON("/start", cfg, &out); err != nil {
		return err
	}
	fmt.Println(out.ID)
	return nil
}

func cmdGetImage(args []string) error {
	var id, out string
	for i := 0; i < len(args); i++ {
		if args[i] == "-o" && i+1 < len(args) {
			out = args[i+1]
			i++
			continue
		}
		if id == "" && !strings.HasPrefix(args[i], "-") {
			id = args[i]
			continue
		}
		return fmt.Errorf("usage: oligarchy get-image <id> [-o file]")
	}
	if id == "" {
		return fmt.Errorf("usage: oligarchy get-image <id> [-o file]")
	}
	resp, err := http.Get("http://" + addr() + "/image?id=" + url.QueryEscape(id))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("%s", readAPIError(resp.Body))
	}
	data, err := io.ReadAll(resp.Body)
	if err != nil {
		return err
	}
	if out != "" {
		return os.WriteFile(out, data, 0o644)
	}
	_, err = os.Stdout.Write(data)
	return err
}

func cmdSendKeys(args []string) error {
	fs := flag.NewFlagSet("send-keys", flag.ExitOnError)
	if err := fs.Parse(args); err != nil {
		return err
	}
	if fs.NArg() < 2 || fs.NArg() > 3 {
		return fmt.Errorf("usage: oligarchy send-keys <id> <keys> [encoding]")
	}
	encoding := string(kemu.EncodingOligarchy)
	if fs.NArg() == 3 {
		encoding = fs.Arg(2)
	}
	return postJSON("/send-keys", map[string]string{
		"id":       fs.Arg(0),
		"keys":     fs.Arg(1),
		"encoding": encoding,
	}, nil)
}

func postJSON(path string, body any, dest any) error {
	raw, err := json.Marshal(body)
	if err != nil {
		return err
	}
	resp, err := http.Post("http://"+addr()+path, "application/json", bytes.NewReader(raw))
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%s", readAPIError(resp.Body))
	}
	if dest == nil {
		_, _ = io.Copy(io.Discard, resp.Body)
		return nil
	}
	return json.NewDecoder(resp.Body).Decode(dest)
}

func readAPIError(r io.Reader) string {
	var body struct {
		Error string `json:"error"`
	}
	data, err := io.ReadAll(r)
	if err != nil {
		return err.Error()
	}
	if json.Unmarshal(data, &body) == nil && body.Error != "" {
		return body.Error
	}
	if len(data) > 0 {
		return string(data)
	}
	return "request failed"
}
