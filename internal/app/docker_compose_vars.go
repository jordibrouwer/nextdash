package app

import (
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"gopkg.in/yaml.v3"
)

/*
The variable check: which ${VARIABLES} a stack's compose files use that nothing
sets, found by reading the files, before compose is asked to run anything.

Compose fills a variable from the env files it was given (--env-file, or .env in
the project folder) and from the environment of the process. The helper has no
environment of its own, so the env files are the whole story:

  - unset and no default            warning: the stack would start with a blank
  - set, even to an empty string    fine: somebody wrote the line on purpose
  - unset or empty with ${VAR:?msg} blocked: compose itself stops (${VAR?msg}: unset only)
  - an env_file entry that is not there   blocked (unless "required: false")

The answer lists each variable once, with every service, file and line that uses
it. No value is ever put in it.
*/

const (
	composeVarOK      = "ok"
	composeVarWarning = "warning"
	composeVarBlocked = "blocked"

	composeVarReasonRequired       = "required"
	composeVarReasonUnset          = "unset"
	composeVarReasonEnvFileMissing = "env-file-missing"
)

type composeVarUse struct {
	Service string `json:"service"`
	File    string `json:"file"`
	Line    int    `json:"line"`
}

type composeVarIssue struct {
	Var     string          `json:"var,omitempty"`
	Level   string          `json:"level"`  // blocked | warning
	Reason  string          `json:"reason"` // required | unset | env-file-missing
	Message string          `json:"message,omitempty"`
	Path    string          `json:"path,omitempty"` // env-file-missing: the host path
	Uses    []composeVarUse `json:"uses"`
}

type composeVarEnvFile struct {
	Path  string `json:"path"`
	File  string `json:"file,omitempty"` // the id of the file in the files answer
	State string `json:"state"`
}

type composeVarReport struct {
	State     string              `json:"state"` // ok | warning | blocked
	Blocked   bool                `json:"blocked"`
	Issues    []composeVarIssue   `json:"issues"`
	Empty     []string            `json:"empty"`     // set to an empty value, used with no default
	Defaulted []string            `json:"defaulted"` // unset, but every use has a default
	Used      int                 `json:"used"`      // distinct variables the files use
	EnvFiles  []composeVarEnvFile `json:"envFiles"`  // what compose reads variables from
}

var composeVarName = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]*`)

// composeScanRefs calls visit for every ${...} or $NAME in s. $$ is an escaped
// dollar and names nothing. The default of ${A:-${B}} is visited by the caller,
// only when it would be used.
func composeScanRefs(s string, visit func(name, op, arg string)) {
	for i := 0; i < len(s); i++ {
		if s[i] != '$' || i+1 >= len(s) {
			continue
		}
		switch {
		case s[i+1] == '$':
			i++
		case s[i+1] == '{':
			depth, j := 1, i+2
			for ; j < len(s) && depth > 0; j++ {
				switch {
				case s[j] == '{':
					depth++
				case s[j] == '}':
					depth--
				}
			}
			if depth != 0 {
				return // an unclosed brace: compose reports it
			}
			inner := s[i+2 : j-1]
			name := composeVarName.FindString(inner)
			if name == "" {
				i = j - 1
				continue
			}
			rest := inner[len(name):]
			op, arg := "", ""
			for _, o := range []string{":-", ":?", ":+", "-", "?", "+"} {
				if strings.HasPrefix(rest, o) {
					op, arg = o, rest[len(o):]
					break
				}
			}
			visit(name, op, arg)
			i = j - 1
		default:
			if name := composeVarName.FindString(s[i+1:]); name != "" {
				visit(name, "", "")
				i += len(name)
			}
		}
	}
}

// composeVarSources reads the env files compose takes variables from, in the
// order it applies them (a later file wins). staged stands in for the saved
// text of one file, when a Check or a preview is of an unsaved edit.
func composeVarSources(p composeProject, files []composeFile, staged *composeStage) (map[string]string, []composeVarEnvFile, []composeVarIssue) {
	env := map[string]string{}
	var used []composeVarEnvFile
	var issues []composeVarIssue
	paths := p.EnvFiles
	labelled := len(paths) > 0
	if !labelled && p.WorkingDir != "" {
		paths = []string{strings.TrimRight(p.WorkingDir, "/") + "/.env"}
	}
	maps := composeMap()
	for _, hp := range paths {
		f, found := composeFile{}, false
		for _, c := range files {
			if c.HostPath == hp && c.Role == composeRoleEnv {
				f, found = c, true
				break
			}
		}
		if !found {
			f = resolveComposeFile(hp, composeRoleEnv, maps)
		}
		var src []byte
		var err error
		switch {
		case staged != nil && staged.Role == composeRoleEnv && staged.File == hp:
			src = []byte(staged.Content)
		case f.State == composeStateOK:
			src, err = readComposeFile(f)
		default:
			err = errComposeState{State: f.State}
		}
		if err != nil || (f.State != composeStateOK && !(staged != nil && staged.File == hp)) {
			state := f.State
			if cs, ok := err.(errComposeState); ok {
				state = cs.State
			}
			if state == composeMissing && !labelled {
				continue // most stacks have no .env
			}
			used = append(used, composeVarEnvFile{Path: hp, File: f.ID, State: state})
			if state == composeMissing {
				issues = append(issues, composeVarIssue{Level: composeVarBlocked, Reason: composeVarReasonEnvFileMissing, Path: hp,
					Message: "The environment file " + hp + " is not there; compose stops without it.", Uses: []composeVarUse{}})
			}
			continue
		}
		used = append(used, composeVarEnvFile{Path: hp, File: f.ID, State: composeStateOK})
		for _, e := range parseComposeEnv(src) {
			if composeVarName.FindString(e.name) == e.name && !strings.HasPrefix(e.name, "line ") {
				env[e.name] = e.value
			}
		}
	}
	return env, used, issues
}

// composeVarCheck reads the stack's compose files and says which variables are
// a problem. It writes nothing and runs nothing.
func composeVarCheck(p composeProject, staged *composeStage) composeVarReport {
	maps := composeMap()
	files := composeFilesOf(p, maps)
	env, envFiles, issues := composeVarSources(p, files, staged)

	type key struct{ name, level, reason, msg string }
	byKey := map[key]*composeVarIssue{}
	var order []key
	usedNames := map[string]bool{}
	emptyOK := map[string]bool{}
	defaulted := map[string]bool{}
	hardUnset := map[string]bool{}

	add := func(k key, u composeVarUse) {
		is := byKey[k]
		if is == nil {
			is = &composeVarIssue{Var: k.name, Level: k.level, Reason: k.reason, Message: k.msg, Uses: []composeVarUse{}}
			byKey[k] = is
			order = append(order, k)
		}
		is.Uses = append(is.Uses, u)
	}

	var visitor func(u composeVarUse) func(name, op, arg string)
	visitor = func(u composeVarUse) func(name, op, arg string) {
		var visit func(name, op, arg string)
		visit = func(name, op, arg string) {
			usedNames[name] = true
			val, set := env[name]
			switch op {
			case "":
				switch {
				case !set:
					hardUnset[name] = true
					add(key{name: name, level: composeVarWarning, reason: composeVarReasonUnset}, u)
				case val == "":
					emptyOK[name] = true
				}
			case ":-", "-":
				if !set || (op == ":-" && val == "") {
					defaulted[name] = true
					composeScanRefs(arg, visit)
				}
			case ":?", "?":
				if !set || (op == ":?" && val == "") {
					msg := strings.TrimSpace(arg)
					add(key{name: name, level: composeVarBlocked, reason: composeVarReasonRequired, msg: msg}, u)
				}
			case ":+", "+":
				if set && (op == "+" || val != "") {
					composeScanRefs(arg, visit)
				}
			}
		}
		return visit
	}

	for _, f := range files {
		if f.Role != composeRoleCompose || (f.State != composeStateOK && !(staged != nil && staged.File == f.HostPath)) {
			continue
		}
		var src []byte
		if staged != nil && staged.Role == composeRoleCompose && staged.File == f.HostPath {
			src = []byte(staged.Content)
		} else {
			b, err := readComposeFile(f)
			if err != nil {
				continue
			}
			src = b
		}
		var doc yaml.Node
		if yaml.Unmarshal(src, &doc) != nil || len(doc.Content) == 0 {
			continue
		}
		fileID := f.ID
		var walk func(n *yaml.Node, service string)
		walk = func(n *yaml.Node, service string) {
			switch n.Kind {
			case yaml.ScalarNode:
				if strings.Contains(n.Value, "$") {
					composeScanRefs(n.Value, visitor(composeVarUse{Service: service, File: fileID, Line: n.Line}))
				}
			case yaml.MappingNode:
				for i := 0; i+1 < len(n.Content); i += 2 {
					walk(n.Content[i], service)
					walk(n.Content[i+1], service)
				}
			case yaml.SequenceNode:
				for _, c := range n.Content {
					walk(c, service)
				}
			}
		}
		root := doc.Content[0]
		if root.Kind != yaml.MappingNode {
			continue
		}
		for i := 0; i+1 < len(root.Content); i += 2 {
			k, v := root.Content[i], root.Content[i+1]
			if k.Value == "services" && v.Kind == yaml.MappingNode {
				for j := 0; j+1 < len(v.Content); j += 2 {
					svc := v.Content[j].Value
					walk(v.Content[j+1], svc)
					// A service's env_file that is not there stops compose.
					for _, ef := range composeEnvFileEntries(v.Content[j+1]) {
						hp := ef.path
						if !filepath.IsAbs(hp) {
							hp = strings.TrimRight(p.WorkingDir, "/") + "/" + hp
						}
						if ef.optional {
							continue
						}
						for _, c := range files {
							if c.HostPath == hp && c.State == composeMissing {
								shown := filepath.Clean(hp)
								k := key{level: composeVarBlocked, reason: composeVarReasonEnvFileMissing, msg: shown}
								is := byKey[k]
								if is == nil {
									is = &composeVarIssue{Level: composeVarBlocked, Reason: composeVarReasonEnvFileMissing, Path: shown, Message: "The env_file " + shown + " is not there; compose stops without it.", Uses: []composeVarUse{}}
									byKey[k] = is
									order = append(order, k)
								}
								is.Uses = append(is.Uses, composeVarUse{Service: svc, File: fileID, Line: ef.line})
							}
						}
					}
				}
				continue
			}
			walk(k, "")
			walk(v, "")
		}
	}

	rep := composeVarReport{State: composeVarOK, Issues: []composeVarIssue{}, Empty: []string{}, Defaulted: []string{}, EnvFiles: envFiles, Used: len(usedNames)}
	if rep.EnvFiles == nil {
		rep.EnvFiles = []composeVarEnvFile{}
	}
	rep.Issues = append(rep.Issues, issues...)
	for _, k := range order {
		is := byKey[k]
		sort.SliceStable(is.Uses, func(a, b int) bool {
			if is.Uses[a].Service != is.Uses[b].Service {
				return is.Uses[a].Service < is.Uses[b].Service
			}
			return is.Uses[a].Line < is.Uses[b].Line
		})
		rep.Issues = append(rep.Issues, *is)
	}
	sort.SliceStable(rep.Issues, func(a, b int) bool {
		x, y := rep.Issues[a], rep.Issues[b]
		if x.Level != y.Level {
			return x.Level == composeVarBlocked
		}
		return x.Var < y.Var
	})
	for _, is := range rep.Issues {
		if is.Level == composeVarBlocked {
			rep.State, rep.Blocked = composeVarBlocked, true
		} else if rep.State == composeVarOK {
			rep.State = composeVarWarning
		}
	}
	for n := range emptyOK {
		if !hardUnset[n] {
			rep.Empty = append(rep.Empty, n)
		}
	}
	for n := range defaulted {
		if _, set := env[n]; !set && !hardUnset[n] {
			rep.Defaulted = append(rep.Defaulted, n)
		}
	}
	sort.Strings(rep.Empty)
	sort.Strings(rep.Defaulted)
	return rep
}

type composeEnvFileRef struct {
	path     string
	optional bool
	line     int
}

// composeEnvFileEntries are the env_file entries of one service node.
func composeEnvFileEntries(svc *yaml.Node) []composeEnvFileRef {
	ef := yamlMapGet(svc, "env_file")
	if ef == nil {
		return nil
	}
	var out []composeEnvFileRef
	one := func(n *yaml.Node) {
		switch n.Kind {
		case yaml.ScalarNode:
			if v := strings.TrimSpace(n.Value); v != "" {
				out = append(out, composeEnvFileRef{path: v, line: n.Line})
			}
		case yaml.MappingNode:
			if pn := yamlMapGet(n, "path"); pn != nil && pn.Kind == yaml.ScalarNode && strings.TrimSpace(pn.Value) != "" {
				opt := false
				if rn := yamlMapGet(n, "required"); rn != nil && rn.Kind == yaml.ScalarNode && strings.EqualFold(rn.Value, "false") {
					opt = true
				}
				out = append(out, composeEnvFileRef{path: strings.TrimSpace(pn.Value), optional: opt, line: pn.Line})
			}
		}
	}
	if ef.Kind == yaml.SequenceNode {
		for _, c := range ef.Content {
			one(c)
		}
	} else {
		one(ef)
	}
	return out
}
