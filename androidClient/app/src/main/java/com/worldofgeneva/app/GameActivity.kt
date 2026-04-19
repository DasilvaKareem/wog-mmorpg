package com.worldofgeneva.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.graphics.Color
import android.os.Build
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.activity.result.contract.ActivityResultContracts
import androidx.core.content.ContextCompat
import androidx.core.view.WindowCompat
import androidx.core.view.WindowInsetsCompat
import androidx.core.view.WindowInsetsControllerCompat
import org.json.JSONObject

class GameActivity : ComponentActivity() {

    private lateinit var webView: WebView

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* granted or not, don't block */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.parseColor("#070d15")
        window.navigationBarColor = Color.parseColor("#070d15")
        enableImmersiveMode()
        requestNotificationPermission()

        val url = intent.getStringExtra("url") ?: getString(R.string.game_url)
        val wallet = intent.getStringExtra("wallet").orEmpty()
        val token = intent.getStringExtra("token").orEmpty()

        webView = WebView(this).apply {
            setBackgroundColor(Color.parseColor("#070d15"))
            settings.apply {
                javaScriptEnabled = true
                domStorageEnabled = true
                databaseEnabled = true
                mediaPlaybackRequiresUserGesture = false
                javaScriptCanOpenWindowsAutomatically = true
                mixedContentMode = WebSettings.MIXED_CONTENT_COMPATIBILITY_MODE
                userAgentString = "$userAgentString WoGAndroid/1.0"
            }
            webViewClient = AuthInjectingClient(wallet, token)
        }

        setContentView(webView)
        webView.loadUrl(url)

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    override fun onWindowFocusChanged(hasFocus: Boolean) {
        super.onWindowFocusChanged(hasFocus)
        if (hasFocus) enableImmersiveMode()
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            (webView.parent as? android.view.ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }

    private fun enableImmersiveMode() {
        val controller = WindowInsetsControllerCompat(window, window.decorView)
        controller.systemBarsBehavior =
            WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
        controller.hide(WindowInsetsCompat.Type.systemBars())
    }

    private fun requestNotificationPermission() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            if (ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED
            ) {
                notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
            }
        }
    }

    /**
     * Injects the shard JWT into localStorage before any page script runs.
     * Mirrors the iOS `WKUserScript` atDocumentStart behavior in GameWebView.swift.
     * Also routes external links out to the system browser.
     */
    private class AuthInjectingClient(
        private val wallet: String,
        private val token: String,
    ) : WebViewClient() {

        override fun onPageStarted(view: WebView, url: String?, favicon: android.graphics.Bitmap?) {
            super.onPageStarted(view, url, favicon)
            if (wallet.isBlank() || token.isBlank()) return

            val walletJs = JSONObject.quote(wallet.lowercase())
            val tokenJs = JSONObject.quote(token)
            val js = """
                (function() {
                    try {
                        var w = $walletJs;
                        var t = $tokenJs;
                        localStorage.setItem('wog:agent:jwt:' + w, t);
                        localStorage.setItem('wog:agent:jwt:expiry:' + w, String(Date.now() + 82800000));
                        console.log('[WoGAndroid] Injected auth for ' + w);
                    } catch(e) { console.error('[WoGAndroid] Auth inject failed', e); }
                })();
            """.trimIndent()
            view.evaluateJavascript(js, null)
        }

        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val target = request.url
            val host = target.host ?: return false
            if (host.contains("worldofgeneva.com")) return false

            val intent = android.content.Intent(android.content.Intent.ACTION_VIEW, target)
            view.context.startActivity(intent)
            return true
        }
    }
}
