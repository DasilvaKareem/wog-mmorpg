//
//  ThirdwebAuth.swift
//  WoG
//
//  Native email OTP auth via thirdweb HTTP API,
//  then exchanges the thirdweb token for a shard JWT.
//

import Foundation

struct AuthResult {
    let walletAddress: String
    let shardToken: String
    let isNewUser: Bool
}

enum ThirdwebAuth {
    static let clientId = "231a06443d1568f83d2d4f2c8e7dfe3b"
    private static let thirdwebBase = "https://api.thirdweb.com/v1/auth"
    private static let shardBase = "https://worldofgeneva.com"
    // Spoof origin so thirdweb ties initiate+complete to the same allowed domain
    private static let origin = "https://worldofgeneva.com"

    private static func thirdwebHeaders() -> [(String, String)] {
        [
            ("x-client-id", clientId),
            ("Content-Type", "application/json"),
            ("Origin", origin),
            ("Referer", origin + "/"),
            ("x-bundle-id", Bundle.main.bundleIdentifier ?? "com.worldofgeneva.WoG"),
        ]
    }

    /// Step 1: Send OTP to email
    static func sendEmailOTP(email: String) async throws {
        var request = URLRequest(url: URL(string: "\(thirdwebBase)/initiate")!)
        request.httpMethod = "POST"
        for (key, val) in thirdwebHeaders() { request.setValue(val, forHTTPHeaderField: key) }

        let body: [String: Any] = ["method": "email", "email": email]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        if status >= 400 {
            let msg = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw AuthError.apiError("Failed to send code (\(status)): \(msg)")
        }
    }

    /// Step 2: Verify OTP → thirdweb token + wallet
    /// Step 3: Exchange thirdweb token for shard JWT
    static func verifyEmailOTP(email: String, code: String) async throws -> AuthResult {
        var twRequest = URLRequest(url: URL(string: "\(thirdwebBase)/complete")!)
        twRequest.httpMethod = "POST"
        for (key, val) in thirdwebHeaders() { twRequest.setValue(val, forHTTPHeaderField: key) }

        let twBody: [String: Any] = ["method": "email", "email": email, "code": code]
        twRequest.httpBody = try JSONSerialization.data(withJSONObject: twBody)

        let (twData, twResponse) = try await URLSession.shared.data(for: twRequest)
        let twStatus = (twResponse as? HTTPURLResponse)?.statusCode ?? 0

        if twStatus >= 400 {
            let msg = String(data: twData, encoding: .utf8) ?? "Unknown error"
            throw AuthError.apiError("Verification failed (\(twStatus)): \(msg)")
        }

        guard let twJson = try JSONSerialization.jsonObject(with: twData) as? [String: Any],
              let walletAddress = twJson["walletAddress"] as? String,
              let thirdwebToken = twJson["token"] as? String else {
            throw AuthError.apiError("Invalid response from thirdweb")
        }

        let isNewUser = twJson["isNewUser"] as? Bool ?? false

        let shardToken = try await exchangeForShardToken(thirdwebToken: thirdwebToken)

        return AuthResult(walletAddress: walletAddress, shardToken: shardToken, isNewUser: isNewUser)
    }

    private static func exchangeForShardToken(thirdwebToken: String) async throws -> String {
        var request = URLRequest(url: URL(string: "\(shardBase)/auth/verify-thirdweb")!)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")

        let body: [String: Any] = ["thirdwebToken": thirdwebToken]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        let status = (response as? HTTPURLResponse)?.statusCode ?? 0

        if status >= 400 {
            let msg = String(data: data, encoding: .utf8) ?? "Unknown error"
            throw AuthError.apiError("Shard auth failed (\(status)): \(msg)")
        }

        guard let json = try JSONSerialization.jsonObject(with: data) as? [String: Any],
              let token = json["token"] as? String else {
            throw AuthError.apiError("Invalid response from shard auth")
        }

        return token
    }

    enum AuthError: LocalizedError {
        case apiError(String)
        var errorDescription: String? {
            switch self {
            case .apiError(let msg): return msg
            }
        }
    }
}
