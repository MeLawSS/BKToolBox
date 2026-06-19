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

inline bool TryParsePriceText(const std::string& text, int* out) {
    if (!out) return false;
    *out = 0;

    std::string digits;
    for (size_t i = 0; i < text.size(); ) {
        const unsigned char ch = static_cast<unsigned char>(text[i]);
        if (ch >= '0' && ch <= '9') {
            digits.push_back(static_cast<char>(ch));
            i++;
            continue;
        }
        if (ch == ',' || ch == ' ' || ch == '\t' || ch == '\r' || ch == '\n') {
            i++;
            continue;
        }
        if (i + 2 < text.size() &&
            static_cast<unsigned char>(text[i]) == 0xEF &&
            static_cast<unsigned char>(text[i + 1]) == 0xBC &&
            static_cast<unsigned char>(text[i + 2]) == 0x8C) {
            i += 3;
            continue;
        }
        return false;
    }

    if (digits.empty()) return false;
    int value = 0;
    for (size_t i = 0; i < digits.size(); ++i) {
        value = value * 10 + (digits[i] - '0');
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

inline int ComputeOpponentCappedBid(int originalBid, int opponentPreviousBid, double multiplier) {
    if (originalBid <= 0 || opponentPreviousBid <= 0 || multiplier <= 0.0) return originalBid;
    const int opponentCap = static_cast<int>(floor(opponentPreviousBid * multiplier));
    return opponentCap < originalBid ? opponentCap : originalBid;
}
