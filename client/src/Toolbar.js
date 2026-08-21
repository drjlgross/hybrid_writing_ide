/**
 * The formatting the dialect allows and nothing else (CLAUDE.md §1, §5):
 * bold, italic, bullet list, link.
 *
 * There is no heading button, no ordered list, no blockquote — not because they
 * were forgotten but because a construct TipTap cannot hold is a construct the
 * store cannot keep (§0.1, §7).
 */

import { useEffect, useState } from 'react';

import { h } from './h.js';

export function Toolbar({ editor, disabled }) {
  const [, forceRender] = useState(0);
  const [linkValue, setLinkValue] = useState(null); // null = the link field is closed

  // Mark buttons show whether the caret is inside bold/italic/a link, which changes
  // on selection and on transaction — neither of which is React state.
  useEffect(() => {
    if (!editor) return undefined;
    const refresh = () => forceRender((n) => n + 1);
    editor.on('selectionUpdate', refresh);
    editor.on('transaction', refresh);
    return () => {
      editor.off('selectionUpdate', refresh);
      editor.off('transaction', refresh);
    };
  }, [editor]);

  if (!editor) return null;

  const button = (key, label, { title, active, run }) =>
    h(
      'button',
      {
        key,
        type: 'button',
        className: `tool${active ? ' tool-active' : ''}`,
        title,
        'aria-label': title,
        'aria-pressed': active,
        disabled,
        // The editor loses focus the instant a button takes it, and a command with
        // no selection does nothing.
        onMouseDown: (event) => event.preventDefault(),
        onClick: run,
      },
      label,
    );

  function applyLink(event) {
    event.preventDefault();
    const href = linkValue.trim();
    const chain = editor.chain().focus().extendMarkRange('link');
    if (href === '') chain.unsetLink().run();
    else chain.setLink({ href }).run();
    setLinkValue(null);
  }

  const children = [
    button('bold', 'B', {
      title: 'Bold',
      active: editor.isActive('bold'),
      run: () => editor.chain().focus().toggleBold().run(),
    }),
    button('italic', 'I', {
      title: 'Italic',
      active: editor.isActive('italic'),
      run: () => editor.chain().focus().toggleItalic().run(),
    }),
    button('bullet', '•', {
      title: 'Bullet list',
      active: editor.isActive('bulletList'),
      run: () => editor.chain().focus().toggleBulletList().run(),
    }),
    button('link', '🔗', {
      title: 'Link',
      active: editor.isActive('link'),
      run: () => setLinkValue(editor.getAttributes('link').href ?? ''),
    }),
  ];

  if (linkValue !== null) {
    children.push(
      h('form', { key: 'link-form', className: 'link-form', onSubmit: applyLink }, [
        h('input', {
          key: 'href',
          autoFocus: true,
          type: 'text',
          value: linkValue,
          'aria-label': 'Link address',
          placeholder: 'https://…  (empty removes the link)',
          onChange: (event) => setLinkValue(event.target.value),
          onKeyDown: (event) => {
            if (event.key === 'Escape') setLinkValue(null);
          },
        }),
        h('button', { key: 'set', type: 'submit', className: 'tool' }, 'set'),
      ]),
    );
  }

  return h('div', { className: 'toolbar' }, children);
}

export default Toolbar;
