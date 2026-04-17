//
//  LandingView.swift
//  WoG
//

import SwiftUI

struct LandingView: View {
    @State private var screen: Screen = .login
    @State private var email = ""
    @State private var otp = ""
    @State private var error: String? = nil
    @State private var loading = false

    // Auth result
    @State private var wallet = ""
    @State private var token = ""

    enum Screen {
        case login, otpEntry, game
    }

    var body: some View {
        switch screen {
        case .login:
            emailScreen
        case .otpEntry:
            otpScreen
        case .game:
            GameWebView(url: URL(string: "https://worldofgeneva.com/world")!, wallet: wallet, token: token)
                .ignoresSafeArea()
        }
    }

    // MARK: - Email Entry

    private var emailScreen: some View {
        VStack(spacing: 0) {
            Spacer()

            Text("WORLD OF GENEVA")
                .font(.system(size: 24, weight: .bold, design: .monospaced))
                .foregroundColor(WoGColors.gold)
                .tracking(3)

            Text("Sign in to play")
                .font(.system(size: 13, design: .monospaced))
                .foregroundColor(WoGColors.textDim)
                .padding(.top, 6)

            Spacer().frame(height: 40)

            VStack(spacing: 14) {
                TextField("", text: $email, prompt: Text("your@email.com").foregroundColor(Color(hex: 0x6d77a3)))
                    .font(.system(size: 15, design: .monospaced))
                    .foregroundColor(WoGColors.text)
                    .autocapitalization(.none)
                    .disableAutocorrection(true)
                    .keyboardType(.emailAddress)
                    .textContentType(.emailAddress)
                    .padding(.horizontal, 16)
                    .frame(height: 50)
                    .background(Color(hex: 0x0e1628))
                    .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: 0x2a3450), lineWidth: 2))
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                    .onSubmit { sendCode() }

                Button(action: sendCode) {
                    HStack {
                        if loading {
                            ProgressView().progressViewStyle(CircularProgressViewStyle(tint: WoGColors.bg))
                        }
                        Text(loading ? "Sending..." : "Send Login Code")
                            .font(.system(size: 15, weight: .bold, design: .monospaced))
                    }
                    .foregroundColor(WoGColors.bg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 50)
                    .background(email.isEmpty || loading ? WoGColors.gold.opacity(0.4) : WoGColors.gold)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .disabled(email.isEmpty || loading)

                if let error = error {
                    Text(error)
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(.red)
                        .multilineTextAlignment(.center)
                }
            }
            .padding(.horizontal, 32)

            Spacer()

            Button(action: spectate) {
                Text("Spectate without signing in")
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(WoGColors.textDim)
            }
            .padding(.bottom, 40)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WoGColors.bg)
    }

    // MARK: - OTP Entry

    private var otpScreen: some View {
        VStack(spacing: 0) {
            Spacer()

            Text("Enter code")
                .font(.system(size: 20, weight: .bold, design: .monospaced))
                .foregroundColor(WoGColors.gold)

            Text("Sent to \(email)")
                .font(.system(size: 12, design: .monospaced))
                .foregroundColor(WoGColors.textDim)
                .padding(.top, 4)

            Spacer().frame(height: 30)

            TextField("", text: $otp, prompt: Text("000000").foregroundColor(Color(hex: 0x6d77a3)))
                .font(.system(size: 28, weight: .bold, design: .monospaced))
                .foregroundColor(WoGColors.text)
                .multilineTextAlignment(.center)
                .keyboardType(.numberPad)
                .textContentType(.oneTimeCode)
                .frame(width: 200, height: 56)
                .background(Color(hex: 0x0e1628))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: 0x2a3450), lineWidth: 2))
                .clipShape(RoundedRectangle(cornerRadius: 8))
                .onChange(of: otp) { _, newValue in
                    // Strip non-digits, cap at 6
                    let digits = newValue.filter { $0.isNumber }
                    if digits.count > 6 { otp = String(digits.prefix(6)) }
                    else if digits != newValue { otp = digits }
                    // Auto-verify when 6 digits
                    if otp.count == 6 { verifyCode() }
                }
                .padding(.horizontal, 32)

            Spacer().frame(height: 20)

            HStack(spacing: 12) {
                Button(action: { error = nil; screen = .login }) {
                    Text("Back")
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundColor(WoGColors.textDim)
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .background(Color(hex: 0x0e1628))
                        .overlay(RoundedRectangle(cornerRadius: 8).stroke(Color(hex: 0x2a3450), lineWidth: 2))
                        .clipShape(RoundedRectangle(cornerRadius: 8))
                }

                Button(action: verifyCode) {
                    HStack {
                        if loading {
                            ProgressView().progressViewStyle(CircularProgressViewStyle(tint: WoGColors.bg))
                        }
                        Text(loading ? "..." : "Verify")
                            .font(.system(size: 14, weight: .bold, design: .monospaced))
                    }
                    .foregroundColor(WoGColors.bg)
                    .frame(maxWidth: .infinity)
                    .frame(height: 48)
                    .background(otp.count < 6 || loading ? WoGColors.gold.opacity(0.4) : WoGColors.gold)
                    .clipShape(RoundedRectangle(cornerRadius: 8))
                }
                .disabled(otp.count < 6 || loading)
            }
            .padding(.horizontal, 32)

            if let error = error {
                Text(error)
                    .font(.system(size: 12, design: .monospaced))
                    .foregroundColor(.red)
                    .padding(.top, 12)
                    .padding(.horizontal, 32)
            }

            Spacer()
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(WoGColors.bg)
    }

    // MARK: - Actions

    private func sendCode() {
        guard !email.isEmpty, !loading else { return }
        loading = true
        error = nil

        Task {
            do {
                try await ThirdwebAuth.sendEmailOTP(email: email.trimmingCharacters(in: .whitespacesAndNewlines))
                await MainActor.run {
                    loading = false
                    screen = .otpEntry
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                    loading = false
                }
            }
        }
    }

    private func verifyCode() {
        guard otp.count == 6, !loading else { return }
        loading = true
        error = nil

        Task {
            do {
                let result = try await ThirdwebAuth.verifyEmailOTP(
                    email: email.trimmingCharacters(in: .whitespacesAndNewlines),
                    code: otp
                )
                await MainActor.run {
                    wallet = result.walletAddress
                    token = result.shardToken
                    loading = false
                    screen = .game
                }
            } catch {
                await MainActor.run {
                    self.error = error.localizedDescription
                    otp = ""
                    loading = false
                }
            }
        }
    }

    private func spectate() {
        wallet = ""
        token = ""
        screen = .game
    }
}

// MARK: - Color helper

extension Color {
    init(hex: UInt32, opacity: Double = 1.0) {
        self.init(
            red: Double((hex >> 16) & 0xFF) / 255.0,
            green: Double((hex >> 8) & 0xFF) / 255.0,
            blue: Double(hex & 0xFF) / 255.0,
            opacity: opacity
        )
    }
}
