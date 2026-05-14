// Read-only CodeMirror 6 viewer. Lazy-loaded by CodeBrowser so the
// ~250KB of CM extensions stays out of the initial bundle and is
// only paid when the user opens the 代码 tab.

import { useEffect, useRef } from 'react'
import type { FC } from 'react'

import { EditorState } from '@codemirror/state'
import {
  EditorView,
  lineNumbers,
  highlightActiveLineGutter,
} from '@codemirror/view'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { css as cmCss } from '@codemirror/lang-css'
import { json as cmJson } from '@codemirror/lang-json'
import { markdown as cmMd } from '@codemirror/lang-markdown'
import { oneDark } from '@codemirror/theme-one-dark'

function languageExtension(lang: string) {
  switch (lang) {
    case 'typescript':
      return javascript({ jsx: true, typescript: true })
    case 'javascript':
      return javascript({ jsx: true })
    case 'html':
      return html({ matchClosingTags: true, autoCloseTags: false })
    case 'css':
      return cmCss()
    case 'json':
      return cmJson()
    case 'markdown':
      return cmMd()
    default:
      return []
  }
}

export const CodeMirrorView: FC<{ content: string; language: string }> = ({
  content,
  language,
}) => {
  const hostRef = useRef<HTMLDivElement | null>(null)
  const viewRef = useRef<EditorView | null>(null)

  // The view is created (and destroyed) only when the language
  // changes — recreating an EditorView on every keystroke / file
  // switch was both expensive and reset scroll position. Doc
  // updates go through view.dispatch() so the editor's internal
  // state survives unchanged extensions.
  useEffect(() => {
    if (!hostRef.current) return
    const state = EditorState.create({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        EditorView.editable.of(false),
        EditorState.readOnly.of(true),
        EditorView.lineWrapping,
        oneDark,
        languageExtension(language),
      ],
    })
    const view = new EditorView({ state, parent: hostRef.current })
    viewRef.current = view
    return () => {
      view.destroy()
      viewRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [language])

  useEffect(() => {
    const view = viewRef.current
    if (!view) return
    const current = view.state.doc.toString()
    if (current === content) return
    view.dispatch({
      changes: { from: 0, to: current.length, insert: content },
    })
  }, [content])

  return (
    <div
      ref={hostRef}
      style={{
        height: '100%',
        width: '100%',
        fontSize: 12,
      }}
    />
  )
}

export default CodeMirrorView
