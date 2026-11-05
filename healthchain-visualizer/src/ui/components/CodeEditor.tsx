// A small CodeMirror 6 wrapper for editing contract source.
import { useEffect, useRef } from 'react';
import { EditorView, basicSetup } from 'codemirror';
import { EditorState } from '@codemirror/state';
import { javascript } from '@codemirror/lang-javascript';
import { HighlightStyle, syntaxHighlighting } from '@codemirror/language';
import { tags as t } from '@lezer/highlight';

const highlight = HighlightStyle.define([
  { tag: t.comment, color: '#6b8187', fontStyle: 'italic' },
  { tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword], color: '#7a3e9d' },
  { tag: [t.string, t.special(t.string)], color: '#2f7a3e' },
  { tag: [t.number, t.bool, t.null], color: '#b5530f' },
  { tag: [t.function(t.variableName), t.function(t.propertyName)], color: '#1d5f98' },
  { tag: t.definition(t.propertyName), color: '#1d5f98', fontWeight: '600' },
  { tag: t.propertyName, color: '#264a55' },
  { tag: t.variableName, color: '#13252b' },
  { tag: t.operator, color: '#5c6f74' },
]);

const theme = EditorView.theme({
  '&': { fontSize: '12.5px', backgroundColor: '#fbfdfd', height: '100%' },
  '.cm-content': { fontFamily: 'var(--mono)', padding: '10px 0' },
  '.cm-gutters': { backgroundColor: '#eef3f4', color: '#8aa0a5', border: 'none', borderRight: '1px solid #d1dcdf' },
  '.cm-activeLine': { backgroundColor: '#eaf3f6' },
  '.cm-activeLineGutter': { backgroundColor: '#dcecf2' },
  '&.cm-focused': { outline: 'none' },
  '.cm-scroller': { overflow: 'auto' },
});

export function CodeEditor({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;

  useEffect(() => {
    view.current = new EditorView({
      parent: host.current!,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          javascript(),
          syntaxHighlighting(highlight),
          theme,
          EditorView.lineWrapping,
          EditorView.updateListener.of((u) => {
            if (u.docChanged) changeRef.current(u.state.doc.toString());
          }),
        ],
      }),
    });
    return () => view.current?.destroy();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replace the document when the value is changed from outside (example loaded, edits discarded).
  useEffect(() => {
    const v = view.current;
    if (v && v.state.doc.toString() !== value) {
      v.dispatch({ changes: { from: 0, to: v.state.doc.length, insert: value } });
    }
  }, [value]);

  return <div className="code-editor" ref={host} />;
}
