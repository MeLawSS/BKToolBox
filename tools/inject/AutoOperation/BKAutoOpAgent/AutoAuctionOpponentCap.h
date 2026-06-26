#pragma once

#include <ctype.h>
#include <math.h>
#include <stddef.h>
#include <string>

inline bool TryParseHistoryRoundNumber(const std::string& text, int* out) {
    if (!out) return false;
    *out = 0;
    size_t i = 0;
    while (i < text.size() && (text[i] < '0' || text[i] > '9')) i++;
    if (i >= text.size()) return false;

    int value = 0;
    while (i < text.size() && text[i] >= '0' && text[i] <= '9') {
        value = value * 10 + (text[i] - '0');
        i++;
    }
    while (i < text.size()) {
        if (text[i] >= '0' && text[i] <= '9') return false;
        i++;
    }
    if (value <= 0) return false;
    *out = value;
    return true;
}

// Parses price display text into an integer.
// Handles plain integers ("58,999"), full-width commas, and K-suffix
// decimals ("110.22K" → 110220, "120.00K" → 120000).
inline bool TryParsePriceText(const std::string& text, int* out) {
    if (!out) return false;
    *out = 0;

    // Strip leading/trailing whitespace and collect the meaningful portion.
    size_t start = 0;
    while (start < text.size() && (text[start] == ' ' || text[start] == '\t' ||
           text[start] == '\r' || text[start] == '\n')) {
        ++start;
    }
    size_t end = text.size();
    while (end > start && (text[end-1] == ' ' || text[end-1] == '\t' ||
           text[end-1] == '\r' || text[end-1] == '\n')) {
        --end;
    }

    // Check for K suffix (case-insensitive).
    bool hasKSuffix = false;
    if (end > start && (text[end-1] == 'K' || text[end-1] == 'k')) {
        hasKSuffix = true;
        --end;
    }

    // Collect digit characters and an optional decimal point.
    std::string intPart;
    std::string fracPart;
    bool sawDot = false;
    for (size_t i = start; i < end; ) {
        const unsigned char ch = static_cast<unsigned char>(text[i]);
        if (ch >= '0' && ch <= '9') {
            if (sawDot) fracPart.push_back(static_cast<char>(ch));
            else        intPart.push_back(static_cast<char>(ch));
            ++i;
            continue;
        }
        if (ch == '.') {
            if (sawDot) return false; // two dots
            sawDot = true;
            ++i;
            continue;
        }
        // Separators: ASCII comma/space or full-width comma (EF BC 8C).
        if (ch == ',' || ch == ' ') { ++i; continue; }
        if (ch == 0xEF && i + 2 < end &&
            static_cast<unsigned char>(text[i+1]) == 0xBC &&
            static_cast<unsigned char>(text[i+2]) == 0x8C) {
            i += 3;
            continue;
        }
        return false; // unexpected character
    }

    if (!hasKSuffix && sawDot) return false; // decimal without K is invalid

    if (intPart.empty()) return false;

    int value = 0;
    for (size_t i = 0; i < intPart.size(); ++i) {
        value = value * 10 + (intPart[i] - '0');
    }

    if (hasKSuffix) {
        // Pad fracPart to exactly 3 digits (K = ×1000).
        while (fracPart.size() < 3) fracPart.push_back('0');
        // More than 3 fractional digits means sub-1 precision; truncate.
        int frac = 0;
        for (size_t i = 0; i < 3; ++i) {
            frac = frac * 10 + (fracPart[i] - '0');
        }
        value = value * 1000 + frac;
    }

    if (value <= 0) return false;
    *out = value;
    return true;
}

inline bool TryGetOpponentCapMultiplier(int round, double* out) {
    if (!out) return false;
    switch (round) {
    case 2:
        *out = 1.65;
        return true;
    case 3:
        *out = 1.4;
        return true;
    case 4:
        *out = 1.23;
        return true;
    case 5:
        *out = 1.1;
        return true;
    default:
        return false;
    }
}

inline bool TryResolveOpponentSlot(
    const std::string& selfName,
    const std::string& player1Name,
    const std::string& player2Name,
    int* outSlot
) {
    if (!outSlot) return false;
    *outSlot = 0;

    if (player1Name == "巅峰收藏家1" && player2Name == "巅峰收藏家2") {
        *outSlot = 2;
        return true;
    }

    if (selfName.empty()) return false;

    const bool player1IsSelf = player1Name == selfName;
    const bool player2IsSelf = player2Name == selfName;
    if (player1IsSelf == player2IsSelf) return false;

    if (player1IsSelf) {
        if (player2Name.empty()) return false;
        *outSlot = 2;
        return true;
    }
    if (player1Name.empty()) return false;
    *outSlot = 1;
    return true;
}

inline bool IsAutoAuctionWinnerSelf(
    const std::string& selfName,
    const std::string& winnerName
) {
    return !selfName.empty() && !winnerName.empty() && selfName == winnerName;
}

inline bool ShouldWaitForQuickRecycle(
    const std::string& selfName,
    const std::string& winnerName
) {
    return IsAutoAuctionWinnerSelf(selfName, winnerName);
}

inline int ComputeOpponentCappedBid(int originalBid, int opponentPreviousBid, double multiplier) {
    if (originalBid <= 0 || opponentPreviousBid <= 0 || multiplier <= 0.0) return originalBid;
    const int opponentCap = static_cast<int>(floor(opponentPreviousBid * multiplier));
    return opponentCap < originalBid ? opponentCap : originalBid;
}
