package app

import (
	"bytes"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
)

/*
aiValidateArgs checks a proposed change's arguments against the target tool's
inputSchema before the change is stored.

Only the part of JSON Schema the tool definitions use: an object, its required
fields, no field outside properties, the six basic types (with items.type for
arrays) and enum. The model's arguments are not trusted; a change that would be
refused when applied is better refused now, while the model can still fix it.
*/
func aiValidateArgs(schema map[string]any, args json.RawMessage) error {
	trimmed := bytes.TrimSpace(args)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		trimmed = []byte("{}")
	}
	dec := json.NewDecoder(bytes.NewReader(trimmed))
	dec.UseNumber()
	var value any
	if err := dec.Decode(&value); err != nil {
		return fmt.Errorf("the arguments are not valid JSON")
	}
	obj, ok := value.(map[string]any)
	if !ok {
		return fmt.Errorf("the arguments must be an object")
	}

	for _, field := range aiStringList(schema["required"]) {
		if _, present := obj[field]; !present {
			return fmt.Errorf("%q is required", field)
		}
	}

	props, hasProps := schema["properties"].(map[string]any)
	keys := make([]string, 0, len(obj))
	for k := range obj {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		prop, known := props[k].(map[string]any)
		if !known {
			if hasProps {
				return fmt.Errorf("%q is not a field of this tool", k)
			}
			continue
		}
		if err := aiCheckValue(k, prop, obj[k]); err != nil {
			return err
		}
	}
	return nil
}

func aiCheckValue(field string, prop map[string]any, v any) error {
	typ, _ := prop["type"].(string)
	if typ != "" && !aiHasType(typ, v) {
		switch typ {
		case "integer":
			if _, isNum := v.(json.Number); isNum {
				return fmt.Errorf("%q must be a whole number", field)
			}
			return fmt.Errorf("%q must be an integer", field)
		case "array":
			return fmt.Errorf("%q must be a list", field)
		case "object":
			return fmt.Errorf("%q must be an object", field)
		}
		return fmt.Errorf("%q must be a %s", field, typ)
	}
	if typ == "array" {
		items, _ := prop["items"].(map[string]any)
		if itemType, _ := items["type"].(string); itemType != "" {
			for _, item := range v.([]any) {
				if !aiHasType(itemType, item) {
					return fmt.Errorf("%q must be a list of %ss", field, itemType)
				}
			}
		}
	}
	if allowed := aiStringList(prop["enum"]); len(allowed) > 0 {
		got := fmt.Sprint(v)
		for _, a := range allowed {
			if a == got {
				return nil
			}
		}
		return fmt.Errorf("%q must be one of %s", field, strings.Join(allowed, ", "))
	}
	return nil
}

func aiHasType(typ string, v any) bool {
	switch typ {
	case "string":
		_, ok := v.(string)
		return ok
	case "boolean":
		_, ok := v.(bool)
		return ok
	case "number":
		_, ok := v.(json.Number)
		return ok
	case "integer":
		n, ok := v.(json.Number)
		if !ok {
			return false
		}
		_, err := n.Int64()
		return err == nil
	case "array":
		_, ok := v.([]any)
		return ok
	case "object":
		_, ok := v.(map[string]any)
		return ok
	}
	return true
}

// aiStringList reads a schema list written as []string in Go or decoded as
// []any from JSON.
func aiStringList(v any) []string {
	switch list := v.(type) {
	case []string:
		return list
	case []any:
		out := make([]string, 0, len(list))
		for _, item := range list {
			out = append(out, fmt.Sprint(item))
		}
		return out
	}
	return nil
}
