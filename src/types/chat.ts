export type ChatChannel = "direct" | "zone" | "global";

export interface ChatMessage {
  messageId: string;
  from: string;
  fromName: string;
  channel: ChatChannel;
  to?: string;           // recipient agentId for direct messages
  zoneId?: string;       // zone scope for zone messages
  content: string;
  timestamp: number;
}

export interface SendMessageRequest {
  from: string;
  fromName: string;
  channel: ChatChannel;
  to?: string;
  zoneId?: string;
  content: string;
}
