package oligarchy

import (
	"strings"
	"testing"
)

func TestQEMUArgsHeadlessDisplay(t *testing.T) {
	args, err := qemuArgs("/tmp/oligarchy-x/qmp.sock", "/tmp/oligarchy-x/OVMF_VARS.fd", LaunchConfig{
		ISO:  "/iso.iso",
		Disk: "/disk.qcow2",
	})
	if err != nil {
		t.Fatalf("qemuArgs: %v", err)
	}
	joined := strings.Join(args, " ")
	if !containsArg(args, "-display", "none") {
		t.Fatalf("expected -display none, got %s", joined)
	}
	if strings.Contains(joined, "gtk") {
		t.Fatalf("did not expect gtk display, got %s", joined)
	}
}

func TestQEMUArgsQMPClientSocket(t *testing.T) {
	sock := "/tmp/oligarchy-x/qmp.sock"
	args, err := qemuArgs(sock, "/tmp/oligarchy-x/OVMF_VARS.fd", LaunchConfig{
		ISO:  "/iso.iso",
		Disk: "/disk.qcow2",
	})
	if err != nil {
		t.Fatalf("qemuArgs: %v", err)
	}
	joined := strings.Join(args, " ")
	if !strings.Contains(joined, sock) {
		t.Fatalf("expected socket path in args, got %s", joined)
	}
	if strings.Contains(joined, "server=on") || strings.Contains(joined, "server,") {
		t.Fatalf("QEMU should connect to our socket, not listen: %s", joined)
	}
}

func TestQEMUArgsOriginalMachineShape(t *testing.T) {
	args, err := qemuArgs("/tmp/qmp.sock", "/tmp/vars.fd", LaunchConfig{
		ISO:    "/home/iso/omarchy.iso",
		Disk:   "/home/disk.qcow2",
		CodeFD: "/usr/share/edk2/x64/OVMF_CODE.4m.fd",
		Memory: "4G",
		SMP:    2,
	})
	if err != nil {
		t.Fatalf("qemuArgs: %v", err)
	}
	joined := strings.Join(args, " ")
	for _, want := range []string{
		"-machine", "q35,accel=kvm",
		"-cpu", "host",
		"-m", "4G",
		"-smp", "2",
		"file=/usr/share/edk2/x64/OVMF_CODE.4m.fd",
		"file=/tmp/vars.fd",
		"-cdrom", "/home/iso/omarchy.iso",
		"file=/home/disk.qcow2,if=virtio,format=qcow2",
	} {
		if !strings.Contains(joined, want) {
			t.Errorf("missing %q in %s", want, joined)
		}
	}
}

func TestQEMUArgsOmitsGTKAndTablet(t *testing.T) {
	args, err := qemuArgs("/tmp/qmp.sock", "/tmp/vars.fd", LaunchConfig{
		ISO:  "/iso.iso",
		Disk: "/disk.qcow2",
	})
	if err != nil {
		t.Fatalf("qemuArgs: %v", err)
	}
	joined := strings.Join(args, " ")
	for _, banned := range []string{"gtk", "usb-tablet", "-usb"} {
		if strings.Contains(joined, banned) {
			t.Errorf("did not expect %q in %s", banned, joined)
		}
	}
}

func TestQEMUArgsMissingSocketPath(t *testing.T) {
	_, err := qemuArgs("", "/tmp/vars.fd", LaunchConfig{ISO: "/iso.iso", Disk: "/disk.qcow2"})
	if err == nil {
		t.Fatal("expected error for empty socket path")
	}
}

func containsArg(args []string, flag, value string) bool {
	for i := 0; i < len(args)-1; i++ {
		if args[i] == flag && args[i+1] == value {
			return true
		}
	}
	return false
}
