package qemu

import (
	"fmt"
	"strings"
	"unicode"

	"theprimeagen.com/yourmomma/pkg/qmp"
)

// KeyEncoding names a key-string dialect.
type KeyEncoding string

const (
	// EncodingOligarchy is <ENTER>, <C-c>, and literal characters.
	EncodingOligarchy KeyEncoding = "oligarchy"
)

func normalizeEncoding(enc KeyEncoding) (KeyEncoding, error) {
	if enc == "" {
		return EncodingOligarchy, nil
	}
	switch KeyEncoding(strings.ToLower(string(enc))) {
	case EncodingOligarchy:
		return EncodingOligarchy, nil
	default:
		return "", fmt.Errorf("qemu: unknown key encoding %q", enc)
	}
}

var namedKeys = map[string]qmp.QKeyCode{
	"ENTER":      qmp.QKeyCodeRet,
	"RETURN":     qmp.QKeyCodeRet,
	"CR":         qmp.QKeyCodeRet,
	"RET":        qmp.QKeyCodeRet,
	"ESC":        qmp.QKeyCodeEsc,
	"ESCAPE":     qmp.QKeyCodeEsc,
	"TAB":        qmp.QKeyCodeTab,
	"BS":         qmp.QKeyCodeBackspace,
	"BACKSPACE":  qmp.QKeyCodeBackspace,
	"DEL":        qmp.QKeyCodeDelete,
	"DELETE":     qmp.QKeyCodeDelete,
	"INS":        qmp.QKeyCodeInsert,
	"INSERT":     qmp.QKeyCodeInsert,
	"SPACE":      qmp.QKeyCodeSpc,
	"SPC":        qmp.QKeyCodeSpc,
	"UP":         qmp.QKeyCodeUp,
	"DOWN":       qmp.QKeyCodeDown,
	"LEFT":       qmp.QKeyCodeLeft,
	"RIGHT":      qmp.QKeyCodeRight,
	"HOME":       qmp.QKeyCodeHome,
	"END":        qmp.QKeyCodeEnd,
	"PGUP":       qmp.QKeyCodePgup,
	"PAGEUP":     qmp.QKeyCodePgup,
	"PGDN":       qmp.QKeyCodePgdn,
	"PAGEDOWN":   qmp.QKeyCodePgdn,
	"LT":         qmp.QKeyCodeLess,
	"GT":         qmp.QKeyCodeDot,
	"MENU":       qmp.QKeyCodeMenu,
	"CAPSLOCK":   qmp.QKeyCodeCapsLock,
	"NUMLOCK":    qmp.QKeyCodeNumLock,
	"SCROLLLOCK": qmp.QKeyCodeScrollLock,
	"PRINT":      qmp.QKeyCodePrint,
	"PAUSE":      qmp.QKeyCodePause,
	"SYSREQ":     qmp.QKeyCodeSysrq,
}

var shiftedPunct = map[rune]qmp.QKeyCode{
	'!': qmp.QKeyCodeN1,
	'@': qmp.QKeyCodeN2,
	'#': qmp.QKeyCodeN3,
	'$': qmp.QKeyCodeN4,
	'%': qmp.QKeyCodeN5,
	'^': qmp.QKeyCodeN6,
	'&': qmp.QKeyCodeN7,
	'*': qmp.QKeyCodeN8,
	'(': qmp.QKeyCodeN9,
	')': qmp.QKeyCodeN0,
	'_': qmp.QKeyCodeMinus,
	'+': qmp.QKeyCodeEqual,
	'{': qmp.QKeyCodeBracketLeft,
	'}': qmp.QKeyCodeBracketRight,
	':': qmp.QKeyCodeSemicolon,
	'"': qmp.QKeyCodeApostrophe,
	'~': qmp.QKeyCodeGraveAccent,
	'|': qmp.QKeyCodeBackslash,
	'<': qmp.QKeyCodeComma,
	'>': qmp.QKeyCodeDot,
	'?': qmp.QKeyCodeSlash,
}

var unshiftedPunct = map[rune]qmp.QKeyCode{
	' ':  qmp.QKeyCodeSpc,
	'\n': qmp.QKeyCodeRet,
	'\r': qmp.QKeyCodeRet,
	'\t': qmp.QKeyCodeTab,
	'-':  qmp.QKeyCodeMinus,
	'=':  qmp.QKeyCodeEqual,
	'[':  qmp.QKeyCodeBracketLeft,
	']':  qmp.QKeyCodeBracketRight,
	';':  qmp.QKeyCodeSemicolon,
	'\'': qmp.QKeyCodeApostrophe,
	'`':  qmp.QKeyCodeGraveAccent,
	'\\': qmp.QKeyCodeBackslash,
	',':  qmp.QKeyCodeComma,
	'.':  qmp.QKeyCodeDot,
	'/':  qmp.QKeyCodeSlash,
}

func init() {
	for i := 1; i <= 24; i++ {
		name := fmt.Sprintf("F%d", i)
		namedKeys[name] = qmp.QKeyCode(fmt.Sprintf("f%d", i))
	}
	for _, code := range []qmp.QKeyCode{
		qmp.QKeyCodeRet, qmp.QKeyCodeEsc, qmp.QKeyCodeTab, qmp.QKeyCodeSpc,
		qmp.QKeyCodeCtrl, qmp.QKeyCodeAlt, qmp.QKeyCodeShift, qmp.QKeyCodeMetaL,
	} {
		namedKeys[strings.ToUpper(string(code))] = code
	}
}

// ParseKeys turns an encoded key string into send-key chords.
func ParseKeys(s string, encoding KeyEncoding) ([][]qmp.QKeyCode, error) {
	enc, err := normalizeEncoding(encoding)
	if err != nil {
		return nil, err
	}
	_ = enc
	var out [][]qmp.QKeyCode
	runes := []rune(s)
	for i := 0; i < len(runes); i++ {
		if runes[i] == '<' {
			end := -1
			for j := i + 1; j < len(runes); j++ {
				if runes[j] == '>' {
					end = j
					break
				}
			}
			if end < 0 {
				return nil, fmt.Errorf("qemu: unterminated key sequence")
			}
			chord, err := parseAngle(string(runes[i+1 : end]))
			if err != nil {
				return nil, err
			}
			out = append(out, chord)
			i = end
			continue
		}
		chord, err := parseRune(runes[i])
		if err != nil {
			return nil, err
		}
		out = append(out, chord)
	}
	return out, nil
}

func parseAngle(inner string) ([]qmp.QKeyCode, error) {
	if inner == "" {
		return nil, fmt.Errorf("qemu: empty key sequence")
	}
	parts := strings.Split(inner, "-")
	var mods []qmp.QKeyCode
	for i := 0; i < len(parts)-1; i++ {
		switch strings.ToUpper(parts[i]) {
		case "C", "CTRL", "CONTROL":
			mods = append(mods, qmp.QKeyCodeCtrl)
		case "A", "ALT":
			mods = append(mods, qmp.QKeyCodeAlt)
		case "S", "SHIFT":
			mods = append(mods, qmp.QKeyCodeShift)
		case "M", "META":
			mods = append(mods, qmp.QKeyCodeMetaL)
		default:
			return nil, fmt.Errorf("qemu: unknown modifier %q", parts[i])
		}
	}
	key, err := parseKeyName(parts[len(parts)-1])
	if err != nil {
		return nil, err
	}
	// <GT> is shift+dot on a US keyboard.
	if strings.EqualFold(parts[len(parts)-1], "GT") {
		key = []qmp.QKeyCode{qmp.QKeyCodeShift, qmp.QKeyCodeDot}
	}
	return append(mods, key...), nil
}

func parseKeyName(name string) ([]qmp.QKeyCode, error) {
	if code, ok := namedKeys[strings.ToUpper(name)]; ok {
		return []qmp.QKeyCode{code}, nil
	}
	if len([]rune(name)) == 1 {
		return parseRune([]rune(name)[0])
	}
	lower := strings.ToLower(name)
	if looksLikeQKeyCode(lower) {
		return []qmp.QKeyCode{qmp.QKeyCode(lower)}, nil
	}
	return nil, fmt.Errorf("qemu: unknown key %q", name)
}

func looksLikeQKeyCode(name string) bool {
	switch qmp.QKeyCode(name) {
	case qmp.QKeyCodeUnmapped, qmp.QKeyCodeShift, qmp.QKeyCodeRet, qmp.QKeyCodeSpc:
		return true
	}
	// Accept any documented qcode token rather than reject unknown names later.
	if len(name) == 1 && (name[0] >= 'a' && name[0] <= 'z' || name[0] >= '0' && name[0] <= '9') {
		return true
	}
	return strings.Contains(name, "_") || strings.HasPrefix(name, "kp_") || strings.HasPrefix(name, "f")
}

func parseRune(r rune) ([]qmp.QKeyCode, error) {
	if r >= 'a' && r <= 'z' {
		return []qmp.QKeyCode{qmp.QKeyCode(string(r))}, nil
	}
	if r >= 'A' && r <= 'Z' {
		return []qmp.QKeyCode{qmp.QKeyCodeShift, qmp.QKeyCode(string(unicode.ToLower(r)))}, nil
	}
	if r >= '0' && r <= '9' {
		return []qmp.QKeyCode{qmp.QKeyCode(string(r))}, nil
	}
	if code, ok := unshiftedPunct[r]; ok {
		return []qmp.QKeyCode{code}, nil
	}
	if code, ok := shiftedPunct[r]; ok {
		return []qmp.QKeyCode{qmp.QKeyCodeShift, code}, nil
	}
	return nil, fmt.Errorf("qemu: unsupported character %q", string(r))
}
