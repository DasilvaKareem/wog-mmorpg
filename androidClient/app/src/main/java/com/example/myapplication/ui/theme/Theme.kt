package com.example.myapplication.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val WogColorScheme = darkColorScheme(
    primary = WogGold,
    secondary = WogGreen,
    tertiary = WogGoldLight,
    background = WogBg,
    surface = WogSurface,
    onPrimary = WogBg,
    onSecondary = WogBg,
    onBackground = WogText,
    onSurface = WogText,
)

@Composable
fun WoGTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = WogColorScheme,
        typography = Typography,
        content = content
    )
}
