import { expect, test } from 'vitest';
import { compareCopies } from './malphas-check.mjs';

test('compareCopies names only the files whose bytes differ', () => {
  expect(
    compareCopies([
      { name: 'a', local: Buffer.from('x'), remote: Buffer.from('x') },
      { name: 'b', local: Buffer.from('x'), remote: Buffer.from('y') },
    ]),
  ).toEqual(['b']);
});
