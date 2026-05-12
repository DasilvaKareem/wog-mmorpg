//
//  LandingView.swift
//  WoG
//
//  Hosts the website's /mobile login page in a WKWebView. The page handles
//  email and SMS OTP, then redirects to wog://auth/callback?wallet=...&token=...,
//  which we intercept to transition to the game.
//

import SwiftUI
import WebKit

struct LandingView: View {
    enum Screen {
        case login
        case game
    }

    @State private var screen: Screen = .login
    @State private var wallet: String = ""
    @State private var token: String = ""

    var body: some View {
        switch screen {
        case .login:
            LoginWebView(
                onAuthenticated: { wallet, token in
                    self.wallet = wallet
                    self.token = token
                    self.screen = .game
                },
                onSpectate: {
                    self.wallet = ""
                    self.token = ""
                    self.screen = .game
                }
            )
            .ignoresSafeArea()
        case .game:
            GameWebView(
                url: URL(string: "https://worldofgeneva.com/world")!,
                wallet: wallet,
                token: token
            )
            .ignoresSafeArea()
        }
    }
}

// MARK: - Login WebView

private let loginURL = "https://worldofgeneva.com/mobile"
private let callbackURL = "wog://auth/callback"

/// SwiftUI view that hosts the login WKWebView with a loading overlay.
/// WKWebView's WebContent process can take 10+ seconds to spin up on first
/// launch on a real device, so we show a spinner until the page finishes.
struct LoginWebView: View {
    let onAuthenticated: (String, String) -> Void
    let onSpectate: () -> Void

    @State private var isLoading: Bool = true
    @State private var loadError: String? = nil

    var body: some View {
        ZStack {
            WoGColors.bg.ignoresSafeArea()

            LoginWebViewRepresentable(
                onAuthenticated: onAuthenticated,
                onSpectate: onSpectate,
                isLoading: $isLoading,
                loadError: $loadError
            )

            if isLoading {
                VStack(spacing: 14) {
                    Text("WORLD OF GENEVA")
                        .font(.system(size: 18, weight: .bold, design: .monospaced))
                        .foregroundColor(WoGColors.gold)
                        .tracking(3)
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: WoGColors.gold))
                        .scaleEffect(1.2)
                    Text("Loading sign-in...")
                        .font(.system(size: 12, design: .monospaced))
                        .foregroundColor(WoGColors.textDim)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(WoGColors.bg)
            }

            if let error = loadError {
                VStack(spacing: 12) {
                    Text("Couldn't reach sign-in")
                        .font(.system(size: 16, weight: .bold, design: .monospaced))
                        .foregroundColor(WoGColors.gold)
                    Text(error)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundColor(WoGColors.textDim)
                        .multilineTextAlignment(.center)
                        .padding(.horizontal, 24)
                    Button(action: {
                        loadError = nil
                        isLoading = true
                        NotificationCenter.default.post(name: .loginWebViewRetry, object: nil)
                    }) {
                        Text("Retry")
                            .font(.system(size: 14, weight: .bold, design: .monospaced))
                            .foregroundColor(WoGColors.bg)
                            .frame(width: 120, height: 44)
                            .background(WoGColors.gold)
                            .clipShape(RoundedRectangle(cornerRadius: 8))
                    }
                    Button(action: onSpectate) {
                        Text("Spectate")
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(WoGColors.textDim)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(WoGColors.bg)
            }
        }
    }
}

extension Notification.Name {
    static let loginWebViewRetry = Notification.Name("LoginWebViewRetry")
}

private struct LoginWebViewRepresentable: UIViewRepresentable {
    let onAuthenticated: (String, String) -> Void
    let onSpectate: () -> Void
    @Binding var isLoading: Bool
    @Binding var loadError: String?

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.027, green: 0.051, blue: 0.082, alpha: 1)
        webView.scrollView.backgroundColor = UIColor(red: 0.027, green: 0.051, blue: 0.082, alpha: 1)
        webView.customUserAgent = (webView.value(forKey: "userAgent") as? String ?? "") + " WoGiOS/1.0"

        context.coordinator.webView = webView
        context.coordinator.observeRetry()
        context.coordinator.load()
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let parent: LoginWebViewRepresentable
        weak var webView: WKWebView?
        private var retryObserver: NSObjectProtocol?

        init(_ parent: LoginWebViewRepresentable) {
            self.parent = parent
        }

        deinit {
            if let observer = retryObserver {
                NotificationCenter.default.removeObserver(observer)
            }
        }

        func observeRetry() {
            retryObserver = NotificationCenter.default.addObserver(
                forName: .loginWebViewRetry,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                self?.load()
            }
        }

        func load() {
            guard let webView = webView else { return }
            var components = URLComponents(string: loginURL)!
            components.queryItems = [URLQueryItem(name: "callback", value: callbackURL)]
            guard let url = components.url else { return }
            webView.load(URLRequest(url: url))
        }

        // MARK: WKNavigationDelegate

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async {
                self.parent.isLoading = false
                self.parent.loadError = nil
            }
        }

        func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
            DispatchQueue.main.async {
                self.parent.isLoading = false
                self.parent.loadError = (error as NSError).localizedDescription
            }
        }

        func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
            DispatchQueue.main.async {
                self.parent.isLoading = false
                self.parent.loadError = (error as NSError).localizedDescription
            }
        }

        func webView(
            _ webView: WKWebView,
            decidePolicyFor navigationAction: WKNavigationAction,
            decisionHandler: @escaping (WKNavigationActionPolicy) -> Void
        ) {
            guard let url = navigationAction.request.url else {
                decisionHandler(.allow)
                return
            }

            // Intercept the auth callback
            if url.scheme == "wog", url.host == "auth" {
                let comps = URLComponents(url: url, resolvingAgainstBaseURL: false)
                let items = comps?.queryItems ?? []
                if items.first(where: { $0.name == "spectate" })?.value == "true" {
                    DispatchQueue.main.async { self.parent.onSpectate() }
                } else {
                    let wallet = items.first(where: { $0.name == "wallet" })?.value ?? ""
                    let token = items.first(where: { $0.name == "token" })?.value ?? ""
                    DispatchQueue.main.async { self.parent.onAuthenticated(wallet, token) }
                }
                decisionHandler(.cancel)
                return
            }

            // External (non-worldofgeneva) http links → Safari
            if let host = url.host,
               !host.contains("worldofgeneva.com"),
               (url.scheme == "http" || url.scheme == "https"),
               navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
                return
            }

            decisionHandler(.allow)
        }

        // Handle window.open popups
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            if let url = navigationAction.request.url {
                webView.load(URLRequest(url: url))
            }
            return nil
        }
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
