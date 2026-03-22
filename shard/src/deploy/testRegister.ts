import "dotenv/config";
import { ethers } from "ethers";

const provider = new ethers.JsonRpcProvider("https://skale-base.skalenodes.com/v1/base");
const wallet = new ethers.Wallet(process.env.SERVER_PRIVATE_KEY!, provider);
const contract = new ethers.Contract(
  process.env.IDENTITY_REGISTRY_ADDRESS!,
  [
    "function register(string agentURI) external returns (uint256 agentId)",
    "event Registered(uint256 indexed agentId, string agentURI, address indexed owner)",
  ],
  wallet
);

async function main() {
  const addr = await wallet.getAddress();
  const latest = await provider.getTransactionCount(addr, "latest");
  const pending = await provider.getTransactionCount(addr, "pending");
  const nonce = Math.max(latest, pending) + 5; // skip past shard's pending txs
  console.log(`Address: ${addr}, latest: ${latest}, pending: ${pending}, using: ${nonce}`);
  console.log("Sending register tx...");
  const tx = await contract["register(string)"]("https://wog.urbantech.dev/a2a/test-backfill", {
    nonce,
    gasLimit: 3_000_000,
  });
  console.log("TX sent:", tx.hash);
  const receipt = await tx.wait();
  console.log("Confirmed! Logs:", receipt!.logs.length);
  const evt = receipt!.logs.find(
    (l: any) => l.topics?.[0] === ethers.id("Registered(uint256,string,address)")
  );
  if (evt) {
    console.log("agentId:", BigInt(evt.topics[1]));
  } else {
    console.log("No Registered event found");
  }
}

main().catch((e) => {
  console.error("Failed:", e.message?.slice(0, 200));
  process.exit(1);
});
