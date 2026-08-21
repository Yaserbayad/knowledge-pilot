import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const ALLOWED = new Set(['.pdf', '.epub', '.txt', '.md']);
const MAX_FILE_BYTES = 30 * 1024 * 1024;
const MAX_EXTRACTED_CHARS = 2_500_000;
const MAX_EPUB_ENTRIES = 2000;
const MAX_EPUB_ENTRY_BYTES = 8 * 1024 * 1024;
const MAX_EPUB_TOTAL_BYTES = 80 * 1024 * 1024;

function safeBaseName(value) {
  const name = path.basename(String(value || 'book-source.txt')).replace(/[^a-zA-Z0-9._-]/g, '_');
  return name.slice(0, 140) || 'book-source.txt';
}

function decodeEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) || 32));
}

function htmlToText(html) {
  return decodeEntities(String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|section|article|h[1-6]|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' '))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n\s*\n+/g, '\n\n')
    .trim();
}

async function extractPdf(buffer) {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText();
    return String(result.text || '');
  } finally {
    await parser.destroy().catch(() => {});
  }
}

async function extractEpub(buffer) {
  const module = await import('adm-zip');
  const AdmZip = module.default || module;
  const zip = new AdmZip(buffer);
  const allEntries = zip.getEntries();
  if (allEntries.length > MAX_EPUB_ENTRIES) throw new Error('EPUB contains too many files to process safely');
  let totalUncompressed = 0;
  for (const entry of allEntries) {
    const size = Number(entry.header?.size || 0);
    if (size > MAX_EPUB_ENTRY_BYTES) throw new Error('EPUB contains an unusually large internal file');
    totalUncompressed += size;
    if (totalUncompressed > MAX_EPUB_TOTAL_BYTES) throw new Error('EPUB expands beyond the safe processing limit');
  }
  const entries = allEntries
    .filter((entry) => !entry.isDirectory && /\.(xhtml|html|htm|txt)$/i.test(entry.entryName))
    .sort((a, b) => a.entryName.localeCompare(b.entryName));
  const chunks = [];
  let extractedLength = 0;
  for (const entry of entries) {
    const raw = entry.getData().toString('utf8');
    const text = /\.txt$/i.test(entry.entryName) ? raw : htmlToText(raw);
    if (text.trim()) {
      const chunk = `\n\n[${entry.entryName}]\n${text.trim()}`;
      chunks.push(chunk);
      extractedLength += chunk.length;
    }
    if (extractedLength >= MAX_EXTRACTED_CHARS) break;
  }
  return chunks.join('').slice(0, MAX_EXTRACTED_CHARS).trim();
}

export class BookFileService {
  constructor({ rootDir, logger = console }) {
    this.rootDir = rootDir;
    this.logger = logger;
  }

  async init() {
    await fs.mkdir(this.rootDir, { recursive: true });
    return this;
  }

  async save({ userId, bookId, filename, buffer }) {
    if (!Buffer.isBuffer(buffer)) throw new Error('Uploaded source must be binary data');
    if (!buffer.length) throw new Error('Uploaded source is empty');
    if (buffer.length > MAX_FILE_BYTES) throw new Error('Owned-copy upload exceeds the 30 MB limit');
    const safeName = safeBaseName(filename);
    const ext = path.extname(safeName).toLowerCase();
    if (!ALLOWED.has(ext)) throw new Error('Supported owned-copy formats are PDF, EPUB, TXT, and Markdown');
    if (ext === '.pdf' && buffer.subarray(0, 5).toString('ascii') !== '%PDF-') throw new Error('The uploaded file is not a valid PDF');
    if (ext === '.epub' && !(buffer[0] === 0x50 && buffer[1] === 0x4b)) throw new Error('The uploaded file is not a valid EPUB archive');
    const dir = path.join(this.rootDir, userId, bookId);
    await fs.mkdir(dir, { recursive: true, mode: 0o700 });
    const nonce = crypto.randomUUID().replaceAll('-', '');
    const originalPath = path.join(dir, `original-${nonce}-${safeName}`);
    const textPath = path.join(dir, `source-${nonce}.txt`);
    const tempOriginal = path.join(dir, `.upload-${nonce}-${safeName}`);
    const tempText = path.join(dir, `.source-${nonce}.txt`);
    let text = '';
    try {
      await fs.writeFile(tempOriginal, buffer, { mode: 0o600 });
      if (ext === '.pdf') text = await extractPdf(buffer);
      else if (ext === '.epub') text = await extractEpub(buffer);
      else text = buffer.toString('utf8');
      text = String(text || '').replace(/\u0000/g, '').slice(0, MAX_EXTRACTED_CHARS).trim();
      if (text.length < 200) throw new Error('The uploaded copy did not contain enough extractable text');
      await fs.writeFile(tempText, `${text}\n`, { mode: 0o600 });
      await fs.rename(tempOriginal, originalPath);
      await fs.rename(tempText, textPath);
    } catch (error) {
      await Promise.all([fs.rm(tempOriginal, { force: true }), fs.rm(tempText, { force: true })]);
      throw error;
    }
    return {
      filename: safeName,
      format: ext.slice(1),
      sizeBytes: buffer.length,
      extractedCharacters: text.length,
      uploadedAt: new Date().toISOString(),
      originalPath: path.relative(this.rootDir, originalPath),
      textPath: path.relative(this.rootDir, textPath)
    };
  }

  async removeSource(source) {
    const root = path.resolve(this.rootDir);
    const targets = [source?.originalPath, source?.textPath].filter(Boolean);
    for (const storedPath of targets) {
      const target = path.isAbsolute(storedPath) ? path.resolve(storedPath) : path.resolve(root, storedPath);
      const relative = path.relative(root, target);
      if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe owned-copy path');
      await fs.rm(target, { force: true });
    }
  }

  async chunk(source, offset = 0, limit = 16000) {
    if (!source?.textPath) throw new Error('No extracted owned-copy text is available');
    const storedPath = path.isAbsolute(source.textPath) ? source.textPath : path.join(this.rootDir, source.textPath);
    const text = await fs.readFile(storedPath, 'utf8');
    const safeOffset = Math.max(0, Number(offset) || 0);
    const safeLimit = Math.min(Math.max(Number(limit) || 16000, 1000), 24000);
    return {
      offset: safeOffset,
      limit: safeLimit,
      totalCharacters: text.length,
      text: text.slice(safeOffset, safeOffset + safeLimit),
      nextOffset: safeOffset + safeLimit < text.length ? safeOffset + safeLimit : null
    };
  }

  async removeBook(userId, bookId) {
    const target = path.resolve(this.rootDir, String(userId), String(bookId));
    const relative = path.relative(path.resolve(this.rootDir), target);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Unsafe owned-copy path');
    await fs.rm(target, { recursive: true, force: true });
  }
}

export const BOOK_FILE_LIMIT_BYTES = MAX_FILE_BYTES;
