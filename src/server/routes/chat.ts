import type { FastifyInstance } from "fastify";
import type { ChatManager } from "../../runtime/chat-manager.js";
import type { SendMessageRequest } from "../../types/chat.js";

interface InboxQuery {
  since?: string;
}

export function registerChatRoutes(app: FastifyInstance, chat: ChatManager): void {
  // Send a message
  app.post<{ Body: SendMessageRequest }>("/v1/chat/send", (req, reply) => {
    const result = chat.send(req.body ?? {} as SendMessageRequest);

    if (typeof result === "string") {
      return reply.status(400).send({ error: result });
    }

    return reply.send(result);
  });

  // Get agent's direct message inbox
  app.get<{ Params: { agentId: string }; Querystring: InboxQuery }>(
    "/v1/chat/inbox/:agentId",
    (req, reply) => {
      const since = req.query.since ? parseInt(req.query.since, 10) : undefined;
      const messages = chat.getInbox(req.params.agentId, since);
      return reply.send({ agentId: req.params.agentId, messages });
    },
  );

  // Get zone chat
  app.get<{ Params: { zoneId: string }; Querystring: InboxQuery }>(
    "/v1/chat/zone/:zoneId",
    (req, reply) => {
      const since = req.query.since ? parseInt(req.query.since, 10) : undefined;
      const messages = chat.getZoneChat(req.params.zoneId, since);
      return reply.send({ zoneId: req.params.zoneId, messages });
    },
  );

  // Get global chat
  app.get<{ Querystring: InboxQuery }>("/v1/chat/global", (req, reply) => {
    const since = req.query.since ? parseInt(req.query.since, 10) : undefined;
    const messages = chat.getGlobalChat(since);
    return reply.send({ messages });
  });
}
