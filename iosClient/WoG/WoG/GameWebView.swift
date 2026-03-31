//
//  GameWebView.swift
//  WoG
//

import SwiftUI
import WebKit
import AVFoundation

struct GameWebView: View {
    let url: URL
    @State private var isLoading = true
    @State private var progress: Double = 0

    var body: some View {
        ZStack {
            WoGColors.bg.ignoresSafeArea()

            WebViewRepresentable(
                url: url,
                isLoading: $isLoading,
                progress: $progress
            )

            if isLoading {
                loadingOverlay
            }
        }
    }

    private var loadingOverlay: some View {
        ZStack {
            WoGColors.bg.ignoresSafeArea()

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
        }
    }
}

struct WebViewRepresentable: UIViewRepresentable {
    let url: URL
    @Binding var isLoading: Bool
    @Binding var progress: Double

    func makeCoordinator() -> Coordinator {
        Coordinator(self)
    }

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []

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

        // MARK: - WKNavigationDelegate

        func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
            DispatchQueue.main.async {
                self.parent.isLoading = false
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

            if url.host?.contains("worldofgeneva.com") == true || url.scheme == "about" {
                decisionHandler(.allow)
            } else if navigationAction.navigationType == .linkActivated {
                UIApplication.shared.open(url)
                decisionHandler(.cancel)
            } else {
                decisionHandler(.allow)
            }
        }

        // MARK: - WKUIDelegate — media permission handling (iOS 15+)

        @available(iOS 15.0, *)
        func webView(
            _ webView: WKWebView,
            requestMediaCapturePermissionFor origin: WKSecurityOrigin,
            initiatedByFrame frame: WKFrameInfo,
            type: WKMediaCaptureType,
            decisionHandler: @escaping (WKPermissionDecision) -> Void
        ) {
            // Auto-grant mic/camera for worldofgeneva.com
            if origin.host.contains("worldofgeneva.com") {
                // Ensure the OS-level permission is requested first
                switch type {
                case .microphone:
                    AVAudioSession.sharedInstance().requestRecordPermission { granted in
                        DispatchQueue.main.async {
                            decisionHandler(granted ? .grant : .deny)
                        }
                    }
                case .camera:
                    AVCaptureDevice.requestAccess(for: .video) { granted in
                        DispatchQueue.main.async {
                            decisionHandler(granted ? .grant : .deny)
                        }
                    }
                case .cameraAndMicrophone:
                    AVAudioSession.sharedInstance().requestRecordPermission { micGranted in
                        guard micGranted else {
                            DispatchQueue.main.async { decisionHandler(.deny) }
                            return
                        }
                        AVCaptureDevice.requestAccess(for: .video) { camGranted in
                            DispatchQueue.main.async {
                                decisionHandler(camGranted ? .grant : .deny)
                            }
                        }
                    }
                @unknown default:
                    decisionHandler(.prompt)
                }
            } else {
                decisionHandler(.deny)
            }
        }
    }
}
