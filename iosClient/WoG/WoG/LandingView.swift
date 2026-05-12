//
//  LandingView.swift
//  WoG
//
//  Hosts the website's /mobile login page in a WKWebView. The page handles
//  email OTP, social, and wallet auth itself, then redirects to
//  wog://auth/callback?wallet=...&token=..., which we intercept to transition
//  to the game.
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

struct LoginWebView: UIViewRepresentable {
    let onAuthenticated: (String, String) -> Void
    let onSpectate: () -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(onAuthenticated: onAuthenticated, onSpectate: onSpectate)
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

        var components = URLComponents(string: loginURL)!
        components.queryItems = [URLQueryItem(name: "callback", value: callbackURL)]
        webView.load(URLRequest(url: components.url!))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let onAuthenticated: (String, String) -> Void
        let onSpectate: () -> Void

        init(onAuthenticated: @escaping (String, String) -> Void, onSpectate: @escaping () -> Void) {
            self.onAuthenticated = onAuthenticated
            self.onSpectate = onSpectate
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
                    DispatchQueue.main.async { self.onSpectate() }
                } else {
                    let wallet = items.first(where: { $0.name == "wallet" })?.value ?? ""
                    let token = items.first(where: { $0.name == "token" })?.value ?? ""
                    DispatchQueue.main.async { self.onAuthenticated(wallet, token) }
                }
                decisionHandler(.cancel)
                return
            }

            // External (non-worldofgeneva) http links → open in Safari (OAuth popups, etc.)
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

        // Handle window.open popups (used by some OAuth flows)
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
