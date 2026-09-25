import { assertEquals } from '@std/assert';
import {
  PICKER_MESSAGE_TYPE,
  selectionFromPickerMessage,
} from '../fields/selection.ts';

const base = {
  type: PICKER_MESSAGE_TYPE,
  table: 'blog_articles',
  column: 'coverImage',
};

Deno.test('selection: uses the typed id the picker grid emits for a non-`id` primary key', () => {
  const selection = selectionFromPickerMessage({
    ...base,
    id: 7,
    record: {
      articleId: 7,
      coverImage: { filename: 'cover.png' },
      caption: 'A caption',
    },
  }, { altField: 'caption' });

  assertEquals(selection, {
    id: 7,
    table: 'blog_articles',
    column: 'coverImage',
    alt: 'A caption',
    filename: 'cover.png',
  });
});

Deno.test('selection: falls back to record.id for older picker pages', () => {
  const selection = selectionFromPickerMessage({
    ...base,
    record: { id: 'abc', coverImage: { filename: 'x.png' } },
  });
  assertEquals(selection?.id, 'abc');
  assertEquals(selection?.filename, 'x.png');
});

Deno.test('selection: rejects payloads without a usable id', () => {
  // PK lives under a non-`id` key and the grid did not emit `id`
  assertEquals(
    selectionFromPickerMessage({ ...base, record: { articleId: 7 } }),
    null,
  );
  assertEquals(selectionFromPickerMessage({ ...base, id: '' }), null);
  assertEquals(selectionFromPickerMessage({ ...base, id: null }), null);
});

Deno.test('selection: rejects wrong message type, missing column, and junk', () => {
  assertEquals(
    selectionFromPickerMessage({ ...base, type: 'other', id: 1 }),
    null,
  );
  assertEquals(
    selectionFromPickerMessage({ type: PICKER_MESSAGE_TYPE, id: 1 }),
    null,
  );
  assertEquals(selectionFromPickerMessage(null), null);
  assertEquals(selectionFromPickerMessage('cms:media-selected'), null);
});

Deno.test('selection: table falls back to the caller default; column never does', () => {
  const selection = selectionFromPickerMessage(
    { type: PICKER_MESSAGE_TYPE, column: 'image', id: 1, record: {} },
    { table: 'media' },
  );
  assertEquals(selection?.table, 'media');
  assertEquals(selection?.column, 'image');
  assertEquals(selection?.alt, '');
  assertEquals(selection?.filename, '');
});
