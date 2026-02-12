import { randomUUID } from "node:crypto";
import type { ChatMessage, SendMessageRequest, ChatChannel } from "../types/chat.js";

const MAX_HISTORY = 200;       // per channel buffer
const MESSAGE_TTL_MS = 300000; // 5 minutes
const MAX_CONTENT_LENGTH = 500;
const RATE_LIMIT_MS = 500;     // min time between messages per agent

export class ChatManager {
  // Zone channel buffers: zoneId → messages
  private zoneMessages: Map<string, ChatMessage[]> = new Map();
  // Global channel buffer
  private globalMessages: ChatMessage[] = [];
  // Direct message inboxes: agentId → messages
  private inboxes: Map<string, ChatMessage[]> = new Map();
  // Rate limit tracking: agentId → last send timestamp
  private lastSend: Map<string, number> = new Map();

  send(req: SendMessageRequest): ChatMessage | string {
    // Validate
    if (!req.from || !req.fromName || !req.channel || !req.content) {
      return "from, fromName, channel, and content are required";
    }

    if (req.content.length > MAX_CONTENT_LENGTH) {
      return `content exceeds ${MAX_CONTENT_LENGTH} characters`;
    }

    if (req.channel === "direct" && !req.to) {
      return "direct messages require a 'to' field";
    }

    if (req.channel === "zone" && !req.zoneId) {
      return "zone messages require a 'zoneId' field";
    }

    // Rate limit
    const now = Date.now();
    const last = this.lastSend.get(req.from) ?? 0;
    if (now - last < RATE_LIMIT_MS) {
      return "rate limited — wait before sending again";
    }
    this.lastSend.set(req.from, now);

    const message: ChatMessage = {
      messageId: randomUUID(),
      from: req.from,
      fromName: req.fromName,
      channel: req.channel,
      to: req.to,
      zoneId: req.zoneId,
      content: req.content,
      timestamp: now,
    };

    switch (req.channel) {
      case "direct":
        this.deliverDirect(message);
        break;
      case "zone":
        this.deliverZone(message);
        break;
      case "global":
        this.deliverGlobal(message);
        break;
    }

    return message;
  }

  /** Get messages for an agent: direct inbox + zone + global, filtered by since */
  getInbox(agentId: string, since?: number): ChatMessage[] {
    const cutoff = since ?? 0;
    const inbox = this.inboxes.get(agentId) ?? [];
    return inbox.filter((m) => m.timestamp > cutoff);
  }

  /** Get zone chat history */
  getZoneChat(zoneId: string, since?: number): ChatMessage[] {
    const cutoff = since ?? 0;
    const messages = this.zoneMessages.get(zoneId) ?? [];
    return messages.filter((m) => m.timestamp > cutoff);
  }

  /** Get global chat history */
  getGlobalChat(since?: number): ChatMessage[] {
    const cutoff = since ?? 0;
    return this.globalMessages.filter((m) => m.timestamp > cutoff);
  }

  /** Clean up old messages */
  cleanup(): void {
    const cutoff = Date.now() - MESSAGE_TTL_MS;

    for (const [id, msgs] of this.inboxes) {
      const filtered = msgs.filter((m) => m.timestamp > cutoff);
      if (filtered.length === 0) {
        this.inboxes.delete(id);
      } else {
        this.inboxes.set(id, filtered);
      }
    }

    for (const [id, msgs] of this.zoneMessages) {
      this.zoneMessages.set(id, msgs.filter((m) => m.timestamp > cutoff));
    }

    this.globalMessages = this.globalMessages.filter((m) => m.timestamp > cutoff);
  }

  private deliverDirect(msg: ChatMessage): void {
    // Deliver to recipient's inbox
    const inbox = this.inboxes.get(msg.to!) ?? [];
    inbox.push(msg);
    this.trimBuffer(inbox);
    this.inboxes.set(msg.to!, inbox);

    // Also store in sender's inbox (so they see their own messages)
    const senderInbox = this.inboxes.get(msg.from) ?? [];
    senderInbox.push(msg);
    this.trimBuffer(senderInbox);
    this.inboxes.set(msg.from, senderInbox);
  }

  private deliverZone(msg: ChatMessage): void {
    const buffer = this.zoneMessages.get(msg.zoneId!) ?? [];
    buffer.push(msg);
    this.trimBuffer(buffer);
    this.zoneMessages.set(msg.zoneId!, buffer);
  }

  private deliverGlobal(msg: ChatMessage): void {
    this.globalMessages.push(msg);
    this.trimBuffer(this.globalMessages);
  }

  private trimBuffer(buffer: ChatMessage[]): void {
    while (buffer.length > MAX_HISTORY) {
      buffer.shift();
    }
  }
}
