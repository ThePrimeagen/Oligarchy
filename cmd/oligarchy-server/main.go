package main

import (
	"flag"
	"fmt"
	"os"

	"theprimeagen.com/yourmomma/pkg/oligarchy"
)

func main() {
	addr := flag.String("addr", oligarchy.DefaultAddr, "listen address")
	flag.Parse()
	s := oligarchy.NewOligarchyServer(*addr)
	fmt.Fprintf(os.Stderr, "oligarchy-server listening on %s\n", s.Addr)
	if err := s.ListenAndServe(); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
}
