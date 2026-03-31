package com.worldofgeneva.app

import android.Manifest
import android.annotation.SuppressLint
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.view.ViewGroup
import android.webkit.*
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Text
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import com.worldofgeneva.app.ui.theme.*

class GameActivity : ComponentActivity() {

    private var webView: WebView? = null
    private var pendingPermissionCallback: ((Boolean) -> Unit)? = null

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions()
    ) { grants ->
        val allGranted = grants.values.all { it }
        pendingPermissionCallback?.invoke(allGranted)
        pendingPermissionCallback = null
    }

    private val notificationPermissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestPermission()
    ) { /* granted or not, we don't block on it */ }

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        requestNotificationPermission()

        val url = intent.getStringExtra("url") ?: getString(R.string.game_url)

        setContent {
            WoGTheme {
                GameScreen(
                    url = url,
                    onWebViewCreated = { webView = it },
                    onPermissionRequest = { resources, callback ->
                        handleWebPermissions(resources, callback)
                    },
                )
            }
        }
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

    private fun handleWebPermissions(resources: Array<String>, callback: (Boolean) -> Unit) {
        val androidPerms = mutableListOf<String>()
        for (res in resources) {
            when (res) {
                PermissionRequest.RESOURCE_AUDIO_CAPTURE -> androidPerms.add(Manifest.permission.RECORD_AUDIO)
                PermissionRequest.RESOURCE_VIDEO_CAPTURE -> androidPerms.add(Manifest.permission.CAMERA)
            }
        }

        if (androidPerms.isEmpty()) {
            callback(true)
            return
        }

        val allGranted = androidPerms.all {
            ContextCompat.checkSelfPermission(this, it) == PackageManager.PERMISSION_GRANTED
        }

        if (allGranted) {
            callback(true)
        } else {
            pendingPermissionCallback = callback
            permissionLauncher.launch(androidPerms.toTypedArray())
        }
    }

    @Deprecated("Use OnBackPressedCallback instead")
    override fun onBackPressed() {
        if (webView?.canGoBack() == true) {
            webView?.goBack()
        } else {
            @Suppress("DEPRECATION")
            super.onBackPressed()
        }
    }

    override fun onDestroy() {
        webView?.destroy()
        webView = null
        super.onDestroy()
    }
}

@SuppressLint("SetJavaScriptEnabled")
@Composable
fun GameScreen(
    url: String,
    onWebViewCreated: (WebView) -> Unit,
    onPermissionRequest: (Array<String>, (Boolean) -> Unit) -> Unit,
) {
    var loading by remember { mutableStateOf(true) }
    var progress by remember { mutableIntStateOf(0) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(WogBg)
            .statusBarsPadding()
    ) {
        AndroidView(
            modifier = Modifier.fillMaxSize(),
            factory = { context ->
                WebView(context).apply {
                    layoutParams = ViewGroup.LayoutParams(
                        ViewGroup.LayoutParams.MATCH_PARENT,
                        ViewGroup.LayoutParams.MATCH_PARENT,
                    )

                    settings.apply {
                        javaScriptEnabled = true
                        domStorageEnabled = true
                        databaseEnabled = true
                        mediaPlaybackRequiresUserGesture = false
                        mixedContentMode = WebSettings.MIXED_CONTENT_ALWAYS_ALLOW
                        useWideViewPort = true
                        loadWithOverviewMode = true
                        setSupportZoom(false)
                        builtInZoomControls = false
                        cacheMode = WebSettings.LOAD_DEFAULT
                        userAgentString = "$userAgentString WoGAndroid/1.0"
                    }

                    webViewClient = object : WebViewClient() {
                        override fun onPageFinished(view: WebView?, url: String?) {
                            loading = false
                        }

                        override fun shouldOverrideUrlLoading(
                            view: WebView?,
                            request: WebResourceRequest?
                        ): Boolean {
                            val requestUrl = request?.url?.toString() ?: return false
                            if (requestUrl.contains("worldofgeneva.com")) return false
                            val intent = android.content.Intent(
                                android.content.Intent.ACTION_VIEW,
                                android.net.Uri.parse(requestUrl)
                            )
                            context.startActivity(intent)
                            return true
                        }
                    }

                    webChromeClient = object : WebChromeClient() {
                        override fun onProgressChanged(view: WebView?, newProgress: Int) {
                            progress = newProgress
                            if (newProgress >= 100) loading = false
                        }

                        override fun onPermissionRequest(request: PermissionRequest?) {
                            request ?: return
                            val resources = request.resources
                            onPermissionRequest(resources) { granted ->
                                if (granted) {
                                    request.grant(resources)
                                } else {
                                    request.deny()
                                }
                            }
                        }
                    }

                    onWebViewCreated(this)
                    loadUrl(url)
                }
            },
        )

        if (loading) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(WogBg),
                contentAlignment = Alignment.Center,
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    CircularProgressIndicator(
                        color = WogGold,
                        modifier = Modifier.size(40.dp),
                        strokeWidth = 3.dp,
                    )
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "Entering world...",
                        color = WogTextDim,
                        fontSize = 14.sp,
                        fontFamily = FontFamily.Monospace,
                    )
                    if (progress in 1..99) {
                        Spacer(modifier = Modifier.height(4.dp))
                        Text(
                            text = "$progress%",
                            color = WogGold,
                            fontSize = 12.sp,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                }
            }
        }
    }
}
