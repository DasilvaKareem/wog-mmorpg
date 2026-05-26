package com.worldofgeneva.app

import android.annotation.SuppressLint
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.webkit.WebResourceRequest
import android.webkit.WebSettings
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.activity.ComponentActivity
import androidx.activity.OnBackPressedCallback
import androidx.core.view.WindowCompat

/**
 * Wraps the website's /mobile login page in a WebView so we inherit the full
 * thirdweb auth flow (email OTP, social, wallet) without re-implementing it
 * natively. The page redirects to wog://auth/callback?wallet=...&token=... on
 * success, which we intercept and hand off to GameActivity.
 */
class LoginActivity : ComponentActivity() {

    private lateinit var webView: WebView

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        WindowCompat.setDecorFitsSystemWindows(window, false)
        window.statusBarColor = Color.parseColor("#070d15")
        window.navigationBarColor = Color.parseColor("#070d15")

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
            webViewClient = CallbackInterceptingClient(this@LoginActivity)
        }

        setContentView(webView)
        webView.loadUrl("$LOGIN_URL?callback=${Uri.encode(CALLBACK_URL)}")

        onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
            override fun handleOnBackPressed() {
                if (webView.canGoBack()) webView.goBack() else finish()
            }
        })
    }

    override fun onDestroy() {
        if (::webView.isInitialized) {
            (webView.parent as? android.view.ViewGroup)?.removeView(webView)
            webView.destroy()
        }
        super.onDestroy()
    }

    fun launchGame(wallet: String, token: String) {
        startActivity(Intent(this, GameActivity::class.java).apply {
            putExtra("wallet", wallet)
            putExtra("token", token)
        })
        finish()
    }

    fun launchSpectator() {
        startActivity(Intent(this, GameActivity::class.java))
        finish()
    }

    companion object {
        const val LOGIN_URL = "https://worldofgeneva.com/mobile"
        const val CALLBACK_URL = "wog://auth/callback"
    }

    private class CallbackInterceptingClient(
        private val activity: LoginActivity,
    ) : WebViewClient() {
        override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
            val url = request.url
            if (url.scheme == "wog" && url.host == "auth") {
                if (url.getQueryParameter("spectate") == "true") {
                    activity.launchSpectator()
                } else {
                    val wallet = url.getQueryParameter("wallet").orEmpty()
                    val token = url.getQueryParameter("token").orEmpty()
                    activity.launchGame(wallet, token)
                }
                return true
            }
            // External (non-worldofgeneva) links — open in the system browser so
            // OAuth popups for Google/Discord/X complete in a proper browser.
            val host = url.host ?: return false
            if (!host.endsWith("worldofgeneva.com") && url.scheme?.startsWith("http") == true) {
                val intent = Intent(Intent.ACTION_VIEW, url)
                view.context.startActivity(intent)
                return true
            }
            return false
        }
    }
}
