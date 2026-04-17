//
//  GameWebView.swift
//  WoG
//
//  WKWebView that loads /world and injects auth credentials.
//

import SwiftUI
import WebKit

struct GameWebView: View {
    let url: URL
    let wallet: String
    let token: String

    @State private var isLoading = true
    @State private var progress: Double = 0

    var body: some View {
        ZStack {
            WoGColors.bg.ignoresSafeArea()

            WebViewRepresentable(
                url: url,
                wallet: wallet,
                token: token,
                isLoading: $isLoading,
                progress: $progress
            )

            if isLoading {
                VStack(spacing: 16) {
                    ProgressView()
                        .progressViewStyle(CircularProgressViewStyle(tint: WoGColors.gold))
                        .scaleEffect(1.3)
                    Text("Entering world...")
                        .font(.system(size: 14, design: .monospaced))
                        .foregroundColor(WoGColors.textDim)
                    if progress > 0 && progress < 1 {
                        Text("\(Int(progress * 100))%")
                            .font(.system(size: 12, design: .monospaced))
                            .foregroundColor(WoGColors.gold)
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(WoGColors.bg)
            }
        }
    }
}

struct WebViewRepresentable: UIViewRepresentable {
    let url: URL
    let wallet: String
    let token: String
    @Binding var isLoading: Bool
    @Binding var progress: Double

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.preferences.javaScriptCanOpenWindowsAutomatically = true

        // Inject auth credentials into localStorage before page loads
        if !wallet.isEmpty && !token.isEmpty {
            let js = """
            (function() {
                var w = '\(wallet.lowercased())';
                var t = '\(token)';
                try {
                    localStorage.setItem('wog:agent:jwt:' + w, t);
                    localStorage.setItem('wog:agent:jwt:expiry:' + w, String(Date.now() + 82800000));
                    console.log('[WoGiOS] Injected auth for ' + w);
                } catch(e) { console.error('[WoGiOS] Auth inject failed', e); }
            })();
            """
            let script = WKUserScript(source: js, injectionTime: .atDocumentStart, forMainFrameOnly: true)
            config.userContentController.addUserScript(script)
        }

        let webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = context.coordinator
        webView.uiDelegate = context.coordinator
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0.027, green: 0.051, blue: 0.082, alpha: 1)
        webView.scrollView.backgroundColor = UIColor(red: 0.027, green: 0.051, blue: 0.082, alpha: 1)
        webView.customUserAgent = (webView.value(forKey: "userAgent") as? String ?? "") + " WoGiOS/1.0"

        context.coordinator.observe(webView: webView)
        webView.load(URLRequest(url: url))
        return webView
    }

    func updateUIView(_ uiView: WKWebView, context: Context) {}

    class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
        let parent: WebViewRepresentable
        private var progressObserver: NSKeyValueObservation?

        init(_ parent: WebViewRepresentable) {
            self.parent = parent
        }

        func observe(webView: WKWebView) {
            progressObserver = webView.observe(\.estimatedProgress, options: .new) { [weak self] webView, _ in
                DispatchQueue.main.async {
                    self?.parent.progress = webView.estimatedProgress
                }
            }
        }

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async { self.parent.isLoading = false }
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
            if url.host?.contains("worldofgeneva.com") == true || url.scheme == "about" {
                decisionHandler(.allow)
            } else if navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }

        // Handle window.open popups
        func webView(
            _ webView: WKWebView,
            createWebViewWith configuration: WKWebViewConfiguration,
            for navigationAction: WKNavigationAction,
            windowFeatures: WKWindowFeatures
        ) -> WKWebView? {
            // Load popup URLs in the same webview
            if let url = navigationAction.request.url {
                webView.load(URLRequest(url: url))
            }
            return nil
        }
    }
}
