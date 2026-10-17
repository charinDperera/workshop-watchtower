/**
 * Tails `.watchtower/events.jsonl`: each `poll()` reads only the bytes appended since the
 * last poll and returns the complete, valid events in them. Handles rotation (the file
 * being replaced, detected by inode, or shrinking) by starting again at the new file's start.
 * Every event is attributed (see `derive/attribution`) exactly as the snapshot attributes it;
 * `seed` supplies the existing log so subagents that started before the server are known.
 */
import { open, stat } from 'node:fs/promises';
import { StringDecoder } from 'node:string_decoder';
import type { ActivityEvent } from '../../shared/types';
import { AgentAttributor } from '../services/attribution';
import { parseEventLine, splitCompleteLines } from '../sources/parse/events';

/** Never read more than this per poll, so a huge burst cannot stall the server. */
const MAX_READ_BYTES = 1024 * 1024;

interface FileId {
  size: number;
  ino: number;
}

export class EventTail {
  private offset = 0;
  private ino = -1;
  private partial = '';
  private decoder = new StringDecoder('utf8');
  private polling: Promise<ActivityEvent[]> | null = null;

  private readonly attributor: AgentAttributor;

  constructor(
    private readonly file: string,
    /** The existing log, oldest first, read once by `start()` to learn agent ids. */
    private readonly seed: () => Promise<readonly ActivityEvent[]> = async () => [],
    /** The roster Overseer's slug now; main-agent events are attributed to it. */
    mainSlug?: () => string,
  ) {
    this.attributor = new AgentAttributor(mainSlug);
  }

  /** Skips everything already in the file; only later appends are reported. */
  async start(): Promise<void> {
    const id = await this.identify();
    this.offset = id.size;
    this.ino = id.ino;
    this.reset();
    // Events appended after `identify` may be seen here and again by `poll`; learning a
    // name twice is harmless, because the first name for an id wins.
    for (const event of await this.seed()) this.attributor.attribute(event);
  }

  /** Serialised: overlapping calls share one read. */
  poll(): Promise<ActivityEvent[]> {
    if (!this.polling) {
      this.polling = this.read().finally(() => {
        this.polling = null;
      });
    }
    return this.polling;
  }

  private reset(): void {
    this.partial = '';
    this.decoder = new StringDecoder('utf8');
  }

  private async identify(): Promise<FileId> {
    try {
      const info = await stat(this.file);
      return { size: info.size, ino: info.ino };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { size: 0, ino: -1 };
      throw err;
    }
  }

  private async read(): Promise<ActivityEvent[]> {
    const id = await this.identify();
    if (id.ino !== this.ino || id.size < this.offset) {
      // Rotated, recreated or truncated: everything in the current file is new.
      this.ino = id.ino;
      this.offset = 0;
      this.reset();
    }
    if (id.size <= this.offset) return [];

    const length = Math.min(id.size - this.offset, MAX_READ_BYTES);
    const handle = await open(this.file, 'r');
    let chunk: string;
    try {
      const buffer = Buffer.alloc(length);
      const { bytesRead } = await handle.read(buffer, 0, length, this.offset);
      this.offset += bytesRead;
      chunk = this.decoder.write(buffer.subarray(0, bytesRead));
    } finally {
      await handle.close();
    }

    const { lines, rest } = splitCompleteLines(this.partial + chunk);
    this.partial = rest;
    return lines
      .map(parseEventLine)
      .filter((e): e is ActivityEvent => e !== null)
      .map((e) => this.attributor.attribute(e));
  }
}
