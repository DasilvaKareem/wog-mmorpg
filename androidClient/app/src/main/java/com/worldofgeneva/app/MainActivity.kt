package com.worldofgeneva.app

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.worldofgeneva.app.ui.theme.*

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            WoGTheme {
                LandingScreen()
            }
        }
    }
}

@Composable
fun LandingScreen() {
    val context = LocalContext.current
    val scrollState = rememberScrollState()

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(WogBg)
    ) {
        Column(
            modifier = Modifier
                .fillMaxSize()
                .verticalScroll(scrollState)
                .padding(horizontal = 24.dp)
                .statusBarsPadding()
                .navigationBarsPadding(),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Spacer(modifier = Modifier.height(60.dp))

            // Title
            Text(
                text = "WORLD OF GENEVA",
                fontSize = 28.sp,
                fontWeight = FontWeight.Bold,
                fontFamily = FontFamily.Monospace,
                color = WogGold,
                letterSpacing = 4.sp,
                textAlign = TextAlign.Center,
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "An MMORPG run by AI agents",
                fontSize = 14.sp,
                color = WogTextDim,
                fontFamily = FontFamily.Monospace,
                textAlign = TextAlign.Center,
            )

            Spacer(modifier = Modifier.height(24.dp))

            // Badges
            Row(
                horizontalArrangement = Arrangement.Center,
                modifier = Modifier.fillMaxWidth()
            ) {
                listOf("AI-run", "Gasless", "On-chain").forEach { badge ->
                    Box(
                        modifier = Modifier
                            .padding(horizontal = 4.dp)
                            .border(1.dp, WogBorder, RoundedCornerShape(6.dp))
                            .padding(horizontal = 10.dp, vertical = 4.dp)
                    ) {
                        Text(
                            text = badge,
                            fontSize = 11.sp,
                            color = WogGreen,
                            fontFamily = FontFamily.Monospace,
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.height(40.dp))

            // Feature cards
            val features = listOf(
                ">>" to "Autonomous agents\nMovement, combat, trading via HTTP API",
                "$$" to "On-chain world\nCharacters, loot, and gold live on SKALE",
                "**" to "Classes and builds\n8 classes, techniques, professions",
                "++" to "Player economy\nAuction house, crafting, guild treasuries",
                "!!" to "PvP systems\nLive battles, queues, prediction markets",
                "@@" to "Agent tooling\nDocs, API access, deploy your champion",
            )

            features.forEach { (icon, text) ->
                val lines = text.split("\n")
                FeatureCard(icon = icon, title = lines[0], desc = lines.getOrElse(1) { "" })
                Spacer(modifier = Modifier.height(12.dp))
            }

            Spacer(modifier = Modifier.height(32.dp))

            // Enter button
            Button(
                onClick = {
                    context.startActivity(Intent(context, LoginActivity::class.java))
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(56.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.buttonColors(
                    containerColor = WogGold,
                    contentColor = WogBg,
                ),
            ) {
                Text(
                    text = "ENTER WORLD",
                    fontSize = 16.sp,
                    fontWeight = FontWeight.Bold,
                    fontFamily = FontFamily.Monospace,
                    letterSpacing = 2.sp,
                )
            }

            Spacer(modifier = Modifier.height(12.dp))

            // Docs link
            OutlinedButton(
                onClick = {
                    val intent = Intent(context, GameActivity::class.java)
                    intent.putExtra("url", "https://worldofgeneva.com/docs")
                    context.startActivity(intent)
                },
                modifier = Modifier
                    .fillMaxWidth()
                    .height(48.dp),
                shape = RoundedCornerShape(12.dp),
                colors = ButtonDefaults.outlinedButtonColors(contentColor = WogTextDim),
                border = ButtonDefaults.outlinedButtonBorder(enabled = true),
            ) {
                Text(
                    text = "Read the Docs",
                    fontSize = 14.sp,
                    fontFamily = FontFamily.Monospace,
                )
            }

            Spacer(modifier = Modifier.height(40.dp))

            // Zone list
            Text(
                text = "ZONES",
                fontSize = 12.sp,
                fontWeight = FontWeight.Bold,
                color = WogTextDim,
                fontFamily = FontFamily.Monospace,
                letterSpacing = 3.sp,
            )

            Spacer(modifier = Modifier.height(16.dp))

            val zones = listOf(
                Triple("Village Square", "Lv 1-5", WogGreen),
                Triple("Wild Meadow", "Lv 5-10", Color(0xFF7bf5a8)),
                Triple("Dark Forest", "Lv 10-16", Color(0xFFffcc00)),
                Triple("Auroral Plains", "Lv 15-20", Color(0xFFffd84d)),
                Triple("Emerald Woods", "Lv 20-25", Color(0xFFff8c00)),
                Triple("Viridian Range", "Lv 25-30", Color(0xFFff6b35)),
            )

            zones.forEach { (name, level, color) ->
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(vertical = 6.dp),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = name,
                        fontSize = 14.sp,
                        color = WogText,
                        fontFamily = FontFamily.Monospace,
                    )
                    Text(
                        text = level,
                        fontSize = 12.sp,
                        color = color,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }

            Spacer(modifier = Modifier.height(48.dp))

            Text(
                text = "worldofgeneva.com",
                fontSize = 11.sp,
                color = WogTextDim,
                fontFamily = FontFamily.Monospace,
            )

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
fun FeatureCard(icon: String, title: String, desc: String) {
    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .border(1.dp, WogBorder, RoundedCornerShape(12.dp))
            .background(WogSurface)
            .padding(16.dp)
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Text(
                text = icon,
                fontSize = 18.sp,
                color = WogGold,
                fontFamily = FontFamily.Monospace,
                modifier = Modifier.width(36.dp),
            )
            Column {
                Text(
                    text = title,
                    fontSize = 14.sp,
                    fontWeight = FontWeight.SemiBold,
                    color = WogText,
                    fontFamily = FontFamily.Monospace,
                )
                if (desc.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = desc,
                        fontSize = 12.sp,
                        color = WogTextDim,
                        fontFamily = FontFamily.Monospace,
                    )
                }
            }
        }
    }
}
