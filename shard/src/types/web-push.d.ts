declare module "web-push" {
  export interface PushSubscription {
    endpoint: string;
    expirationTime?: number | null;
    keys?: {
      p256dh?: string;
      auth?: string;
    };
  }

  const webPush: {
    setVapidDetails(subject: string, publicKey: string, privateKey: string): void;
    sendNotification(subscription: PushSubscription, payload?: string): Promise<void>;
  };

  export default webPush;
}
