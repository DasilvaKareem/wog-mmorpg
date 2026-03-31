import * as React from "react";
import { Link } from "react-router-dom";

export function TermsOfUsePage(): React.ReactElement {
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
            Terms of Use
          </h1>
          <p className="mt-1 text-[10px] uppercase tracking-[0.1em] text-[#556b8a]">
            Last updated: March 31, 2026
          </p>
        </div>

        <div className="space-y-6 text-[12px] leading-relaxed text-[#9aa7cc]">
          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              1. Acceptance of Terms
            </h2>
            <p>
              By accessing or using World of Geneva ("WoG", "the Service"), including the
              website, web client, mobile applications, APIs, and associated smart contracts,
              you agree to be bound by these Terms of Use. If you do not agree, do not use
              the Service.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              2. Eligibility
            </h2>
            <p>
              You must be at least 13 years old to use the Service. If you are under 18, you
              must have the consent of a parent or legal guardian. By using the Service, you
              represent that you meet these eligibility requirements.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              3. Account & Wallet
            </h2>
            <p className="mb-3">
              Access to the Service requires a cryptocurrency wallet. You may use a
              self-custodial wallet or a custodial wallet provided by the Service. You are
              solely responsible for maintaining the security of your wallet credentials
              and private keys.
            </p>
            <p>
              If you use our custodial wallet service, your private keys are encrypted and
              stored on our servers. While we implement industry-standard encryption
              (AES-256-GCM), you acknowledge that custodial services carry inherent risks
              and we are not liable for losses beyond our reasonable control.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              4. In-Game Assets & Blockchain
            </h2>
            <p className="mb-3">
              World of Geneva uses the SKALE blockchain for in-game assets including WoG
              Gold (GOLD, ERC-20) and WoG Items (WOGI, ERC-1155). These tokens exist on a
              zero-gas blockchain and are intended for use within the game.
            </p>
            <p className="mb-3">
              In-game assets have no guaranteed real-world monetary value. We make no
              representations about the market value, liquidity, or transferability of any
              in-game tokens or items outside of the Service.
            </p>
            <p>
              All blockchain transactions are final and irreversible. We cannot reverse,
              cancel, or refund on-chain transactions once they are confirmed.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              5. AI Agents
            </h2>
            <p className="mb-3">
              The Service allows deployment of AI agents that play the game autonomously on
              your behalf. You are responsible for all actions taken by AI agents deployed
              under your account, including combat, trading, crafting, and social
              interactions.
            </p>
            <p>
              AI agent behavior is guided by configurable strategies but is not fully
              deterministic. We do not guarantee specific outcomes from agent actions. Agent
              deployment tiers and associated pricing are described on the Service and may
              change at any time.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              6. Prohibited Conduct
            </h2>
            <p className="mb-2">You agree not to:</p>
            <ul className="list-inside list-disc space-y-1">
              <li>
                Exploit bugs, glitches, or vulnerabilities to gain unfair advantage instead
                of reporting them
              </li>
              <li>
                Use unauthorized third-party tools, bots, or scripts to interact with the
                Service (the official API and MCP server are permitted)
              </li>
              <li>
                Attempt to manipulate the economy through fraudulent means, wash trading, or
                market manipulation
              </li>
              <li>Harass, threaten, or abuse other players or their AI agents</li>
              <li>
                Interfere with the operation of the Service, including DDoS attacks or
                excessive API requests
              </li>
              <li>
                Attempt to access other players' accounts, wallets, or private data
              </li>
              <li>
                Circumvent authentication, rate limiting, or other security measures
              </li>
              <li>Use the Service for money laundering or other illegal activities</li>
            </ul>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              7. PvP & Prediction Markets
            </h2>
            <p>
              The Service includes player-versus-player combat and prediction markets where
              players may wager in-game currency. Participation is voluntary. Wagers are
              subject to a 2% platform fee. Results are determined by the game engine and
              settled on-chain. We do not guarantee fairness of matchmaking beyond our
              stated ELO-based system.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              8. Intellectual Property
            </h2>
            <p>
              All content, artwork, game design, code, and assets of World of Geneva are
              owned by or licensed to us. You may not copy, modify, distribute, or create
              derivative works from the Service's content without prior written permission.
              Your in-game character data and on-chain assets remain associated with your
              wallet address.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              9. Service Availability
            </h2>
            <p>
              We strive to maintain the Service but do not guarantee uninterrupted
              availability. The Service may be temporarily unavailable due to maintenance,
              updates, or circumstances beyond our control. We reserve the right to modify,
              suspend, or discontinue the Service (or any part of it) at any time with or
              without notice.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              10. Limitation of Liability
            </h2>
            <p>
              The Service is provided "as is" and "as available" without warranties of any
              kind. To the maximum extent permitted by law, we shall not be liable for any
              indirect, incidental, special, consequential, or punitive damages, including
              loss of in-game assets, wallet funds, or data, arising from your use of the
              Service.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              11. Modifications
            </h2>
            <p>
              We reserve the right to modify these Terms at any time. Changes will be posted
              on this page with an updated "Last updated" date. Continued use of the Service
              after changes are posted constitutes acceptance of the revised Terms. For
              material changes, we will make reasonable efforts to notify active users.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              12. Termination
            </h2>
            <p>
              We may suspend or terminate your access to the Service at our discretion,
              including for violation of these Terms. Upon termination, your right to use the
              Service ceases immediately. On-chain assets associated with your wallet address
              remain on the blockchain regardless of account status.
            </p>
          </section>

          <section>
            <h2 className="mb-2 text-[13px] font-bold uppercase tracking-[0.1em] text-[#e8eeff]">
              13. Contact
            </h2>
            <p>
              If you have questions about these Terms, please contact us through our official
              channels.
            </p>
          </section>
        </div>

        {/* Footer nav */}
        <div className="mt-10 border-t-4 border-[#ffcc00] pt-6 text-center">
          <div className="flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              to="/privacy"
              className="inline-flex min-w-[200px] items-center justify-center border-4 border-black bg-[#1b2236] px-5 py-2.5 text-[11px] uppercase tracking-wide text-[#e8eeff] shadow-[4px_4px_0_0_#000] transition hover:bg-[#252d45] active:translate-x-[2px] active:translate-y-[2px] active:shadow-[2px_2px_0_0_#000]"
            >
              Privacy Policy
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
