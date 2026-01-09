'use client';

import OrderedList from '@tiptap/extension-ordered-list';

export const OrderedListWithIndent = OrderedList.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      indent: {
        default: 0,
        parseHTML: (element) => {
          const v = element.getAttribute('data-list-indent');
          const n = v ? Number(v) : 0;
          return Number.isFinite(n) ? n : 0;
        },
        renderHTML: (attributes) => {
          const n = Number(attributes.indent || 0);
          if (!n) return {};
          return { 'data-list-indent': String(n) };
        },
      },
    };
  },
});


