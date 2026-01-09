'use client';

import ListItem from '@tiptap/extension-list-item';

export const ListItemWithEmptyParent = ListItem.extend({
  addAttributes() {
    return {
      ...(this.parent?.() ?? {}),
      emptyParent: {
        default: false,
        parseHTML: (element) => element.getAttribute('data-empty-parent') === 'true',
        renderHTML: (attributes) => {
          if (!attributes.emptyParent) return {};
          return { 'data-empty-parent': 'true' };
        },
      },
    };
  },
});


