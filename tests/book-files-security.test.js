import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { BookFileService } from '../src/services/book-files.js';

const logger = { debug() {}, info() {}, warn() {}, error() {} };

test('owned-copy chunk rejects lexical traversal outside the private root', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-book-boundary-'));
  const root = path.join(parent, 'private-books');
  const outside = path.join(parent, 'outside.txt');
  await fs.writeFile(outside, 'private data that must not be reachable'.repeat(20));
  const service = await new BookFileService({ rootDir: root, logger }).init();

  await assert.rejects(
    service.chunk({ textPath: '../outside.txt' }),
    /unsafe owned-copy path/i
  );
});

test('owned-copy chunk rejects a symlink that escapes the private root', async () => {
  const parent = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-book-symlink-'));
  const root = path.join(parent, 'private-books');
  const inside = path.join(root, 'user_test', 'book_test');
  const outside = path.join(parent, 'outside.txt');
  await fs.mkdir(inside, { recursive: true });
  await fs.writeFile(outside, 'external private data'.repeat(30));
  await fs.symlink(outside, path.join(inside, 'source-link.txt'));
  const service = await new BookFileService({ rootDir: root, logger }).init();

  await assert.rejects(
    service.chunk({ textPath: 'user_test/book_test/source-link.txt' }),
    /unsafe owned-copy path/i
  );
});

test('owned-copy save rejects unsafe identity path segments', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'knowledge-pilot-book-segments-'));
  const service = await new BookFileService({ rootDir: root, logger }).init();
  const body = Buffer.from('lawful learner-owned text '.repeat(30));

  await assert.rejects(
    service.save({ userId: '../user_test', bookId: 'book_test', filename: 'book.txt', buffer: body }),
    /invalid owned-copy user id/i
  );
  await assert.rejects(
    service.save({ userId: 'user_test', bookId: '../book_test', filename: 'book.txt', buffer: body }),
    /invalid owned-copy book id/i
  );
});
