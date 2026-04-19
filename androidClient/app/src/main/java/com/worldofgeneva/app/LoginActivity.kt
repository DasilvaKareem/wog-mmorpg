package com.worldofgeneva.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.worldofgeneva.app.auth.ThirdwebAuth
import com.worldofgeneva.app.ui.theme.*
import kotlinx.coroutines.launch

class LoginActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            WoGTheme {
                LoginScreen(
                    onAuthenticated = { wallet, token ->
                        val intent = Intent(this, GameActivity::class.java).apply {
                            putExtra("wallet", wallet)
                            putExtra("token", token)
                        }
                        startActivity(intent)
                        finish()
                    },
                    onSpectate = {
                        startActivity(Intent(this, GameActivity::class.java))
                        finish()
                    },
                )
            }
        }
    }
}

private enum class LoginStep { EMAIL, OTP }

@Composable
private fun LoginScreen(
    onAuthenticated: (wallet: String, token: String) -> Unit,
    onSpectate: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var step by remember { mutableStateOf(LoginStep.EMAIL) }
    var email by remember { mutableStateOf("") }
    var otp by remember { mutableStateOf("") }
    var loading by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(WogBg)
            .statusBarsPadding()
            .navigationBarsPadding(),
    ) {
        when (step) {
            LoginStep.EMAIL -> EmailScreen(
                email = email,
                onEmailChange = { email = it },
                loading = loading,
                error = error,
                onSend = {
                    val trimmed = email.trim()
                    if (trimmed.isEmpty() || loading) return@EmailScreen
                    loading = true
                    error = null
                    scope.launch {
                        try {
                            ThirdwebAuth.sendEmailOTP(trimmed)
                            loading = false
                            step = LoginStep.OTP
                        } catch (e: Exception) {
                            error = e.message ?: "Failed to send code"
                            loading = false
                        }
                    }
                },
                onSpectate = onSpectate,
            )
            LoginStep.OTP -> OtpScreen(
                email = email,
                otp = otp,
                onOtpChange = { newValue ->
                    val digits = newValue.filter { it.isDigit() }.take(6)
                    otp = digits
                },
                loading = loading,
                error = error,
                onBack = {
                    error = null
                    step = LoginStep.EMAIL
                },
                onVerify = {
                    if (otp.length != 6 || loading) return@OtpScreen
                    loading = true
                    error = null
                    scope.launch {
                        try {
                            val result = ThirdwebAuth.verifyEmailOTP(email.trim(), otp)
                            loading = false
                            onAuthenticated(result.walletAddress, result.shardToken)
                        } catch (e: Exception) {
                            error = e.message ?: "Verification failed"
                            otp = ""
                            loading = false
                        }
                    }
                },
            )
        }
    }
}

@Composable
private fun EmailScreen(
    email: String,
    onEmailChange: (String) -> Unit,
    loading: Boolean,
    error: String?,
    onSend: () -> Unit,
    onSpectate: () -> Unit,
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.weight(1f))

        Text(
            text = "WORLD OF GENEVA",
            fontSize = 24.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace,
            color = WogGold,
            letterSpacing = 3.sp,
        )
        Spacer(modifier = Modifier.height(6.dp))
        Text(
            text = "Sign in to play",
            fontSize = 13.sp,
            color = WogTextDim,
            fontFamily = FontFamily.Monospace,
        )

        Spacer(modifier = Modifier.height(40.dp))

        Column(
            modifier = Modifier.padding(horizontal = 32.dp),
            verticalArrangement = Arrangement.spacedBy(14.dp),
        ) {
            TextField(
                value = email,
                onValueChange = onEmailChange,
                placeholder = {
                    Text(
                        "your@email.com",
                        color = Color(0xFF6d77a3),
                        fontFamily = FontFamily.Monospace,
                        fontSize = 15.sp,
                    )
                },
                singleLine = true,
                enabled = !loading,
                keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email),
                textStyle = TextStyle(
                    color = WogText,
                    fontFamily = FontFamily.Monospace,
                    fontSize = 15.sp,
                ),
                colors = TextFieldDefaults.colors(
                    focusedContainerColor = Color(0xFF0e1628),
                    unfocusedContainerColor = Color(0xFF0e1628),
                    disabledContainerColor = Color(0xFF0e1628),
                    focusedIndicatorColor = Color.Transparent,
                    unfocusedIndicatorColor = Color.Transparent,
                    disabledIndicatorColor = Color.Transparent,
                    cursorColor = WogGold,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .border(2.dp, Color(0xFF2a3450), RoundedCornerShape(8.dp)),
            )

            Button(
                onClick = onSend,
                enabled = email.isNotEmpty() && !loading,
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = WogGold,
                    contentColor = WogBg,
                    disabledContainerColor = WogGold.copy(alpha = 0.4f),
                    disabledContentColor = WogBg,
                ),
                modifier = Modifier
                    .fillMaxWidth()
                    .height(50.dp),
            ) {
                if (loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = WogBg,
                        strokeWidth = 2.dp,
                    )
                    Spacer(modifier = Modifier.width(10.dp))
                }
                Text(
                    text = if (loading) "Sending..." else "Send Login Code",
                    fontSize = 15.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                )
            }

            if (error != null) {
                Text(
                    text = error,
                    fontSize = 12.sp,
                    color = Color.Red,
                    fontFamily = FontFamily.Monospace,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            }
        }

        Spacer(modifier = Modifier.weight(1f))

        TextButton(onClick = onSpectate, modifier = Modifier.padding(bottom = 40.dp)) {
            Text(
                text = "Spectate without signing in",
                fontSize = 12.sp,
                color = WogTextDim,
                fontFamily = FontFamily.Monospace,
            )
        }
    }
}

@Composable
private fun OtpScreen(
    email: String,
    otp: String,
    onOtpChange: (String) -> Unit,
    loading: Boolean,
    error: String?,
    onBack: () -> Unit,
    onVerify: () -> Unit,
) {
    LaunchedEffect(otp) {
        if (otp.length == 6 && !loading) onVerify()
    }

    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Spacer(modifier = Modifier.weight(1f))

        Text(
            text = "Enter code",
            fontSize = 20.sp,
            fontWeight = FontWeight.Bold,
            fontFamily = FontFamily.Monospace,
            color = WogGold,
        )
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = "Sent to $email",
            fontSize = 12.sp,
            color = WogTextDim,
            fontFamily = FontFamily.Monospace,
        )

        Spacer(modifier = Modifier.height(30.dp))

        TextField(
            value = otp,
            onValueChange = onOtpChange,
            placeholder = {
                Text(
                    "000000",
                    color = Color(0xFF6d77a3),
                    fontSize = 28.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.fillMaxWidth(),
                )
            },
            singleLine = true,
            enabled = !loading,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.NumberPassword),
            textStyle = TextStyle(
                color = WogText,
                fontFamily = FontFamily.Monospace,
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
            ),
            colors = TextFieldDefaults.colors(
                focusedContainerColor = Color(0xFF0e1628),
                unfocusedContainerColor = Color(0xFF0e1628),
                disabledContainerColor = Color(0xFF0e1628),
                focusedIndicatorColor = Color.Transparent,
                unfocusedIndicatorColor = Color.Transparent,
                disabledIndicatorColor = Color.Transparent,
                cursorColor = WogGold,
            ),
            modifier = Modifier
                .width(200.dp)
                .height(56.dp)
                .clip(RoundedCornerShape(8.dp))
                .border(2.dp, Color(0xFF2a3450), RoundedCornerShape(8.dp)),
        )

        Spacer(modifier = Modifier.height(20.dp))

        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(horizontal = 32.dp),
            horizontalArrangement = Arrangement.spacedBy(12.dp),
        ) {
            OutlinedButton(
                onClick = onBack,
                enabled = !loading,
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.outlinedButtonColors(
                    containerColor = Color(0xFF0e1628),
                    contentColor = WogTextDim,
                ),
                border = ButtonDefaults.outlinedButtonBorder(enabled = true),
                modifier = Modifier
                    .weight(1f)
                    .height(48.dp),
            ) {
                Text("Back", fontSize = 14.sp, fontFamily = FontFamily.Monospace)
            }

            Button(
                onClick = onVerify,
                enabled = otp.length == 6 && !loading,
                shape = RoundedCornerShape(8.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = WogGold,
                    contentColor = WogBg,
                    disabledContainerColor = WogGold.copy(alpha = 0.4f),
                    disabledContentColor = WogBg,
                ),
                modifier = Modifier
                    .weight(1f)
                    .height(48.dp),
            ) {
                if (loading) {
                    CircularProgressIndicator(
                        modifier = Modifier.size(18.dp),
                        color = WogBg,
                        strokeWidth = 2.dp,
                    )
                } else {
                    Text("Verify", fontSize = 14.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
                }
            }
        }

        if (error != null) {
            Text(
                text = error,
                fontSize = 12.sp,
                color = Color.Red,
                fontFamily = FontFamily.Monospace,
                textAlign = TextAlign.Center,
                modifier = Modifier
                    .padding(top = 12.dp, start = 32.dp, end = 32.dp)
                    .fillMaxWidth(),
            )
        }

        Spacer(modifier = Modifier.weight(1f))
    }
}

