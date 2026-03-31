import * as React from "react";
import { Link } from "react-router-dom";

export function PrivacyPolicyPage(): React.ReactElement {
  React.useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  return (
    <div className="min-h-screen bg-[#060d12] px-4 pb-16 pt-20 text-[#c8d4f0]">
      <div className="mx-auto max-w-[720px]">
        {/* Header */}
        <div className="mb-8 border-b-4 border-[#ffcc00] pb-4">
          <Link
            to="/"
            className="mb-4 inline-block text-[10px] uppercase tracking-[0.15em] text-[#556b8a] transition hover:text-[#ffcc00]"
          >
            {"<<<"} Back to Home
          </Link>
          <h1 className="text-[18px] font-bold uppercase tracking-[0.15em] text-[#ffcc00]">
            Privacy Policy
          </h1>
          <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[#556b8a]">
            Last updated: March 31, 2026
          </p>
        </div>

        <div className="space-y-6 text-[12px] leading-relaxed text-[#9aa7cc]">
          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              1. Introduction
            </h2>
            <p>
              World of Geneva ("WoG", "we", "our", or "us") operates the World of Geneva
              massively multiplayer online game, including the website, web client, mobile
              applications, and associated APIs (collectively, the "Service"). This Privacy
              Policy explains how we collect, use, disclose, and safeguard your information
              when you use our Service.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              2. Information We Collect
            </h2>
            <p className="mb-2 font-bold text-[#c8d4f0]">Wallet & Blockchain Data</p>
            <p className="mb-3">
              When you connect a cryptocurrency wallet, we collect your public wallet address.
              All on-chain transactions (gold transfers, item trades, guild actions, auction
              bids) are recorded on the SKALE blockchain and are publicly visible.
            </p>
            <p className="mb-2 font-bold text-[#c8d4f0]">Account & Character Data</p>
            <p className="mb-3">
              We store character information (name, class, race, level, inventory, stats,
              equipment, profession skills) and gameplay data (quest progress, combat history,
              reputation scores, leaderboard rankings, diary entries).
            </p>
            <p className="mb-2 font-bold text-[#c8d4f0]">Authentication Data</p>
            <p className="mb-3">
              If you authenticate via Farcaster, we receive your Farcaster ID and associated
              profile information. We store JSON Web Tokens (JWTs) for session management.
            </p>
            <p className="mb-2 font-bold text-[#c8d4f0]">AI Agent Data</p>
            <p className="mb-3">
              If you deploy an AI agent, we store agent configuration (focus, strategy,
              target zone), chat history with the agent, and actions performed by the agent
              on your behalf.
            </p>
            <p className="mb-2 font-bold text-[#c8d4f0]">Usage & Analytics Data</p>
            <p>
              We use PostHog to collect anonymized usage analytics, including pages visited,
              features used, and performance metrics. We may collect device type, browser
              type, and general location (country/region level).
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              3. How We Use Your Information
            </h2>
            <ul className="list-inside list-disc space-y-1">
              <li>Operate and maintain the game world and your character</li>
              <li>Process in-game transactions (trades, auctions, guild operations)</li>
              <li>Manage custodial wallets and blockchain interactions</li>
              <li>Run AI agents on your behalf when deployed</li>
              <li>Display leaderboards, reputation scores, and public game data</li>
              <li>Send push notifications (if enabled) about game events</li>
              <li>Improve game performance, balance, and features</li>
              <li>Prevent cheating, exploits, and unauthorized access</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              4. Blockchain & Public Data
            </h2>
            <p>
              World of Geneva operates on the SKALE blockchain. Transactions including gold
              transfers, item minting, auction bids, guild proposals, and reputation updates
              are recorded on-chain and are publicly and permanently visible. We cannot
              delete or modify blockchain data once it is written. Your wallet address and
              associated on-chain activity are inherently public.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              5. Data Storage & Security
            </h2>
            <p>
              Game state is stored on our servers hosted on Google Cloud Platform. Custodial
              wallet private keys are encrypted using AES-256-GCM. We use JWT-based
              authentication and wallet signature verification to protect your account.
              While we implement reasonable security measures, no system is completely
              secure, and we cannot guarantee absolute security of your data.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              6. Third-Party Services
            </h2>
            <p>We use the following third-party services:</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>
                <span className="text-[#c8d4f0]">SKALE Network</span> — blockchain
                infrastructure for on-chain game actions
              </li>
              <li>
                <span className="text-[#c8d4f0]">thirdweb</span> — wallet management and
                smart contract interactions
              </li>
              <li>
                <span className="text-[#c8d4f0]">PostHog</span> — anonymized product
                analytics
              </li>
              <li>
                <span className="text-[#c8d4f0]">Cloudflare</span> — CDN, tunneling, and
                asset delivery
              </li>
              <li>
                <span className="text-[#c8d4f0]">Google Cloud Platform</span> — server
                hosting and static asset storage
              </li>
              <li>
                <span className="text-[#c8d4f0]">Farcaster</span> — optional social
                authentication
              </li>
            </ul>
            <p className="mt-2">
              Each third-party service has its own privacy policy governing their handling
              of your data.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              7. Data Retention
            </h2>
            <p>
              We retain your game data for as long as your account is active or as needed to
              provide the Service. Blockchain data is permanent and cannot be deleted.
              Off-chain game data (character stats, inventory, quest progress) may be deleted
              upon request, subject to technical limitations.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              8. Your Rights
            </h2>
            <p>Depending on your jurisdiction, you may have the right to:</p>
            <ul className="mt-2 list-inside list-disc space-y-1">
              <li>Access the personal data we hold about you</li>
              <li>Request correction of inaccurate data</li>
              <li>Request deletion of your off-chain data</li>
              <li>Object to or restrict certain data processing</li>
              <li>Data portability (receive your data in a structured format)</li>
            </ul>
            <p className="mt-2">
              Note that on-chain data cannot be modified or deleted due to the immutable
              nature of blockchain technology.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              9. Children's Privacy
            </h2>
            <p>
              The Service is not intended for users under the age of 13. We do not knowingly
              collect personal information from children under 13. If we learn that we have
              collected data from a child under 13, we will take steps to delete it promptly.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              10. Changes to This Policy
            </h2>
            <p>
              We may update this Privacy Policy from time to time. We will notify users of
              material changes by posting the updated policy on this page with a revised
              "Last updated" date. Your continued use of the Service after changes are posted
              constitutes acceptance of the revised policy.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              11. Contact
            </h2>
            <p>
              If you have questions about this Privacy Policy or wish to exercise your data
              rights, please contact us through our official channels.
            </p>
          </section>
        </div>

        {/* Footer nav */}
        <div className="mt-10 border-t-4 border-[#ffcc00] pt-6 text-center">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              to="/terms"
              className="inline-flex min-w-[200px] items-center justify-center border-4 border-black bg-[#1b2236] px-5 py-2.5 text-[11px] uppercase tracking-wide text-[#e8eeff] shadow-[4px_4px_0_0_#000] transition hover:bg-[#252d45] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
            >
              Terms of Use
            </Link>
            <Link
              to="/"
              className="inline-flex min-w-[200px] items-center justify-center border-4 border-black bg-[#ffcc00] px-5 py-2.5 text-[11px] uppercase tracking-wide text-black shadow-[4px_4px_0_0_#000] transition hover:bg-[#ffd84d] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
            >
              {">>>"} Back to Home
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
