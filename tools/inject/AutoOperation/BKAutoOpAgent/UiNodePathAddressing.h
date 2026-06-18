#pragma once

#include <string>
#include <vector>

inline std::string BuildUiAddressedSegment(const std::string& rawName, int occurrenceIndex, int siblingCount) {
    if (siblingCount <= 1 || occurrenceIndex < 0) {
        return rawName;
    }
    return rawName + "[" + std::to_string(occurrenceIndex) + "]";
}

inline bool TryParseUiAddressedSegment(const std::string& segment, std::string* rawName, int* occurrenceIndex) {
    if (rawName) rawName->clear();
    if (occurrenceIndex) *occurrenceIndex = -1;
    if (segment.empty() || segment[segment.size() - 1] != ']') {
        return false;
    }

    size_t openBracket = segment.rfind('[');
    if (openBracket == std::string::npos || openBracket == 0 || openBracket + 1 >= segment.size() - 1) {
        return false;
    }

    int parsedIndex = 0;
    for (size_t i = openBracket + 1; i + 1 < segment.size(); i++) {
        char ch = segment[i];
        if (ch < '0' || ch > '9') {
            return false;
        }
        parsedIndex = (parsedIndex * 10) + (ch - '0');
    }

    std::string parsedRawName = segment.substr(0, openBracket);
    if (parsedRawName.empty()) {
        return false;
    }

    if (rawName) *rawName = parsedRawName;
    if (occurrenceIndex) *occurrenceIndex = parsedIndex;
    return true;
}

inline bool ResolveUiChildAddress(
    const std::vector<std::string>& childNames,
    const std::string& segment,
    int* outChildIndex,
    std::string* outNormalizedSegment
) {
    if (outChildIndex) *outChildIndex = -1;
    if (outNormalizedSegment) outNormalizedSegment->clear();
    if (segment.empty()) {
        return false;
    }

    for (size_t i = 0; i < childNames.size(); i++) {
        if (childNames[i] != segment) {
            continue;
        }

        int occurrenceIndex = 0;
        int siblingCount = 0;
        for (size_t j = 0; j < childNames.size(); j++) {
            if (childNames[j] != segment) {
                continue;
            }
            if (j < i) {
                occurrenceIndex++;
            }
            siblingCount++;
        }

        if (outChildIndex) *outChildIndex = (int)i;
        if (outNormalizedSegment) {
            *outNormalizedSegment = BuildUiAddressedSegment(segment, occurrenceIndex, siblingCount);
        }
        return true;
    }

    std::string rawName;
    int occurrenceIndex = -1;
    if (!TryParseUiAddressedSegment(segment, &rawName, &occurrenceIndex)) {
        return false;
    }

    int matchedOccurrence = 0;
    int siblingCount = 0;
    for (size_t i = 0; i < childNames.size(); i++) {
        if (childNames[i] != rawName) {
            continue;
        }
        if (matchedOccurrence == occurrenceIndex) {
            if (outChildIndex) *outChildIndex = (int)i;
            siblingCount++;
            for (size_t j = i + 1; j < childNames.size(); j++) {
                if (childNames[j] == rawName) {
                    siblingCount++;
                }
            }
            if (outNormalizedSegment) {
                *outNormalizedSegment = BuildUiAddressedSegment(rawName, occurrenceIndex, siblingCount);
            }
            return true;
        }
        matchedOccurrence++;
        siblingCount++;
    }

    return false;
}
