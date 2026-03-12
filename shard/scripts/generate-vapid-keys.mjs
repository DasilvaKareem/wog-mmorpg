/**
 * Generate VAPID keys for Web Push notifications.
 *
 * Run once:
 *   node scripts/generate-vapid-keys.mjs
 *
 * Then add the output to your .env file:
 *   VAPID_PUBLIC_KEY=<publicKey>
 *   VAPID_PRIVATE_KEY=<privateKey>
 *   VAPID_EMAIL=mailto:admin@worldofgeneva.com
 */

import webPush from "web-push";

const keys = webPush.generateVAPIDKeys();

console.log("\n=== VAPID Keys Generated ===\n");
console.log("Add these to your .env file:\n");
console.log(`VAPID_PUBLIC_KEY=${keys.publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${keys.privateKey}`);
console.log(`VAPID_EMAIL=mailto:admin@worldofgeneva.com`);
console.log("\n============================\n");
console.log("IMPORTANT: Also set VITE_VAPID_PUBLIC_KEY in client/.env if you");
console.log("want the client to fetch it at build time (optional — the API route");
console.log("is used at runtime instead).");
console.log("\nDo NOT commit these keys to version control.\n");
