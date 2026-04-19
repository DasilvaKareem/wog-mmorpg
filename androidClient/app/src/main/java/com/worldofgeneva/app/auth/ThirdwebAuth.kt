package com.worldofgeneva.app.auth

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.put
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

data class AuthResult(
    val walletAddress: String,
    val shardToken: String,
    val isNewUser: Boolean,
)

class ThirdwebAuthException(message: String) : IOException(message)

object ThirdwebAuth {
    const val CLIENT_ID = "231a06443d1568f83d2d4f2c8e7dfe3b"
    private const val THIRDWEB_BASE = "https://api.thirdweb.com/v1/auth"
    private const val SHARD_BASE = "https://worldofgeneva.com"
    private const val ORIGIN = "https://worldofgeneva.com"
    private const val BUNDLE_ID = "com.worldofgeneva.app"

    private val JSON = "application/json".toMediaType()
    private val json = Json { ignoreUnknownKeys = true }

    private val client = OkHttpClient.Builder()
        .connectTimeout(15, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .build()

    @Serializable
    private data class ThirdwebCompleteResponse(
        val walletAddress: String? = null,
        val token: String? = null,
        val isNewUser: Boolean? = null,
    )

    @Serializable
    private data class ShardVerifyResponse(val token: String? = null)

    private fun Request.Builder.thirdwebHeaders(): Request.Builder = this
        .header("x-client-id", CLIENT_ID)
        .header("Content-Type", "application/json")
        .header("Origin", ORIGIN)
        .header("Referer", "$ORIGIN/")
        .header("x-bundle-id", BUNDLE_ID)

    suspend fun sendEmailOTP(email: String) = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            put("method", "email")
            put("email", email)
        }.toString().toRequestBody(JSON)

        val request = Request.Builder()
            .url("$THIRDWEB_BASE/initiate")
            .post(body)
            .thirdwebHeaders()
            .build()

        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) {
                val msg = response.body?.string() ?: "Unknown error"
                throw ThirdwebAuthException("Failed to send code (${response.code}): $msg")
            }
        }
    }

    suspend fun verifyEmailOTP(email: String, code: String): AuthResult = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            put("method", "email")
            put("email", email)
            put("code", code)
        }.toString().toRequestBody(JSON)

        val request = Request.Builder()
            .url("$THIRDWEB_BASE/complete")
            .post(body)
            .thirdwebHeaders()
            .build()

        val parsed = client.newCall(request).execute().use { response ->
            val payload = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ThirdwebAuthException("Verification failed (${response.code}): $payload")
            }
            json.decodeFromString(ThirdwebCompleteResponse.serializer(), payload)
        }

        val wallet = parsed.walletAddress
            ?: throw ThirdwebAuthException("Invalid response from thirdweb (no walletAddress)")
        val thirdwebToken = parsed.token
            ?: throw ThirdwebAuthException("Invalid response from thirdweb (no token)")

        val shardToken = exchangeForShardToken(thirdwebToken)
        AuthResult(walletAddress = wallet, shardToken = shardToken, isNewUser = parsed.isNewUser == true)
    }

    private suspend fun exchangeForShardToken(thirdwebToken: String): String = withContext(Dispatchers.IO) {
        val body = buildJsonObject {
            put("thirdwebToken", thirdwebToken)
        }.toString().toRequestBody(JSON)

        val request = Request.Builder()
            .url("$SHARD_BASE/auth/verify-thirdweb")
            .post(body)
            .header("Content-Type", "application/json")
            .build()

        client.newCall(request).execute().use { response ->
            val payload = response.body?.string().orEmpty()
            if (!response.isSuccessful) {
                throw ThirdwebAuthException("Shard auth failed (${response.code}): $payload")
            }
            val parsed = json.decodeFromString(ShardVerifyResponse.serializer(), payload)
            parsed.token ?: throw ThirdwebAuthException("Invalid response from shard auth")
        }
    }
}
