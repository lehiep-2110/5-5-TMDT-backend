import { Injectable, Logger } from '@nestjs/common';
import { Response } from 'express';

/**
 * Singleton in-memory connection manager for SSE clients. Maintains a set of
 * active Response streams keyed by userId so notifications can be broadcast
 * per-user.
 */
@Injectable()
export class SseGateway {
  private readonly logger = new Logger(SseGateway.name);
  private readonly connections = new Map<string, Set<Response>>();

  register(userId: string, res: Response): void {
    let set = this.connections.get(userId);
    if (!set) {
      set = new Set<Response>();
      this.connections.set(userId, set);
    }
    set.add(res);
  }

  unregister(userId: string, res: Response): void {
    const set = this.connections.get(userId);
    if (!set) return;
    set.delete(res);
    if (set.size === 0) this.connections.delete(userId);
  }

  broadcastTo(userId: string, event: unknown): void {
    const set = this.connections.get(userId);
    if (!set || set.size === 0) return;
    const payload = `data: ${JSON.stringify(event)}\n\n`;
    for (const res of set) {
      try {
        res.write(payload);
      } catch (err) {
        this.logger.warn(
          `Failed to push SSE event to user ${userId}: ${(err as Error).message}`,
        );
      }
    }
  }

  // Useful for tests / diagnostics.
  countConnections(userId?: string): number {
    if (userId) return this.connections.get(userId)?.size ?? 0;
    let n = 0;
    for (const s of this.connections.values()) n += s.size;
    return n;
  }
}
