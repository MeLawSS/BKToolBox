#include "UiNodePathAddressing.h"

#include <assert.h>
#include <string>
#include <vector>

int main() {
    assert(BuildUiAddressedSegment("Button", 0, 1) == "Button");
    assert(BuildUiAddressedSegment("Button", 0, 2) == "Button[0]");
    assert(BuildUiAddressedSegment("Button", 1, 2) == "Button[1]");

    {
        std::string rawName;
        int occurrenceIndex = -1;
        assert(TryParseUiAddressedSegment("Button[1]", &rawName, &occurrenceIndex));
        assert(rawName == "Button");
        assert(occurrenceIndex == 1);
    }

    {
        std::vector<std::string> childNames = { "Button", "Button", "Toggle" };
        int childIndex = -1;
        std::string normalizedSegment;
        assert(ResolveUiChildAddress(childNames, "Button[1]", &childIndex, &normalizedSegment));
        assert(childIndex == 1);
        assert(normalizedSegment == "Button[1]");
    }

    {
        std::vector<std::string> childNames = { "Button", "Button", "Toggle" };
        int childIndex = -1;
        std::string normalizedSegment;
        assert(ResolveUiChildAddress(childNames, "Button", &childIndex, &normalizedSegment));
        assert(childIndex == 0);
        assert(normalizedSegment == "Button[0]");
    }

    {
        std::vector<std::string> childNames = { "Button[1]", "Button" };
        int childIndex = -1;
        std::string normalizedSegment;
        assert(ResolveUiChildAddress(childNames, "Button[1]", &childIndex, &normalizedSegment));
        assert(childIndex == 0);
        assert(normalizedSegment == "Button[1]");
    }

    return 0;
}
