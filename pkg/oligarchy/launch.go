package oligarchy

import (
	"bytes"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
)

const (
	DefaultQEMUBin  = "qemu-system-x86_64"
	DefaultQEMUImg  = "qemu-img"
	DefaultISO      = "omarchy.iso"
	DefaultDiskSize = "40G"
	DefaultCodeFD   = "/usr/share/edk2/x64/OVMF_CODE.4m.fd"
	DefaultVarsFD   = "/usr/share/edk2/x64/OVMF_VARS.4m.fd"
	DefaultMemory   = "4G"
	DefaultSMP      = 2
	DefaultMachine  = "q35,accel=kvm"
	DefaultCPU      = "host"
)

// LaunchConfig describes the guest we spawn for a session.
type LaunchConfig struct {
	ISO      string `json:"iso"`
	Disk     string `json:"disk"`
	DiskSize string `json:"disk_size"`
	CodeFD   string `json:"code"`
	VarsFD   string `json:"vars"`
	Memory   string `json:"memory"`
	SMP      int    `json:"smp"`
}

// Process is a launched QEMU (or test double).
type Process interface {
	Kill() error
}

// Launcher starts QEMU so it connects to the given QMP unix socket.
type Launcher interface {
	Launch(sessionDir, socketPath string, cfg LaunchConfig) (Process, error)
}

// QEMULauncher execs qemu-system-x86_64.
type QEMULauncher struct {
	Bin    string
	ImgBin string
}

type qemuProc struct {
	cmd *exec.Cmd
}

func (p *qemuProc) Kill() error {
	if p == nil || p.cmd == nil || p.cmd.Process == nil {
		return nil
	}
	return p.cmd.Process.Kill()
}

func applyDefaults(cfg LaunchConfig) LaunchConfig {
	if cfg.ISO == "" {
		cfg.ISO = DefaultISO
	}
	if cfg.DiskSize == "" {
		cfg.DiskSize = DefaultDiskSize
	}
	if cfg.Memory == "" {
		cfg.Memory = DefaultMemory
	}
	if cfg.SMP == 0 {
		cfg.SMP = DefaultSMP
	}
	if cfg.CodeFD == "" {
		cfg.CodeFD = DefaultCodeFD
	}
	if cfg.VarsFD == "" {
		cfg.VarsFD = DefaultVarsFD
	}
	return cfg
}

func qemuArgs(socketPath, varsPath string, cfg LaunchConfig) ([]string, error) {
	if socketPath == "" {
		return nil, fmt.Errorf("qmp socket path is required")
	}
	cfg = applyDefaults(cfg)
	if varsPath == "" {
		return nil, fmt.Errorf("firmware vars path is required")
	}
	args := []string{
		"-machine", DefaultMachine,
		"-cpu", DefaultCPU,
		"-m", cfg.Memory,
		"-smp", strconv.Itoa(cfg.SMP),
		"-drive", fmt.Sprintf("if=pflash,format=raw,readonly=on,file=%s", cfg.CodeFD),
		"-drive", fmt.Sprintf("if=pflash,format=raw,file=%s", varsPath),
		"-display", "none",
		"-chardev", fmt.Sprintf("socket,id=qmp,path=%s", socketPath),
		"-mon", "chardev=qmp,mode=control",
	}
	if cfg.ISO != "" {
		args = append(args, "-cdrom", cfg.ISO, "-boot", "order=d")
	}
	if cfg.Disk != "" {
		args = append(args, "-drive", fmt.Sprintf("file=%s,if=virtio,format=qcow2", cfg.Disk))
	}
	return args, nil
}

func (l QEMULauncher) Launch(sessionDir, socketPath string, cfg LaunchConfig) (Process, error) {
	cfg = applyDefaults(cfg)
	iso, err := resolveExisting(cfg.ISO)
	if err != nil {
		return nil, fmt.Errorf("iso: %w", err)
	}
	cfg.ISO = iso

	if cfg.Disk == "" {
		cfg.Disk = filepath.Join(sessionDir, "disk.qcow2")
	} else {
		cfg.Disk, err = filepath.Abs(cfg.Disk)
		if err != nil {
			return nil, fmt.Errorf("disk: %w", err)
		}
	}
	if err := createQCow2(l.ImgBin, cfg.Disk, cfg.DiskSize); err != nil {
		return nil, fmt.Errorf("disk: %w", err)
	}

	varsPath := filepath.Join(sessionDir, "OVMF_VARS.fd")
	if err := copyFile(cfg.VarsFD, varsPath); err != nil {
		return nil, fmt.Errorf("firmware vars: %w", err)
	}
	args, err := qemuArgs(socketPath, varsPath, cfg)
	if err != nil {
		return nil, err
	}
	bin := l.Bin
	if bin == "" {
		bin = DefaultQEMUBin
	}
	cmd := exec.Command(bin, args...)
	var buf bytes.Buffer
	cmd.Stdout = &buf
	cmd.Stderr = &buf
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("qemu: %w: %s", err, buf.String())
	}
	return &qemuProc{cmd: cmd}, nil
}

func resolveExisting(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if _, err := os.Stat(abs); err != nil {
		return "", err
	}
	return abs, nil
}

func createQCow2(imgBin, path, size string) error {
	if _, err := os.Stat(path); err == nil {
		return nil
	} else if !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	if imgBin == "" {
		imgBin = DefaultQEMUImg
	}
	cmd := exec.Command(imgBin, "create", "-f", "qcow2", path, size)
	out, err := cmd.CombinedOutput()
	if err != nil {
		return fmt.Errorf("qemu-img create: %w: %s", err, bytes.TrimSpace(out))
	}
	return nil
}

func copyFile(src, dst string) error {
	in, err := os.Open(src)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(dst, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		return err
	}
	defer out.Close()
	_, err = io.Copy(out, in)
	return err
}
