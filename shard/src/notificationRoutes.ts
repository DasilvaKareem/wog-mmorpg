import type { FastifyInstance } from "fastify";
import {
  getTelegramChatId,
  unlinkTelegramChat,
  getBotUsername,
} from "./telegramNotifications.js";

export function registerNotificationRoutes(server: FastifyInstance): void {
  // GET /notifications/telegram/status/:walletAddress
  // Polls whether a wallet has linked its Telegram account
  server.get<{ Params: { walletAddress: string } }>(
    "/notifications/telegram/status/:walletAddress",
    async (request) => {
      const { walletAddress } = request.params;
      const chatId = await getTelegramChatId(walletAddress);
      return { linked: chatId !== null };
    },
  );

  // GET /notifications/telegram/bot-link/:walletAddress
  // Returns the deep link URL to open the bot
  server.get<{ Params: { walletAddress: string } }>(
    "/notifications/telegram/bot-link/:walletAddress",
    async (request) => {
      const { walletAddress } = request.params;
      const username = getBotUsername();
      const url = username
        ? `https://t.me/${username}?start=${walletAddress}`
        : null;
      return { url, botUsername: username || null };
    },
  );

  // DELETE /notifications/telegram/:walletAddress
  // Unlinks a wallet from Telegram
  server.delete<{ Params: { walletAddress: string } }>(
    "/notifications/telegram/:walletAddress",
    async (request) => {
      const { walletAddress } = request.params;
      await unlinkTelegramChat(walletAddress);
      return { success: true };
    },
  );
}
