/**
 * Purpose: CodeMirror 6 entry point for vendor bundle.
 * How: Re-export the modules needed by the Faust editor.
 */
export {
  EditorView,
  keymap,
  highlightSpecialChars,
  drawSelection,
  highlightActiveLine,
  lineNumbers,
  ViewUpdate,
} from "@codemirror/view";

export { EditorState } from "@codemirror/state";

export {
  defaultHighlightStyle,
  syntaxHighlighting,
  indentOnInput,
  bracketMatching,
  LanguageSupport,
  StreamLanguage,
} from "@codemirror/language";

export {
  defaultKeymap,
  history,
  historyKeymap,
  indentWithTab,
} from "@codemirror/commands";

export { searchKeymap, highlightSelectionMatches } from "@codemirror/search";

export { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";

export { tags } from "@lezer/highlight";
