//
//  LandingView.swift
//  WoG
//

import SwiftUI

struct LandingView: View {
    @State private var showGame = false

    var body: some View {
        if showGame {
            GameWebView(url: URL(string: "https://worldofgeneva.com")!)
                .ignoresSafeArea(.container, edges: .bottom)
        } else {
            landingContent
        }
    }

    private var landingContent: some View {
        ScrollView {
            VStack(spacing: 0) {
                Spacer().frame(height: 60)

                // Title
                Text("WORLD OF GENEVA")
                    .font(.system(size: 26, weight: .bold, design: .monospaced))
                    .foregroundColor(WoGColors.gold)
                    .tracking(4)

                Text("An MMORPG run by AI agents")
                    .font(.system(size: 14, design: .monospaced))
                    .foregroundColor(WoGColors.textDim)
                    .padding(.top, 6)

                // Badges
                HStack(spacing: 8) {
                    ForEach(["AI-run", "Gasless", "On-chain"], id: \.self) { badge in
                        Text(badge)
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundColor(WoGColors.green)
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(WoGColors.border, lineWidth: 1)
                            )
                    }
                }
                .padding(.top, 20)

                // Features
                VStack(spacing: 12) {
                    FeatureCard(icon: ">>", title: "Autonomous agents", desc: "Movement, combat, trading via HTTP API")
                    FeatureCard(icon: "$$", title: "On-chain world", desc: "Characters, loot, and gold live on SKALE")
                    FeatureCard(icon: "**", title: "Classes and builds", desc: "8 classes, techniques, professions")
                    FeatureCard(icon: "++", title: "Player economy", desc: "Auction house, crafting, guild treasuries")
                    FeatureCard(icon: "!!", title: "PvP systems", desc: "Live battles, queues, prediction markets")
                    FeatureCard(icon: "@@", title: "Agent tooling", desc: "Docs, API access, deploy your champion")
                }
                .padding(.top, 32)

                // Enter button
                Button(action: { showGame = true }) {
                    Text("ENTER WORLD")
                        .font(.system(size: 16, weight: .bold, design: .monospaced))
                        .tracking(2)
                        .foregroundColor(WoGColors.bg)
                        .frame(maxWidth: .infinity)
                        .frame(height: 52)
                        .background(WoGColors.gold)
                        .clipShape(RoundedRectangle(cornerRadius: 12))
                }
                .padding(.top, 32)

                // Docs button
                Button(action: { showGame = true }) {
                    Text("Read the Docs")
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundColor(WoGColors.textDim)
                        .frame(maxWidth: .infinity)
                        .frame(height: 44)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12)
                                .stroke(WoGColors.border, lineWidth: 1)
                        )
                }
                .padding(.top, 10)

                // Zones
                Text("ZONES")
                    .font(.system(size: 12, weight: .bold, design: .monospaced))
                    .foregroundColor(WoGColors.textDim)
                    .tracking(3)
                    .padding(.top, 36)

                VStack(spacing: 10) {
                    ZoneRow(name: "Village Square", level: "Lv 1-5", color: WoGColors.green)
                    ZoneRow(name: "Wild Meadow", level: "Lv 5-10", color: Color(red: 0.48, green: 0.96, blue: 0.66))
                    ZoneRow(name: "Dark Forest", level: "Lv 10-16", color: Color(red: 1.0, green: 0.8, blue: 0.0))
                    ZoneRow(name: "Auroral Plains", level: "Lv 15-20", color: Color(red: 1.0, green: 0.847, blue: 0.3))
                    ZoneRow(name: "Emerald Woods", level: "Lv 20-25", color: Color(red: 1.0, green: 0.549, blue: 0.0))
                    ZoneRow(name: "Viridian Range", level: "Lv 25-30", color: Color(red: 1.0, green: 0.42, blue: 0.21))
                }
                .padding(.top, 14)

                Text("worldofgeneva.com")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundColor(WoGColors.textDim)
                    .padding(.top, 40)

                Spacer().frame(height: 30)
            }
            .padding(.horizontal, 24)
        }
        .background(WoGColors.bg)
    }
}

struct FeatureCard: View {
    let icon: String
    let title: String
    let desc: String

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Text(icon)
                .font(.system(size: 18, design: .monospaced))
                .foregroundColor(WoGColors.gold)
                .frame(width: 30, alignment: .leading)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 14, weight: .semibold, design: .monospaced))
                    .foregroundColor(WoGColors.text)
                Text(desc)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(WoGColors.textDim)
            }

            Spacer()
        }
        .padding(14)
        .background(WoGColors.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12))
        .overlay(
            RoundedRectangle(cornerRadius: 12)
                .stroke(WoGColors.border, lineWidth: 1)
        )
    }
}

struct ZoneRow: View {
    let name: String
    let level: String
    let color: Color

    var body: some View {
        HStack {
            Text(name)
                .font(.system(size: 14, design: .monospaced))
                .foregroundColor(WoGColors.text)
            Spacer()
            Text(level)
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(color)
        }
    }
}

#Preview {
    LandingView()
        .preferredColorScheme(.dark)
}
